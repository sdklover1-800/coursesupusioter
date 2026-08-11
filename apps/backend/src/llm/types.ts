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
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionResult {
  text: string;
  usage: TokenUsage;
  model: string;
  /** Псевдо-провайдерная метка для воспроизводимости (FR-R.7). */
  provider: string;
}

export type StreamDelta = (chunk: string) => void;

/** Адаптер конкретного провайдера. */
export interface LlmAdapter {
  readonly provider: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  /** Потоковый вывод (NFR-1.4). Необязателен — при отсутствии шлюз эмулирует. */
  streamComplete?(req: CompletionRequest, onDelta: StreamDelta): Promise<CompletionResult>;
}
