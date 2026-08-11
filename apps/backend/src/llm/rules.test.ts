import { describe, it, expect } from 'vitest';
import { decideTurnOutcome, detectIntegritySignals } from './rules.js';
import { IntegrityFlagType } from '@edu/shared';

describe('decideTurnOutcome (§5.4, FR-6.4)', () => {
  const base = { aiMessageCount: 5, maxAiMessages: 22, tokensUsedAfterTurn: 1000, tokenCeiling: 18000 };

  it('достигнут ответ → PASSED', () => {
    expect(decideTurnOutcome({ ...base, reached: true })).toBe('PASSED');
  });

  it('верный ответ на последней реплике всё равно PASSED (§5.5)', () => {
    expect(decideTurnOutcome({ ...base, reached: true, aiMessageCount: 22 })).toBe('PASSED');
  });

  it('исчерпан лимит реплик → FAILED_LIMIT', () => {
    expect(decideTurnOutcome({ ...base, reached: false, aiMessageCount: 22 })).toBe('FAILED_LIMIT');
  });

  it('лимит реплик приоритетнее токен-потолка', () => {
    expect(
      decideTurnOutcome({ reached: false, aiMessageCount: 22, maxAiMessages: 22, tokensUsedAfterTurn: 99999, tokenCeiling: 18000 }),
    ).toBe('FAILED_LIMIT');
  });

  it('токен-потолок → FAILED_CEILING (предохранитель)', () => {
    expect(decideTurnOutcome({ ...base, reached: false, tokensUsedAfterTurn: 18000 })).toBe('FAILED_CEILING');
  });

  it('в пределах лимитов → CONTINUE', () => {
    expect(decideTurnOutcome({ ...base, reached: false })).toBe('CONTINUE');
  });

  it('граница лимита реплик строгая (< max → CONTINUE)', () => {
    expect(decideTurnOutcome({ ...base, reached: false, aiMessageCount: 21 })).toBe('CONTINUE');
  });
});

describe('detectIntegritySignals (FR-6.11)', () => {
  const maxChars = 1500;

  it('короткое обычное сообщение — без флагов', () => {
    expect(detectIntegritySignals({ text: 'Думаю, дело в выборке.', typingMs: 8000, maxChars })).toEqual([]);
  });

  it('длинная быстрая вставка → FAST_LONG_PASTE', () => {
    const text = 'а'.repeat(400);
    const flags = detectIntegritySignals({ text, typingMs: 500, maxChars });
    expect(flags.map((f) => f.type)).toContain(IntegrityFlagType.FAST_LONG_PASTE);
  });

  it('длинный текст, но набранный медленно — без флага быстрой вставки', () => {
    const text = 'а'.repeat(400);
    const flags = detectIntegritySignals({ text, typingMs: 60_000, maxChars });
    expect(flags.map((f) => f.type)).not.toContain(IntegrityFlagType.FAST_LONG_PASTE);
  });

  it('сообщение у предела длины → NEAR_MAX_LENGTH', () => {
    const text = 'а'.repeat(1450);
    const flags = detectIntegritySignals({ text, typingMs: 200_000, maxChars });
    expect(flags.map((f) => f.type)).toContain(IntegrityFlagType.NEAR_MAX_LENGTH);
  });

  it('без typingMs быструю вставку не детектим (нет данных)', () => {
    const text = 'а'.repeat(400);
    const flags = detectIntegritySignals({ text, maxChars });
    expect(flags.map((f) => f.type)).not.toContain(IntegrityFlagType.FAST_LONG_PASTE);
  });
});
