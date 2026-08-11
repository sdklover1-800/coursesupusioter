import OpenAI from 'openai';
import type { CompletionRequest, CompletionResult, LlmAdapter, StreamDelta } from '../types.js';
import { env } from '../../config/env.js';

/**
 * Адаптер OpenAI-совместимого API (GPT-mini-класс — основной кандидат §5.1
 * при важности надёжного казахского). Также подходит для локальных/иных
 * OpenAI-совместимых эндпоинтов через OPENAI_BASE_URL.
 */
export class OpenAIAdapter implements LlmAdapter {
  readonly provider = 'openai';
  private client: OpenAI;

  constructor() {
    if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY не задан');
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL });
  }

  private buildMessages(req: CompletionRequest): OpenAI.Chat.ChatCompletionMessageParam[] {
    const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (req.system) msgs.push({ role: 'system', content: req.system });
    for (const m of req.messages) {
      if (m.role === 'system') msgs.push({ role: 'system', content: m.content });
      else if (m.role === 'assistant') msgs.push({ role: 'assistant', content: m.content });
      else msgs.push({ role: 'user', content: m.content });
    }
    return msgs;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const res = await this.client.chat.completions.create({
      model: req.model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.4,
      messages: this.buildMessages(req),
      ...(req.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    });
    return {
      text: res.choices[0]?.message?.content ?? '',
      usage: {
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
      },
      model: res.model,
      provider: this.provider,
    };
  }

  async streamComplete(req: CompletionRequest, onDelta: StreamDelta): Promise<CompletionResult> {
    const stream = await this.client.chat.completions.create({
      model: req.model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.4,
      messages: this.buildMessages(req),
      stream: true,
      stream_options: { include_usage: true },
    });
    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let model = req.model;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        text += delta;
        onDelta(delta);
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }
      if (chunk.model) model = chunk.model;
    }
    return { text, usage: { inputTokens, outputTokens }, model, provider: this.provider };
  }
}
