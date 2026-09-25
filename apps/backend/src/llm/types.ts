/** Контракты LLM-шлюза (§5.1, §9.3). Провайдер-агностично. */

export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface CompletionRequest {
  /** Задача-специфичная модель (генерация / диалог / судья) — раздельный выбор (§5.6). */
  model: string;
  system?: string;
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Требовать строго структурированный JSON-ответ (§5.2). */
  jsonMode?: boolean;
  /** Кешировать статичную часть system-инструкции (§5.6 prompt caching). */
  cacheSystem?: boolean;
  /**
   * Назначение вызова (§5.6): провайдер подбирает под него режим модели —
   * например, уровень рассуждений у reasoning-моделей OpenAI. По умолчанию — generation.
   */
  purpose?: LlmPurpose;
  /**
   * Уровень рассуждений для ЭТОГО вызова — перекрывает уровень по назначению
   * (env OPENAI_REASONING_*), напр. подтверждающий вызов судьи (A4, A13.3).
   * Учитывается только у reasoning-моделей официального API.
   */
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  /**
   * Отмена вызова по таймауту вызывающей стороны (проверка утечки, A21):
   * шлюз не повторяет отменённый вызов, адаптер прерывает HTTP-запрос.
   */
  signal?: AbortSignal;
}

export type LlmPurpose = 'generation' | 'dialog' | 'judge';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Из inputTokens — кешированные входные токены (дешевле, учёт стоимости) */
  cachedInputTokens?: number;
  /** Из outputTokens — скрытые токены рассуждений */
  reasoningTokens?: number;
}

export interface CompletionResult {
  text: string;
  usage: TokenUsage;
  model: string;
  /** Псевдо-провайдерная метка для воспроизводимости (FR-R.7). */
  provider: string;
  /** Причина остановки генерации от провайдера (stop | length | ...), если известна. */
  finishReason?: string;
}

export type StreamDelta = (chunk: string) => void;

/** Адаптер конкретного провайдера. */
export interface LlmAdapter {
  readonly provider: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  /** Потоковый вывод (NFR-1.4). Необязателен — при отсутствии шлюз эмулирует. */
  streamComplete?(req: CompletionRequest, onDelta: StreamDelta): Promise<CompletionResult>;
}
