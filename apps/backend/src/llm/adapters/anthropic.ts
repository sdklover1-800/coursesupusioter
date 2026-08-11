import Anthropic from '@anthropic-ai/sdk';
import type { CompletionRequest, CompletionResult, LlmAdapter, StreamDelta } from '../types.js';
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
    const stream = this.client.messages.stream(this.buildParams(req));
    const final = await stream.finalMessage();
    const text = final.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return {
      text,
      usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens },
      model: final.model,
      provider: this.provider,
    };
  }

  async streamComplete(req: CompletionRequest, onDelta: StreamDelta): Promise<CompletionResult> {
    const stream = this.client.messages.stream(this.buildParams(req));
    stream.on('text', (delta) => onDelta(delta));
    const final = await stream.finalMessage();
    const text = final.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return {
      text,
      usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens },
      model: final.model,
      provider: this.provider,
    };
  }
}
