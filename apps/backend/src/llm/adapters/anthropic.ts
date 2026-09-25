import Anthropic from '@anthropic-ai/sdk';
import type { CompletionRequest, CompletionResult, LlmAdapter, StreamDelta, TokenUsage } from '../types.js';
import { env } from '../../config/env.js';

/**
 * Адаптер Anthropic (Claude Haiku-класс — кандидат §5.1: быстрый, недорогой,
 * хорошее следование инструкциям, что важно для правила «не раскрывать ответ»).
 * Поддержка prompt caching статичной системной части (§5.6).
 */
export class AnthropicAdapter implements LlmAdapter {
  readonly provider = 'anthropic';
  private client: Anthropic;

  constructor() {
    if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY не задан');
    this.client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      // Генерация материалов — длинные запросы (большие расшифровки на входе).
      timeout: 10 * 60 * 1000,
      // Ретраи с backoff делает LLM-шлюз; на уровне SDK оставляем минимум,
      // чтобы не множить попытки лавинообразно.
      maxRetries: 1,
    });
  }

  private buildParams(req: CompletionRequest): Anthropic.MessageCreateParams {
    const system = req.system
      ? [
          {
            type: 'text' as const,
            text: req.system,
            ...(req.cacheSystem ? { cache_control: { type: 'ephemeral' as const } } : {}),
          },
        ]
      : undefined;

    const messages: Anthropic.MessageParam[] = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    return {
      model: req.model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.4,
      system,
      messages,
    };
  }

  /**
   * Нестримовый по смыслу вызов, но ВНУТРИ выполняется потоком.
   * Причина: при больших входах и заметном max_tokens обычный запрос
   * рвётся с `FetchError: Premature close` — соединение простаивает, пока
   * модель генерирует. Стриминг держит соединение живым; результат идентичен.
   */
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const stream = this.client.messages.stream(this.buildParams(req), req.signal ? { signal: req.signal } : undefined);
    const final = await stream.finalMessage();
    return this.toResult(final);
  }

  async streamComplete(req: CompletionRequest, onDelta: StreamDelta): Promise<CompletionResult> {
    const stream = this.client.messages.stream(this.buildParams(req), req.signal ? { signal: req.signal } : undefined);
    stream.on('text', (delta) => onDelta(delta));
    const final = await stream.finalMessage();
    return this.toResult(final);
  }

  /** Итог вызова: текст, токены (с кешированными, A3) и причина остановки в терминах OpenAI. */
  private toResult(final: Anthropic.Message): CompletionResult {
    const text = final.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const cacheRead = final.usage.cache_read_input_tokens ?? 0;
    const cacheWrite = final.usage.cache_creation_input_tokens ?? 0;
    // У Anthropic input_tokens НЕ включает кешированные — приводим к контракту TokenUsage
    // (inputTokens = весь вход, cachedInputTokens — его кешированная часть).
    const usage: TokenUsage = {
      inputTokens: final.usage.input_tokens + cacheRead + cacheWrite,
      outputTokens: final.usage.output_tokens,
      cachedInputTokens: cacheRead,
      reasoningTokens: 0,
    };
    const finishReason = final.stop_reason === 'max_tokens' ? 'length' : final.stop_reason === 'end_turn' ? 'stop' : (final.stop_reason ?? undefined);
    return { text, usage, model: final.model, provider: this.provider, finishReason };
  }
}
