import type { ZodTypeAny, output } from 'zod';
import type { CompletionRequest, CompletionResult, LlmAdapter, StreamDelta } from './types.js';
import { MockAdapter } from './adapters/mock.js';
import { AnthropicAdapter } from './adapters/anthropic.js';
import { OpenAIAdapter } from './adapters/openai.js';
import { pseudonymizeMessages, pseudonymizeText } from './pseudonymize.js';
import { Semaphore } from './semaphore.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { Errors } from '../lib/errors.js';
import { llmTokens, llmCalls } from '../lib/metrics.js';
import { acquireLlmSlot, releaseLlmSlot } from './globalLimit.js';

function buildAdapter(): LlmAdapter {
  switch (env.LLM_PROVIDER) {
    case 'anthropic':
      return new AnthropicAdapter();
    case 'openai':
      return new OpenAIAdapter();
    default:
      return new MockAdapter();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * LLM-шлюз (§5.1, §9.3): единственная точка выхода данных наружу.
 * Обязанности: псевдонимизация (DP-5), учёт токенов, ретраи с backoff (§5.7),
 * ограничение параллелизма (NFR-1.5), извлечение и ремонт структурированного JSON (§5.2).
 */
export class LlmGateway {
  private adapter: LlmAdapter;
  private semaphore: Semaphore;

  constructor() {
    this.adapter = buildAdapter();
    this.semaphore = new Semaphore(env.LLM_MAX_CONCURRENCY);
    logger.info({ provider: this.adapter.provider, zeroRetention: env.LLM_ZERO_RETENTION }, 'LLM-шлюз инициализирован');
  }

  get provider(): string {
    return this.adapter.provider;
  }

  /** Псевдонимизация исходящего контекста (DP-5). */
  private scrub(req: CompletionRequest): CompletionRequest {
    const scrubbedSystem = req.system ? pseudonymizeText(req.system).text : req.system;
    const { messages } = pseudonymizeMessages(req.messages);
    return { ...req, system: scrubbedSystem, messages: messages as CompletionRequest['messages'] };
  }

  /** Локальный семафор + глобальный (Redis) лимит параллелизма LLM (NFR-1.5). */
  private gated<T>(fn: () => Promise<T>): Promise<T> {
    return this.semaphore.run(async () => {
      const token = await acquireLlmSlot();
      try {
        return await fn();
      } finally {
        await releaseLlmSlot(token);
      }
    });
  }

  private async withRetry<T>(fn: () => Promise<T>, label: string, attempts = 4): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.gated(fn);
      } catch (err) {
        lastErr = err;
        const delay = Math.min(8000, 400 * 2 ** i) + Math.floor(Math.random() * 200);
        logger.warn({ err, label, attempt: i + 1, delay }, 'Ошибка вызова LLM — повтор с backoff');
        await sleep(delay);
      }
    }
    logger.error({ err: lastErr, label }, 'LLM недоступна после ретраев');
    throw Errors.upstream('ИИ-сервис временно недоступен');
  }

  /** Обычная генерация текста. */
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return this.completeScrubbed(this.scrub(req));
  }

  /** Внутренний вызов адаптера по УЖЕ псевдонимизированному запросу (без повторного scrub). */
  private completeScrubbed(scrubbed: CompletionRequest): Promise<CompletionResult> {
    return this.withRetry(async () => this.meter(await this.adapter.complete(scrubbed)), 'complete');
  }

  /** Учёт расхода токенов и числа вызовов LLM (NFR-5.2). */
  private meter(res: CompletionResult): CompletionResult {
    llmTokens.inc({ direction: 'input', provider: this.provider }, res.usage.inputTokens);
    llmTokens.inc({ direction: 'output', provider: this.provider }, res.usage.outputTokens);
    llmCalls.inc({ provider: this.provider, label: 'complete', outcome: 'ok' });
    return res;
  }

  /**
   * Потоковая генерация (NFR-1.4). Если адаптер не умеет — эмулируем.
   *
   * Аудит M2: БЕЗ ретраев. Стриминг нельзя безопасно повторять — часть чанков
   * уже отправлена клиенту и накоплена вызывающей стороной; повтор продублировал
   * бы контент и испортил сохранённую реплику. При обрыве ход завершается ошибкой,
   * которую оркестратор трактует как техническую (сессия не проваливается, §5.7),
   * и студент повторяет ход целиком.
   */
  async stream(req: CompletionRequest, onDelta: StreamDelta): Promise<CompletionResult> {
    const scrubbed = this.scrub(req);
    if (this.adapter.streamComplete) {
      return this.gated(async () => this.meter(await this.adapter.streamComplete!(scrubbed, onDelta)));
    }
    const res = await this.completeScrubbed(scrubbed); // L3: не псевдонимизируем повторно
    onDelta(res.text);
    return res;
  }

  /**
   * Структурированный вывод: запрос → извлечение JSON → валидация по Zod-схеме →
   * при неудаче «ремонт» (повторный запрос с указанием ошибки) (§5.2, §5.7).
   */
  async completeStructured<S extends ZodTypeAny>(
    req: CompletionRequest,
    schema: S,
    label: string,
  ): Promise<{ data: output<S>; result: CompletionResult }> {
    const jsonReq: CompletionRequest = { ...req, jsonMode: true };
    let result = await this.complete(jsonReq);
    // L2: суммарный расход токенов (первый вызов + ремонт), иначе токены ремонта теряются.
    let spentIn = result.usage.inputTokens;
    let spentOut = result.usage.outputTokens;
    let parsed = tryParseJson(result.text);
    let validation = parsed !== undefined ? schema.safeParse(parsed) : undefined;

    if (validation?.success) return { data: validation.data, result };

    // Ремонт: один повтор с явным указанием ошибки схемы
    const repairReq: CompletionRequest = {
      ...jsonReq,
      messages: [
        ...req.messages,
        {
          role: 'user',
          content:
            'Предыдущий ответ не прошёл валидацию схемы. Верни ТОЛЬКО валидный JSON строго по требуемой структуре, без пояснений и markdown.',
        },
      ],
    };
    result = await this.complete(repairReq);
    spentIn += result.usage.inputTokens;
    spentOut += result.usage.outputTokens;
    result = { ...result, usage: { inputTokens: spentIn, outputTokens: spentOut } };
    parsed = tryParseJson(result.text);
    validation = parsed !== undefined ? schema.safeParse(parsed) : undefined;
    if (validation?.success) return { data: validation.data, result };

    // Диагностика должна называть причину: обрыв по лимиту токенов и ошибка схемы
    // выглядят одинаково («некорректный формат»), но чинятся по-разному.
    const truncated = parsed === undefined;
    logger.error(
      {
        label,
        reason: truncated ? 'JSON не распарсился (вероятен обрыв по max_tokens)' : 'не прошёл схему',
        textLength: result.text.length,
        issues: validation && !validation.success ? validation.error.issues.slice(0, 8) : undefined,
        head: result.text.slice(0, 200),
        tail: result.text.slice(-200),
      },
      'Структурированный вывод LLM невалиден после ремонта',
    );
    throw Errors.upstream(
      truncated
        ? 'ИИ не уложился в лимит ответа — уменьшите число вопросов или увеличьте лимит.'
        : 'ИИ вернул некорректный формат данных. Повторите генерацию.',
    );
  }
}

/** Извлекает JSON из ответа (снимает markdown-огранку ```json ... ```). */
function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : trimmed;
  // Берём от первой { или [ до последней } или ]
  const start = candidate.search(/[{[]/);
  const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
  if (start === -1 || end === -1 || end < start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** Singleton-шлюз. */
let _gateway: LlmGateway | null = null;
export function getGateway(): LlmGateway {
  if (!_gateway) _gateway = new LlmGateway();
  return _gateway;
}
