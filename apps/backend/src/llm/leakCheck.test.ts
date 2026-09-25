import { describe, it, expect } from 'vitest';
import { buildLeakCheckRequest, leakDecision, runLeakCheck, LEAK_CHECK_MAX_TOKENS, type StructuredCall } from './leakCheck.js';
import type { CompletionRequest } from './types.js';
import type { LeakCheckOutput } from './schemas/dialog.js';

/** Семантическая проверка утечки (A21): буферизация, fail-closed при таймауте. */
const input = {
  model: 'test-model',
  rubricKeyPoints: ['Режим — авторитаризм', 'Кризис легитимности'],
  referenceSolution: 'Э'.repeat(3000),
  studentTurns: ['Думаю, это протесты.'],
  reply: 'Какой признак режима вы видите?',
};
const okResult = { text: '{}', usage: { inputTokens: 900, outputTokens: 20, cachedInputTokens: 800, reasoningTokens: 64 }, model: 'm', provider: 'mock' };

describe('buildLeakCheckRequest', () => {
  it('тезисы и фрагмент эталона (≤ 1500) — в system как кешируемый префикс; реплика — в сообщении', () => {
    const req = buildLeakCheckRequest(input);
    expect(req.purpose).toBe('judge');
    expect(req.reasoningEffort).toBe('low');
    expect(req.maxTokens).toBe(LEAK_CHECK_MAX_TOKENS);
    expect(LEAK_CHECK_MAX_TOKENS).toBeLessThanOrEqual(60);
    expect(req.system).toContain('K1. Режим — авторитаризм');
    expect(req.system).toContain('Э'.repeat(1500));
    expect(req.system).not.toContain('Э'.repeat(1501));
    expect(req.messages[0]!.content).toContain(input.reply);
    expect(req.messages[0]!.content).toContain('Думаю, это протесты.');
  });
});

describe('runLeakCheck + leakDecision', () => {
  it('таймаут → fail-closed: реплика НЕ выпускается, вызов отменяется', async () => {
    let seen: CompletionRequest | null = null;
    const hang: StructuredCall<LeakCheckOutput> = (req) => {
      seen = req;
      return new Promise(() => undefined); // никогда не отвечает
    };
    const started = Date.now();
    const r = await runLeakCheck(input, { call: hang, timeoutMs: 30 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(r.timeout).toBe(true);
    expect(r.leaks).toBe(false);
    expect(seen!.signal?.aborted).toBe(true);
    expect(leakDecision(r, 'closed')).toEqual({ release: false, flagged: false, cause: 'timeout' });
  });

  it('таймаут в режиме open → реплика выпускается с пометкой', async () => {
    const r = await runLeakCheck(input, { call: () => new Promise(() => undefined), timeoutMs: 10 });
    expect(leakDecision(r, 'open')).toEqual({ release: true, flagged: true, cause: 'timeout' });
  });

  it('сбой вызова → fail-closed', async () => {
    const r = await runLeakCheck(input, { call: () => Promise.reject(new Error('503')), timeoutMs: 1000 });
    expect(r.error).toBe('503');
    expect(r.timeout).toBe(false);
    expect(leakDecision(r, 'closed').release).toBe(false);
    expect(leakDecision(r, 'closed').cause).toBe('error');
  });

  it('утечка → никогда не выпускается, даже в режиме open', async () => {
    const r = await runLeakCheck(input, { call: async () => ({ data: { leaks: true, reason: 'называет режим' }, result: okResult }), timeoutMs: 1000 });
    expect(r.leaks).toBe(true);
    expect(r.usage?.cachedInputTokens).toBe(800);
    expect(leakDecision(r, 'open')).toEqual({ release: false, flagged: false, cause: 'leak' });
  });

  it('чистая реплика → выпускается', async () => {
    const r = await runLeakCheck(input, { call: async () => ({ data: { leaks: false, reason: '' }, result: okResult }), timeoutMs: 1000 });
    expect(leakDecision(r, 'closed')).toEqual({ release: true, flagged: false, cause: 'ok' });
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });
});
