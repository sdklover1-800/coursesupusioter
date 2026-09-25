import { describe, it, expect } from 'vitest';
import {
  CEILING_TUTOR_MARGIN,
  costUsd,
  decideTurnOutcome,
  detectIntegritySignals,
  guardVerdict,
  isNearCeiling,
  mapVerdict,
  passGate,
  tutorReplyCounts,
  tutorWindow,
  TUTOR_WINDOW_STUDENT_TURNS,
} from './rules.js';
import { IntegrityFlagType } from '@edu/shared';

describe('decideTurnOutcome (§5.4, FR-6.4)', () => {
  const base = { aiMessageCount: 5, maxAiMessages: 22, tokensUsedBeforeTutor: 1000, tokenCeiling: 160000 };

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
      decideTurnOutcome({ reached: false, aiMessageCount: 22, maxAiMessages: 22, tokensUsedBeforeTutor: 999999, tokenCeiling: 18000 }),
    ).toBe('FAILED_LIMIT');
  });

  it('токен-потолок → FAILED_CEILING (предохранитель)', () => {
    expect(decideTurnOutcome({ ...base, reached: false, tokensUsedBeforeTutor: 160000 })).toBe('FAILED_CEILING');
  });

  it('потолок учитывает запас 1.2k под предстоящую реплику тьютора (находка k)', () => {
    expect(CEILING_TUTOR_MARGIN).toBe(1200);
    // До потолка 1000 токенов — меньше запаса: тьютора уже не вызываем
    expect(decideTurnOutcome({ ...base, reached: false, tokensUsedBeforeTutor: 159000 })).toBe('FAILED_CEILING');
    // Ровно запас + 1 — ещё помещается
    expect(decideTurnOutcome({ ...base, reached: false, tokensUsedBeforeTutor: 160000 - 1201 })).toBe('CONTINUE');
    // Явный запас из параметров
    expect(decideTurnOutcome({ ...base, reached: false, tokensUsedBeforeTutor: 159000, tutorMargin: 500 })).toBe('CONTINUE');
  });

  it('в пределах лимитов → CONTINUE', () => {
    expect(decideTurnOutcome({ ...base, reached: false })).toBe('CONTINUE');
  });

  it('граница лимита реплик строгая (< max → CONTINUE)', () => {
    expect(decideTurnOutcome({ ...base, reached: false, aiMessageCount: 21 })).toBe('CONTINUE');
  });
});

describe('страж вердикта и PASS-гейт (A2)', () => {
  const yes = { student_reached_answer: true, criterion_missing: [] as string[] };
  const no = { student_reached_answer: false, criterion_missing: ['прогноз'] };

  it('reached=true при непустом criterion_missing трактуется как false', () => {
    expect(guardVerdict({ student_reached_answer: true, criterion_missing: ['тип режима'] })).toBe(false);
    expect(guardVerdict(yes)).toBe(true);
    expect(guardVerdict({ student_reached_answer: false, criterion_missing: [] })).toBe(false);
  });

  it('PASS только если основной и подтверждающий вызовы согласны', () => {
    expect(passGate(yes, yes, true)).toBe(true);
    expect(passGate(yes, no, true)).toBe(false);
    expect(passGate(no, yes, true)).toBe(false);
  });

  it('подтверждение включено, но его нет — не PASS', () => {
    expect(passGate(yes, null, true)).toBe(false);
  });

  it('подтверждение сказало «да», но с непустым criterion_missing — не PASS', () => {
    expect(passGate(yes, { student_reached_answer: true, criterion_missing: ['прогноз'] }, true)).toBe(false);
  });

  it('подтверждение выключено — достаточно основного вызова со стражем', () => {
    expect(passGate(yes, null, false)).toBe(true);
    expect(passGate({ student_reached_answer: true, criterion_missing: ['x'] }, null, false)).toBe(false);
  });
});

describe('коды вердикта (находка f)', () => {
  it('каждый исход → свой verdictCode и endReason', () => {
    expect(mapVerdict({ kind: 'PASSED' })).toEqual({ status: 'PASSED', verdictCode: 'PASSED', endReason: 'PASSED' });
    expect(mapVerdict({ kind: 'FAILED_LIMIT' })).toEqual({ status: 'FAILED', verdictCode: 'FAILED_LIMIT', endReason: 'LIMIT' });
    // Потолок больше не маскируется под лимит реплик
    expect(mapVerdict({ kind: 'FAILED_CEILING' })).toEqual({ status: 'FAILED', verdictCode: 'FAILED_CEILING', endReason: 'CEILING' });
    expect(mapVerdict({ kind: 'ENDED_BY_STUDENT', endReason: 'DONE' })).toEqual({ status: 'FAILED', verdictCode: 'ENDED_BY_STUDENT', endReason: 'DONE' });
    expect(mapVerdict({ kind: 'ENDED_BY_STUDENT', endReason: 'OTHER' }).endReason).toBe('OTHER');
    expect(mapVerdict({ kind: 'PASSED', endReason: 'DONE' })).toEqual({ status: 'PASSED', verdictCode: 'PASSED', endReason: 'DONE' });
  });

  it('брошенная сессия: IDLE, после паузы «техническая проблема» — IDLE_AFTER_PAUSE (A7)', () => {
    expect(mapVerdict({ kind: 'ABANDONED', paused: false })).toEqual({ status: 'ABANDONED', verdictCode: 'ABANDONED', endReason: 'IDLE' });
    expect(mapVerdict({ kind: 'ABANDONED', paused: true }).endReason).toBe('IDLE_AFTER_PAUSE');
  });
});

describe('лимит реплик и замены реплики тьютора (A21)', () => {
  it('таймаут/сбой проверки и обрыв по длине не расходуют лимит; утечка — расходует', () => {
    expect(tutorReplyCounts(null)).toBe(true);
    expect(tutorReplyCounts('semantic_leak')).toBe(true);
    expect(tutorReplyCounts('verbatim_leak')).toBe(true);
    expect(tutorReplyCounts('leak_timeout')).toBe(false);
    expect(tutorReplyCounts('leak_error')).toBe(false);
    expect(tutorReplyCounts('length')).toBe(false);
    expect(tutorReplyCounts('over_limit')).toBe(false);
  });

  it('nearCeiling — с 80 % потолка', () => {
    expect(isNearCeiling(127999, 160000)).toBe(false);
    expect(isNearCeiling(128000, 160000)).toBe(true);
    expect(isNearCeiling(10, 0)).toBe(false);
  });
});

describe('окно истории тьютора (A3)', () => {
  const dialog = (n: number) =>
    Array.from({ length: n }, (_, i) => [
      { role: 'STUDENT', content: `s${i + 1}` },
      { role: 'AI', content: `t${i + 1}` },
    ])
      .flat()
      .slice(0, 2 * n - 1); // последняя реплика — студента (текущий ход)

  it('короткий диалог передаётся целиком', () => {
    const d = dialog(3);
    expect(tutorWindow(d)).toEqual(d);
  });

  it('длинный диалог: ровно N последних реплик студента, окно начинается с реплики студента', () => {
    const w = tutorWindow(dialog(20));
    expect(w[0]).toEqual({ role: 'STUDENT', content: 's13' });
    expect(w.at(-1)).toEqual({ role: 'STUDENT', content: 's20' });
    expect(w.filter((m) => m.role === 'STUDENT')).toHaveLength(TUTOR_WINDOW_STUDENT_TURNS);
    expect(w).toHaveLength(2 * TUTOR_WINDOW_STUDENT_TURNS - 1);
  });

  it('размер окна задаётся параметром', () => {
    expect(tutorWindow(dialog(5), 2).map((m) => m.content)).toEqual(['s4', 't4', 's5']);
  });
});

describe('стоимость (A3): 0.75 / 0.075 / 4.5 за 1M', () => {
  const price = { input: 0.75, cachedInput: 0.075, output: 4.5 };

  it('кешированный вход тарифицируется отдельно от некешированного', () => {
    // 1M входа, из них 900k из кеша, 100k выхода
    expect(costUsd({ input: 1_000_000, cachedInput: 900_000, output: 100_000 }, price)).toBeCloseTo(0.075 + 0.0675 + 0.45, 10);
  });

  it('без кеша — полная цена входа; кеш не больше входа', () => {
    expect(costUsd({ input: 2000, cachedInput: 0, output: 300 }, price)).toBeCloseTo((2000 * 0.75 + 300 * 4.5) / 1e6, 12);
    expect(costUsd({ input: 100, cachedInput: 500, output: 0 }, price)).toBeCloseTo((100 * 0.075) / 1e6, 12);
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
