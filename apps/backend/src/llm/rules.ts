/**
 * Чистые правила оркестрации сократической сессии (§5.4, FR-6.4, FR-6.11).
 * Вынесены из orchestrator.ts, чтобы авторитетную серверную логику вердикта и
 * сигналы целостности можно было тестировать изолированно, без БД и LLM.
 */
import { INTEGRITY_THRESHOLDS, IntegrityFlagType, type SessionEndReason, type SessionStatus, type VerdictCode } from '@edu/shared';

export type TurnOutcome = 'PASSED' | 'FAILED_LIMIT' | 'FAILED_CEILING' | 'CONTINUE';

/** Запас под реплику тьютора при проверке потолка ДО её генерации (калибровка A.4, находка k). */
export const CEILING_TUTOR_MARGIN = 1200;
/** Доля потолка, после которой сессия помечается nearCeiling (калибровка A.4). */
export const NEAR_CEILING_RATIO = 0.8;

/* ── Вердикт судьи: страж и PASS-гейт (A2) ─────────────────────── */

/** Минимум вывода судьи, нужный для решения о вердикте. */
export interface JudgeVerdict {
  student_reached_answer: boolean;
  criterion_missing: readonly string[];
}

/**
 * Страж согласованности: «ответ достигнут» при непустом criterion_missing — это
 * противоречие модели, и оно трактуется как false (ложный PASS хуже ложного FAIL).
 */
export function guardVerdict(v: JudgeVerdict): boolean {
  return v.student_reached_answer === true && v.criterion_missing.length === 0;
}

/**
 * PASS-гейт (A2): основной вызов (low) и подтверждающий (medium) должны оба сказать
 * «достигнут», и у обоих criterion_missing пуст. Без подтверждения (выключено env) —
 * достаточно основного вызова со стражем.
 */
export function passGate(primary: JudgeVerdict, confirm: JudgeVerdict | null, confirmEnabled: boolean): boolean {
  if (!guardVerdict(primary)) return false;
  if (!confirmEnabled) return true;
  return confirm !== null && guardVerdict(confirm);
}

/* ── Исход хода ─────────────────────────────────────────────────── */

/**
 * Решение об исходе хода ПОСЛЕ оценки судьи и ДО реплики тьютора.
 * Приоритет: достигнут ответ → лимит реплик (основной) → токен-потолок (предохранитель).
 * Потолок проверяется с запасом под предстоящую реплику тьютора (находка k).
 *
 * @param aiMessageCount число реплик тьютора ДО реплики текущего хода
 * @param tokensUsedBeforeTutor накопленный расход (основной судья + тьютор) с учётом судьи этого хода
 */
export function decideTurnOutcome(p: {
  reached: boolean;
  aiMessageCount: number;
  maxAiMessages: number;
  tokensUsedBeforeTutor: number;
  tokenCeiling: number;
  tutorMargin?: number;
}): TurnOutcome {
  // Мгновенно данный верный ответ засчитывается (§5.5), даже на последней реплике.
  if (p.reached) return 'PASSED';
  // Лимит реплик — основная и языконезависимая метрика (FR-6.4).
  if (p.aiMessageCount >= p.maxAiMessages) return 'FAILED_LIMIT';
  // Токен-потолок — предохранитель стоимости (§5.6): места под реплику тьютора нет.
  if (p.tokensUsedBeforeTutor + (p.tutorMargin ?? CEILING_TUTOR_MARGIN) >= p.tokenCeiling) return 'FAILED_CEILING';
  return 'CONTINUE';
}

/** Сессия подошла к потолку (≥ 80 %) — флаг для мониторинга калибровки. */
export function isNearCeiling(tokensUsed: number, tokenCeiling: number): boolean {
  return tokenCeiling > 0 && tokensUsed >= tokenCeiling * NEAR_CEILING_RATIO;
}

/* ── Коды вердикта (находка f) ──────────────────────────────────── */

export type FinalOutcome =
  | { kind: 'PASSED'; endReason?: 'PASSED' | 'DONE' | 'OTHER' }
  | { kind: 'FAILED_LIMIT' }
  | { kind: 'FAILED_CEILING' }
  | { kind: 'ENDED_BY_STUDENT'; endReason: 'DONE' | 'OTHER' }
  | { kind: 'ABANDONED'; paused: boolean };

export interface VerdictMapping {
  status: Exclude<SessionStatus, 'IN_PROGRESS'>;
  verdictCode: VerdictCode;
  endReason: Exclude<SessionEndReason, 'TECH_ISSUE'>;
}

/**
 * Итог → (статус, verdictCode, endReason). ENDED_BY_STUDENT хранится как FAILED:
 * задание не выполнено; различает причины именно verdictCode. TECH_ISSUE итогом не бывает.
 */
export function mapVerdict(o: FinalOutcome): VerdictMapping {
  switch (o.kind) {
    case 'PASSED':
      return { status: 'PASSED', verdictCode: 'PASSED', endReason: o.endReason ?? 'PASSED' };
    case 'FAILED_LIMIT':
      return { status: 'FAILED', verdictCode: 'FAILED_LIMIT', endReason: 'LIMIT' };
    case 'FAILED_CEILING':
      return { status: 'FAILED', verdictCode: 'FAILED_CEILING', endReason: 'CEILING' };
    case 'ENDED_BY_STUDENT':
      return { status: 'FAILED', verdictCode: 'ENDED_BY_STUDENT', endReason: o.endReason };
    case 'ABANDONED':
      return { status: 'ABANDONED', verdictCode: 'ABANDONED', endReason: o.paused ? 'IDLE_AFTER_PAUSE' : 'IDLE' };
  }
}

/* ── Реплика тьютора: замены и лимит реплик ─────────────────────── */

/** Почему реплика тьютора заменена безопасным наводящим вопросом. */
export type FallbackCause = 'verbatim_leak' | 'semantic_leak' | 'leak_timeout' | 'leak_error' | 'length' | 'over_limit';

/**
 * Считается ли реплика тьютора в лимит реплик. Замена из-за технического сбоя
 * (таймаут/ошибка проверки, обрыв по длине) студенту не засчитывается — это не его
 * ход, а сбой системы (A21, §5.7). Замена из-за утечки — обычная реплика хода.
 */
export function tutorReplyCounts(fallback: FallbackCause | null): boolean {
  return fallback === null || fallback === 'verbatim_leak' || fallback === 'semantic_leak';
}

/* ── Контекст тьютора (A3) ──────────────────────────────────────── */

/**
 * Сколько последних реплик СТУДЕНТА (с репликами тьютора между ними) видит тьютор.
 * История переотправляется на каждом ходе, и без окна рост контекста в длинном диалоге
 * съедал до 0,9 токен-потолка en к 24-й реплике (замер харнесса). Окно влияет только на
 * тьютора (поддержка): вердикт выносит судья по полному транскрипту.
 */
export const TUTOR_WINDOW_STUDENT_TURNS = 8;

/** Окно истории для тьютора: начинается с реплики студента, содержит последние N его реплик. */
export function tutorWindow<T extends { role: string }>(lines: readonly T[], studentTurns = TUTOR_WINDOW_STUDENT_TURNS): T[] {
  let seen = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.role === 'STUDENT' && ++seen === studentTurns) return lines.slice(i);
  }
  return [...lines];
}

/* ── Стоимость (A3) ─────────────────────────────────────────────── */

export interface UsageTotals {
  input: number;
  cachedInput: number;
  output: number;
}

/** USD: (некешированный вход × цена входа + кешированный × цена кеша + выход × цена выхода) / 1M. */
export function costUsd(u: UsageTotals, price: { input: number; cachedInput: number; output: number }): number {
  const cached = Math.min(u.cachedInput, u.input);
  return ((u.input - cached) * price.input + cached * price.cachedInput + u.output * price.output) / 1_000_000;
}

/* ── Сигналы целостности (FR-6.11) ──────────────────────────────── */

export interface IntegrityFlag {
  type: string;
  detail?: string;
}

/**
 * Сигналы целостности (FR-6.11). НЕ блокируют сдачу — только фиксируются.
 * @param maxChars конфигурируемый предел длины сообщения студента (FR-6.10)
 */
export function detectIntegritySignals(p: {
  text: string;
  typingMs?: number;
  maxChars: number;
}): IntegrityFlag[] {
  const flags: IntegrityFlag[] = [];

  // Аномально быстрый ввод длинного текста (вероятная вставка извне).
  if (p.text.length >= INTEGRITY_THRESHOLDS.longPasteMinChars && p.typingMs && p.typingMs > 0) {
    const cps = p.text.length / (p.typingMs / 1000);
    if (cps > INTEGRITY_THRESHOLDS.fastPasteCharsPerSecond) {
      flags.push({ type: IntegrityFlagType.FAST_LONG_PASTE, detail: `${cps.toFixed(0)} симв/с` });
    }
  }

  // Сообщение у верхней границы длины.
  if (p.text.length >= p.maxChars * INTEGRITY_THRESHOLDS.nearMaxLengthRatio) {
    flags.push({ type: IntegrityFlagType.NEAR_MAX_LENGTH });
  }

  return flags;
}
