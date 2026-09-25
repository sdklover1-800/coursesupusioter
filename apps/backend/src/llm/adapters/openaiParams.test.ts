import { describe, expect, it } from 'vitest';
import { buildChatParams, isReasoningModel, type OpenAIParamOptions } from './openaiParams.js';

const opts: OpenAIParamOptions = {
  effort: { generation: 'low', dialog: 'none', judge: 'low' },
  officialApi: true,
};
const msg = [{ role: 'user' as const, content: 'Привет' }];

describe('isReasoningModel', () => {
  it('распознаёт GPT-5.x и o-серию, но не chat-варианты и не GPT-4', () => {
    expect(isReasoningModel('gpt-5.4-mini')).toBe(true);
    expect(isReasoningModel('gpt-5.5')).toBe(true);
    expect(isReasoningModel('o4-mini')).toBe(true);
    expect(isReasoningModel('gpt-5.2-chat-latest')).toBe(false);
    expect(isReasoningModel('gpt-4.1-mini')).toBe(false);
  });
});

describe('buildChatParams', () => {
  it('никогда не шлёт max_tokens в официальный API', () => {
    const p = buildChatParams({ model: 'gpt-5.4-mini', messages: msg, maxTokens: 500 }, opts);
    expect(p).not.toHaveProperty('max_tokens');
    expect(p).toHaveProperty('max_completion_tokens');
  });

  it('с рассуждениями: запас на reasoning-токены и без temperature', () => {
    const p = buildChatParams({ model: 'gpt-5.4-mini', messages: msg, maxTokens: 400, purpose: 'judge', temperature: 0.2 }, opts);
    expect(p.reasoning_effort).toBe('low');
    expect(p).toHaveProperty('max_completion_tokens', 400 + 2048);
    expect(p).not.toHaveProperty('temperature');
  });

  it('диалог без рассуждений: effort=none, temperature сохраняется, бюджет без запаса', () => {
    const p = buildChatParams({ model: 'gpt-5.4-mini', messages: msg, maxTokens: 300, purpose: 'dialog' }, opts);
    expect(p.reasoning_effort).toBe('none');
    expect(p.temperature).toBe(0.4);
    expect(p).toHaveProperty('max_completion_tokens', 300);
  });

  it('reasoningEffort вызова перекрывает уровень по назначению', () => {
    const p = buildChatParams(
      { model: 'gpt-5.4-mini', messages: msg, maxTokens: 400, purpose: 'judge', reasoningEffort: 'medium' },
      opts,
    );
    expect(p.reasoning_effort).toBe('medium');
    expect(p).toHaveProperty('max_completion_tokens', 400 + 6144);
    expect(p).not.toHaveProperty('temperature');
  });

  it('без reasoningEffort остаётся уровень по назначению', () => {
    const judge = buildChatParams({ model: 'gpt-5.4-mini', messages: msg, purpose: 'judge' }, opts);
    const dialog = buildChatParams({ model: 'gpt-5.4-mini', messages: msg, purpose: 'dialog' }, opts);
    expect(judge.reasoning_effort).toBe('low');
    expect(dialog.reasoning_effort).toBe('none');
  });

  it('тьютор (калибровка A.2): temperature из DIALOG_TEMPERATURE при effort none, лимит без запаса', () => {
    const p = buildChatParams({ model: 'gpt-5.4-mini', messages: msg, maxTokens: 250, purpose: 'dialog', temperature: 0.25 }, opts);
    expect(p.temperature).toBe(0.25);
    expect(p.reasoning_effort).toBe('none');
    expect(p).toHaveProperty('max_completion_tokens', 250);
  });

  it('проверка утечки (A21): судья low, 60 токенов вывода + запас на рассуждения', () => {
    const p = buildChatParams({ model: 'gpt-5.4-mini', messages: msg, maxTokens: 60, purpose: 'judge', reasoningEffort: 'low' }, opts);
    expect(p.reasoning_effort).toBe('low');
    expect(p).toHaveProperty('max_completion_tokens', 60 + 2048);
  });

  it('reasoningEffort не передаётся модели без рассуждений', () => {
    const p = buildChatParams({ model: 'gpt-4.1-mini', messages: msg, reasoningEffort: 'high' }, opts);
    expect(p).not.toHaveProperty('reasoning_effort');
    expect(p.temperature).toBe(0.4);
  });

  it('по умолчанию назначение — generation', () => {
    const p = buildChatParams({ model: 'gpt-5.4-mini', messages: msg }, opts);
    expect(p.reasoning_effort).toBe('low');
  });

  it('модель без рассуждений: нет reasoning_effort, есть temperature', () => {
    const p = buildChatParams({ model: 'gpt-4.1-mini', messages: msg, purpose: 'judge' }, opts);
    expect(p).not.toHaveProperty('reasoning_effort');
    expect(p.temperature).toBe(0.4);
  });

  it('пустой уровень — параметр не передаётся', () => {
    const p = buildChatParams({ model: 'gpt-5.4-mini', messages: msg }, { ...opts, effort: { ...opts.effort, generation: '' } });
    expect(p).not.toHaveProperty('reasoning_effort');
    expect(p.temperature).toBe(0.4);
  });

  it('совместимый эндпоинт: старый max_tokens и без reasoning_effort', () => {
    const p = buildChatParams({ model: 'gpt-5.4-mini', messages: msg, maxTokens: 700 }, { ...opts, officialApi: false });
    expect(p).toHaveProperty('max_tokens', 700);
    expect(p).not.toHaveProperty('max_completion_tokens');
    expect(p).not.toHaveProperty('reasoning_effort');
  });

  it('JSON-режим: добавляет слово json, если его нет в сообщениях', () => {
    const p = buildChatParams({ model: 'gpt-5.4-mini', system: 'Сгенерируй вопрос', messages: msg, jsonMode: true }, opts);
    expect(p.response_format).toEqual({ type: 'json_object' });
    expect(p.messages[0]).toMatchObject({ role: 'system' });
    expect(String(p.messages[0]!.content)).toMatch(/json/i);
  });

  it('JSON-режим: не трогает system, если json уже упомянут', () => {
    const system = 'Верни JSON по схеме';
    const p = buildChatParams({ model: 'gpt-5.4-mini', system, messages: msg, jsonMode: true }, opts);
    expect(p.messages[0]!.content).toBe(system);
  });

  it('роли сообщений переносятся как есть', () => {
    const p = buildChatParams(
      { model: 'gpt-5.4-mini', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] },
      opts,
    );
    expect(p.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});
