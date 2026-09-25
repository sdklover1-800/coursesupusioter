/**
 * Семантическая проверка реплики тьютора на раскрытие ответа (калибровка A.3, A21).
 *
 * Дословный 4-граммный детектор (leakDetector.ts) остаётся дешёвым первым барьером,
 * но в живых прогонах он давал 0 на всех репликах — одного его мало. Здесь — один
 * небольшой вызов судьи (effort low, ≤ 60 токенов вывода): видит тезисы и фрагмент
 * эталона и отвечает, раскрывает ли реплика то, чего студент ещё не установил сам.
 *
 * Реплика БУФЕРИЗУЕТСЯ на сервере и уходит студенту только после проверки.
 * Таймаут/сбой проверки при LEAK_CHECK_FAIL_MODE=closed (по умолчанию) — реплика
 * НЕ уходит, её заменяет безопасный наводящий вопрос (fail-closed).
 *
 * Модуль чистый: вызов LLM, таймаут и режим передаются явно (тестируется без env/сети).
 */
import type { CompletionRequest, CompletionResult, TokenUsage } from './types.js';
import type { LeakCheckOutput } from './schemas/dialog.js';
import { leakCheckSystemPrompt, leakCheckUserMessage } from './prompts/dialog.js';

/** Максимум вывода проверки (калибровка A.3). */
export const LEAK_CHECK_MAX_TOKENS = 60;

/** Структурированный вызов LLM (в проде — gateway.completeStructured со схемой проверки). */
export type StructuredCall<T> = (req: CompletionRequest) => Promise<{ data: T; result: CompletionResult }>;

/** Результат проверки — хранится в ChatMessage.leakCheck (без текста эталона). */
export interface LeakCheckRecord {
  leaks: boolean;
  reason: string;
  ms: number;
  timeout: boolean;
  /** Вызов упал (не таймаут) */
  error?: string;
  /** Сработал дословный 4-граммный детектор — семантическая проверка не понадобилась */
  verbatim?: boolean;
  /** Проверка выключена env */
  skipped?: boolean;
}

export interface LeakCheckRun extends LeakCheckRecord {
  usage: TokenUsage | null;
}

export interface LeakCheckInput {
  model: string;
  rubricKeyPoints: string[];
  referenceSolution: string;
  /** Реплики студента — что он уже установил сам (для отсева ложных срабатываний) */
  studentTurns: string[];
  reply: string;
}

/** Реплик студента в контексте проверки не больше, чем на ~1500 символов (с конца). */
const STUDENT_CONTEXT_CHARS = 1500;

export function buildLeakCheckRequest(input: LeakCheckInput): CompletionRequest {
  const turns: string[] = [];
  let len = 0;
  for (let i = input.studentTurns.length - 1; i >= 0; i--) {
    const t = input.studentTurns[i]!;
    if (len + t.length > STUDENT_CONTEXT_CHARS && turns.length > 0) break;
    turns.unshift(t.length > STUDENT_CONTEXT_CHARS ? t.slice(0, STUDENT_CONTEXT_CHARS) : t);
    len += t.length;
  }
  return {
    model: input.model,
    purpose: 'judge',
    reasoningEffort: 'low',
    maxTokens: LEAK_CHECK_MAX_TOKENS,
    cacheSystem: true,
    system: leakCheckSystemPrompt({ rubricKeyPoints: input.rubricKeyPoints, referenceSolution: input.referenceSolution }),
    messages: [{ role: 'user', content: leakCheckUserMessage({ studentTurns: turns, reply: input.reply }) }],
  };
}

class LeakCheckTimeout extends Error {}

/**
 * Выполняет проверку с жёстким таймаутом. Никогда не бросает: таймаут и сбой
 * возвращаются как результат (решение о выпуске — leakDecision).
 */
export async function runLeakCheck(
  input: LeakCheckInput,
  deps: { call: StructuredCall<LeakCheckOutput>; timeoutMs: number },
): Promise<LeakCheckRun> {
  const started = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new LeakCheckTimeout('leak check timeout'));
    }, deps.timeoutMs);
  });
  try {
    const req = { ...buildLeakCheckRequest(input), signal: controller.signal };
    const { data, result } = await Promise.race([deps.call(req), timeout]);
    return { leaks: data.leaks, reason: data.reason.slice(0, 200), ms: Date.now() - started, timeout: false, usage: result.usage };
  } catch (err) {
    const ms = Date.now() - started;
    if (err instanceof LeakCheckTimeout) return { leaks: false, reason: '', ms, timeout: true, usage: null };
    return { leaks: false, reason: '', ms, timeout: false, error: (err as Error)?.message?.slice(0, 200) ?? 'error', usage: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type LeakFailMode = 'closed' | 'open';

export interface LeakDecision {
  /** Выпускать ли реплику тьютора как есть */
  release: boolean;
  /** Реплика выпущена без полноценной проверки (fail-open) */
  flagged: boolean;
  cause: 'ok' | 'leak' | 'timeout' | 'error';
}

/**
 * Решение о выпуске реплики. Утечка — никогда не выпускаем. Таймаут/сбой проверки:
 * closed — не выпускаем (замена безопасным вопросом), open — выпускаем с пометкой.
 */
export function leakDecision(r: Pick<LeakCheckRecord, 'leaks' | 'timeout' | 'error'>, failMode: LeakFailMode): LeakDecision {
  if (r.leaks) return { release: false, flagged: false, cause: 'leak' };
  if (r.timeout || r.error) {
    const cause = r.timeout ? 'timeout' : 'error';
    return failMode === 'open' ? { release: true, flagged: true, cause } : { release: false, flagged: false, cause };
  }
  return { release: true, flagged: false, cause: 'ok' };
}
