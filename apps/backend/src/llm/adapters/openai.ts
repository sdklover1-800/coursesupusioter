import OpenAI from 'openai';
import type { CompletionRequest, CompletionResult, LlmAdapter, StreamDelta } from '../types.js';
import { env } from '../../config/env.js';
import { buildChatParams, type OpenAIParamOptions } from './openaiParams.js';

/**
 * Адаптер OpenAI-совместимого API (GPT-mini-класс — основной кандидат §5.1
 * при важности надёжного казахского). Также подходит для локальных/иных
 * OpenAI-совместимых эндпоинтов через OPENAI_BASE_URL.
 */
export class OpenAIAdapter implements LlmAdapter {
  readonly provider = 'openai';
  private client: OpenAI;
  private opts: OpenAIParamOptions;

  constructor() {
    if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY не задан');
    // Встроенный fetch Node вместо node-fetch из SDK 4.x: тот на свежих Node
    // обрывает чтение ответа (FetchError: Premature close).
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL, fetch: globalThis.fetch });
    this.opts = {
      effort: {
        generation: env.OPENAI_REASONING_GENERATION,
        dialog: env.OPENAI_REASONING_DIALOG,
        judge: env.OPENAI_REASONING_JUDGE,
      },
      officialApi: /(^|\.)api\.openai\.com/.test(new URL(env.OPENAI_BASE_URL).host),
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    // SDK 4.x не знает значений none/xhigh у reasoning_effort — API их принимает.
    const params = buildChatParams(req, this.opts) as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
    const res = await this.client.chat.completions.create(params);
    const choice = res.choices[0];
    const text = choice?.message?.content ?? '';
    // Весь бюджет ушёл на рассуждения — пустой ответ не должен выглядеть как успех;
    // шлюз повторит запрос, а в логе будет понятная причина.
    if (!text && choice?.finish_reason === 'length') {
      throw new Error(`OpenAI: пустой ответ — исчерпан max_completion_tokens (модель ${res.model})`);
    }
    return {
      text,
      usage: {
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
      },
      model: res.model,
      provider: this.provider,
    };
  }

  async streamComplete(req: CompletionRequest, onDelta: StreamDelta): Promise<CompletionResult> {
    const params = {
      ...buildChatParams(req, this.opts),
      stream: true,
      stream_options: { include_usage: true },
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming;
    const stream = await this.client.chat.completions.create(params);
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
