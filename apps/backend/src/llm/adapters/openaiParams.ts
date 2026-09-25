import type OpenAI from 'openai';
import type { CompletionRequest, LlmPurpose } from '../types.js';

/** Чистая сборка параметров Chat Completions — без env, чтобы покрывать тестами. */

export type ReasoningEffort = '' | 'none' | 'low' | 'medium' | 'high' | 'xhigh';

export interface OpenAIParamOptions {
  /** Уровень рассуждений по назначению вызова; '' — параметр не передаётся. */
  effort: Record<LlmPurpose, ReasoningEffort>;
  /** Официальный API OpenAI (иначе — совместимый эндпоинт со старыми параметрами). */
  officialApi: boolean;
}

/**
 * Запас на скрытые токены рассуждений: у reasoning-моделей они входят в
 * max_completion_tokens, и без запаса ответ может прийти пустым (finish=length).
 */
const REASONING_HEADROOM: Record<Exclude<ReasoningEffort, '' | 'none'>, number> = {
  low: 2048,
  medium: 6144,
  high: 12288,
  xhigh: 24576,
};

/** GPT-5.x и o-серия поддерживают reasoning_effort; *-chat-* — нет. */
export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/.test(model) && !model.includes('-chat');
}

/**
 * Параметры Chat Completions под конкретную модель. Проверено на gpt-5.4-mini / gpt-5.5:
 * - `max_tokens` отклоняется → только `max_completion_tokens`;
 * - `temperature` ≠ 1 допустима лишь при reasoning_effort=none;
 * - `minimal` не поддерживается (none | low | medium | high | xhigh);
 * - response_format=json_object требует слова «json» в сообщениях.
 */
export function buildChatParams(req: CompletionRequest, opts: OpenAIParamOptions) {
  const purpose = req.purpose ?? 'generation';
  const maxTokens = req.maxTokens ?? 1024;
  const reasoning = opts.officialApi && isReasoningModel(req.model);
  const effort = reasoning ? opts.effort[purpose] : '';
  const thinking = effort !== '' && effort !== 'none';

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  let system = req.system ?? '';
  if (req.jsonMode && !mentionsJson(req)) {
    system = `${system}\n\nRespond with a single valid JSON object only.`.trim();
  }
  if (system) messages.push({ role: 'system', content: system });
  for (const m of req.messages) {
    if (m.role === 'system') messages.push({ role: 'system', content: m.content });
    else if (m.role === 'assistant') messages.push({ role: 'assistant', content: m.content });
    else messages.push({ role: 'user', content: m.content });
  }

  return {
    model: req.model,
    messages,
    ...(opts.officialApi
      ? { max_completion_tokens: thinking ? maxTokens + REASONING_HEADROOM[effort] : maxTokens }
      : { max_tokens: maxTokens }),
    // temperature ≠ 1 reasoning-модели принимают только без рассуждений.
    ...(thinking ? {} : { temperature: req.temperature ?? 0.4 }),
    ...(effort ? { reasoning_effort: effort } : {}),
    ...(req.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
  };
}

function mentionsJson(req: CompletionRequest): boolean {
  if (req.system && /json/i.test(req.system)) return true;
  return req.messages.some((m) => /json/i.test(m.content));
}
