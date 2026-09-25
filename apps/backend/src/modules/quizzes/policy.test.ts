import { describe, it, expect } from 'vitest';
import { AppError } from '../../lib/errors.js';
import {
  activeDurationSec,
  buildPresentation,
  buildReview,
  canPractice,
  effectiveCooldownMinutes,
  frozenQuestionIds,
  isAttemptStale,
  parsePresentation,
  presentedQuestions,
  reviewLevelFor,
  seedToInt,
  summarizeAttempt,
  toAttemptQuestions,
  toPolicyQuestion,
  validateAnswers,
  validateFlagged,
  type LectureSourceInfo,
  type PolicyQuestion,
} from './policy.js';

/* ── Фикстуры ── */

function q(id: string, over: Partial<PolicyQuestion> = {}): PolicyQuestion {
  return {
    id,
    type: 'SINGLE_CHOICE',
    prompt: `Вопрос ${id}`,
    options: ['A', 'B', 'C', 'D'],
    correctOptionIds: [1],
    explanation: `Пояснение ${id}`,
    optionRationales: ['r0', 'r1', 'r2', 'r3'],
    sourceLectureId: 'lec1',
    sourceTimecode: '12:30',
    orderIndex: 0,
    archivedAt: null,
    ...over,
  };
}

const BANK: PolicyQuestion[] = [
  q('q1', { orderIndex: 0 }),
  q('q2', { orderIndex: 1, correctOptionIds: [3] }),
  q('q3', { orderIndex: 2, type: 'TRUE_FALSE', options: ['Верно', 'Неверно'], correctOptionIds: [0], optionRationales: null }),
  q('q4', { orderIndex: 3, correctOptionIds: [0] }),
  q('q5', { orderIndex: 4, correctOptionIds: [2] }),
  q('q6', { orderIndex: 5 }),
  q('q7', { orderIndex: 6, correctOptionIds: [2] }),
  q('q8', { orderIndex: 7, type: 'TRUE_FALSE', options: ['Верно', 'Неверно'], correctOptionIds: [1], optionRationales: null }),
];
const shape = BANK.map((x) => ({ id: x.id, type: x.type, optionCount: x.options.length }));
const SOURCES = new Map<string, LectureSourceInfo>([['lec1', { title: 'Лекция о власти', lectureNumber: 4 }]]);

function expectInvalid(fn: () => unknown, reason: string): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    const err = e as AppError;
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('INVALID_ANSWERS');
    expect((err.details as { reason: string }).reason).toBe(reason);
    return;
  }
  throw new Error('ожидалась ошибка 422 INVALID_ANSWERS');
}

/* ── canPractice ── */

describe('canPractice (USER_DECISIONS §2)', () => {
  it('мини-квиз — тренировка всегда', () => {
    expect(canPractice({ isGraded: false }, null)).toBe(true);
    expect(canPractice({ isGraded: false }, { finalReached: false })).toBe(true);
  });
  it('оцениваемый тест до финала — закрыто', () => {
    expect(canPractice({ isGraded: true }, { finalReached: false })).toBe(false);
    expect(canPractice({ isGraded: true }, null)).toBe(false);
  });
  it('оцениваемый тест после финала — открыто', () => {
    expect(canPractice({ isGraded: true }, { finalReached: true })).toBe(true);
  });
});

/* ── buildPresentation ── */

describe('buildPresentation (попытка 2 перемешана)', () => {
  it('попытка 1 — канонический порядок, без seed', () => {
    const p = buildPresentation(shape, 1, 'att-1');
    expect(p.questionIds).toEqual(BANK.map((x) => x.id));
    expect(p.seed).toBeNull();
    for (const x of BANK) expect(p.optionOrder[x.id]).toEqual(x.options.map((_, i) => i));
  });

  it('попытка 2 — детерминирована по seed', () => {
    const a = buildPresentation(shape, 2, 'cmattempt2');
    const b = buildPresentation(shape, 2, 'cmattempt2');
    expect(a).toEqual(b);
    expect(a.seed).toBe('cmattempt2');
  });

  it('попытка 2 — порядок вопросов отличается от канонического и это перестановка того же набора', () => {
    for (const seed of ['s1', 's2', 's3', 'cmugx1', 'cmugx2']) {
      const p = buildPresentation(shape, 2, seed);
      expect(p.questionIds).not.toEqual(BANK.map((x) => x.id));
      expect([...p.questionIds].sort()).toEqual(BANK.map((x) => x.id).sort());
    }
  });

  it('попытка 2 — варианты SINGLE_CHOICE перемешаны (перестановка, не тождество), TRUE_FALSE — никогда', () => {
    for (const seed of ['s1', 's2', 'cmugx3']) {
      const p = buildPresentation(shape, 2, seed);
      for (const x of BANK) {
        const order = p.optionOrder[x.id]!;
        expect([...order].sort()).toEqual(x.options.map((_, i) => i));
        if (x.type === 'TRUE_FALSE') expect(order).toEqual([0, 1]);
        else expect(order).not.toEqual([0, 1, 2, 3]);
      }
    }
  });

  it('разные seed дают разный порядок', () => {
    const a = buildPresentation(shape, 2, 'seed-a');
    const b = buildPresentation(shape, 2, 'seed-b');
    expect(a.questionIds.join() + JSON.stringify(a.optionOrder)).not.toBe(b.questionIds.join() + JSON.stringify(b.optionOrder));
  });

  it('seed → первые 4 байта sha256 (стабильно)', () => {
    expect(seedToInt('abc')).toBe(0xba7816bf);
  });

  it('один вопрос/один вариант не ломают перемешивание', () => {
    const p = buildPresentation([{ id: 'x', type: 'SINGLE_CHOICE', optionCount: 1 }], 2, 's');
    expect(p.questionIds).toEqual(['x']);
    expect(p.optionOrder.x).toEqual([0]);
  });
});

/* ── presentedQuestions / toAttemptQuestions ── */

describe('presentedQuestions / toAttemptQuestions', () => {
  it('с presentation — ровно её вопросы и порядок, включая архивные', () => {
    const bank = BANK.map((x) => (x.id === 'q2' ? { ...x, archivedAt: new Date() } : x));
    const pres = buildPresentation(shape, 2, 'cmattempt2');
    const presented = presentedQuestions({ presentation: pres }, bank);
    expect(presented.map((x) => x.id)).toEqual(pres.questionIds);
    expect(presented.some((x) => x.id === 'q2')).toBe(true);
    expect(presented.map((x) => x.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('без presentation (устаревшие попытки) — действующие вопросы по orderIndex', () => {
    const bank = [q('b', { orderIndex: 1 }), q('a', { orderIndex: 0 }), q('z', { orderIndex: 10001, archivedAt: new Date() })];
    const presented = presentedQuestions({ presentation: null }, bank);
    expect(presented.map((x) => x.id)).toEqual(['a', 'b']);
    expect(presented[0]!.optionOrder).toEqual([0, 1, 2, 3]);
  });

  it('варианты — в порядке показа с каноническими id', () => {
    const pres = { version: 1, questionIds: ['q1'], optionOrder: { q1: [2, 0, 3, 1] }, seed: 's' };
    const [aq] = toAttemptQuestions(presentedQuestions({ presentation: pres }, BANK));
    expect(aq!.options).toEqual([
      { id: 2, text: 'C' },
      { id: 0, text: 'A' },
      { id: 3, text: 'D' },
      { id: 1, text: 'B' },
    ]);
    expect(aq!.position).toBe(1);
    // Без ключа и пояснений
    expect(JSON.stringify(aq)).not.toMatch(/correct|explanation|rationale/i);
  });

  it('повреждённый optionOrder → канонический порядок', () => {
    const pres = { version: 1, questionIds: ['q1'], optionOrder: { q1: [0, 0, 1, 9] }, seed: 's' };
    expect(presentedQuestions({ presentation: pres }, BANK)[0]!.optionOrder).toEqual([0, 1, 2, 3]);
  });

  it('parsePresentation отвергает мусор', () => {
    expect(parsePresentation(null)).toBeNull();
    expect(parsePresentation({ questionIds: [1, 2] })).toBeNull();
    expect(parsePresentation({ questionIds: ['a'] })?.seed).toBeNull();
  });
});

/* ── validateAnswers ── */

describe('validateAnswers (канонические id, 422 INVALID_ANSWERS)', () => {
  const presented = presentedQuestions({ presentation: null }, BANK);

  it('корректные ответы нормализуются, пропуски считаются', () => {
    const r = validateAnswers(presented, { q1: [1], q3: [0], q2: [] }, { partial: true });
    expect(r.normalized).toEqual({ q1: [1], q3: [0] });
    expect(r.unansweredCount).toBe(6);
  });

  it('неизвестный вопрос → UNKNOWN_QUESTION', () => {
    expectInvalid(() => validateAnswers(presented, { nope: [0] }, { partial: true }), 'UNKNOWN_QUESTION');
  });

  it('id варианта вне диапазона → INVALID_OPTION', () => {
    expectInvalid(() => validateAnswers(presented, { q1: [4] }, { partial: true }), 'INVALID_OPTION');
    expectInvalid(() => validateAnswers(presented, { q3: [2] }, { partial: true }), 'INVALID_OPTION');
    expectInvalid(() => validateAnswers(presented, { q1: [-1] }, { partial: true }), 'INVALID_OPTION');
  });

  it('нецелое / не число → INVALID_OPTION', () => {
    expectInvalid(() => validateAnswers(presented, { q1: [1.5] }, { partial: true }), 'INVALID_OPTION');
    expectInvalid(() => validateAnswers(presented, { q1: ['1'] }, { partial: true }), 'INVALID_OPTION');
  });

  it('не массив → NOT_AN_ARRAY', () => {
    expectInvalid(() => validateAnswers(presented, { q1: 1 }, { partial: true }), 'NOT_AN_ARRAY');
  });

  it('два варианта у SINGLE_CHOICE / TRUE_FALSE → TOO_MANY_OPTIONS', () => {
    expectInvalid(() => validateAnswers(presented, { q1: [0, 1] }, { partial: true }), 'TOO_MANY_OPTIONS');
    expectInvalid(() => validateAnswers(presented, { q3: [0, 1] }, { partial: true }), 'TOO_MANY_OPTIONS');
  });

  it('повтор варианта → DUPLICATE_OPTION', () => {
    expectInvalid(() => validateAnswers(presented, { q1: [1, 1] }, { partial: true }), 'DUPLICATE_OPTION');
  });

  it('partial=false требует ответ на каждый вопрос', () => {
    expectInvalid(() => validateAnswers(presented, { q1: [1] }, { partial: false }), 'MISSING_ANSWER');
    const all = Object.fromEntries(presented.map((x) => [x.id, [0]]));
    expect(validateAnswers(presented, all, { partial: false }).unansweredCount).toBe(0);
  });

  it('ответ на вопрос, не показанный в этой попытке, отвергается', () => {
    const only = presentedQuestions({ presentation: { version: 1, questionIds: ['q1'], optionOrder: {}, seed: null } }, BANK);
    expectInvalid(() => validateAnswers(only, { q2: [0] }, { partial: true }), 'UNKNOWN_QUESTION');
  });

  it('flagged — только показанные вопросы, без повторов', () => {
    expect(validateFlagged(presented, ['q2', 'q2', 'q5'])).toEqual(['q2', 'q5']);
    expectInvalid(() => validateFlagged(presented, ['x']), 'UNKNOWN_QUESTION');
  });
});

/* ── Уровень разбора и разбор ── */

describe('reviewLevelFor', () => {
  it.each([
    ['FULL_AFTER_FINAL', false, 'CORRECTNESS'],
    ['FULL_AFTER_FINAL', true, 'FULL'],
    ['SCORE_UNTIL_FINAL', false, 'SCORE'],
    ['SCORE_UNTIL_FINAL', true, 'FULL'],
    ['SCORE_ONLY', false, 'SCORE'],
    ['SCORE_ONLY', true, 'SCORE'],
  ] as const)('%s, финал=%s → %s', (policy, final, level) => {
    expect(reviewLevelFor(policy, final)).toBe(level);
  });
});

describe('buildReview', () => {
  const pres = buildPresentation(shape, 2, 'cmattempt2');
  const presented = presentedQuestions({ presentation: pres }, BANK);
  const answers = { q1: [1], q2: [0], q3: [1] };

  it('SCORE — пустой разбор', () => {
    expect(buildReview('SCORE', presented, answers, SOURCES)).toEqual([]);
  });

  it('CORRECTNESS — сериализация без вариантов, выбора, ключа, пояснений и источников (утечки нет)', () => {
    const review = buildReview('CORRECTNESS', presented, answers, SOURCES);
    expect(review).toHaveLength(8);
    for (const item of review) {
      expect(Object.keys(item).sort()).toEqual(['isCorrect', 'position', 'prompt', 'questionId', 'type']);
    }
    const json = JSON.stringify(review);
    for (const forbidden of ['options', 'selected', 'correctOptionIds', 'explanation', 'optionRationales', 'source', 'Пояснение', 'r1', '12:30', 'Лекция о власти']) {
      expect(json).not.toContain(forbidden);
    }
    // Тексты вариантов тоже не утекают
    expect(json).not.toMatch(/"(A|B|C|D)"/);
  });

  it('CORRECTNESS — верность по каноническим id и порядок попытки', () => {
    const review = buildReview('CORRECTNESS', presented, answers, SOURCES);
    expect(review.map((r) => r.questionId)).toEqual(pres.questionIds);
    const byId = Object.fromEntries(review.map((r) => [r.questionId, r.isCorrect]));
    expect(byId).toMatchObject({ q1: true, q2: false, q3: false, q4: false });
  });

  it('FULL — варианты в порядке показа, выбор, ключ, обоснования и источник с секундами', () => {
    const review = buildReview('FULL', presented, answers, SOURCES);
    const r1 = review.find((r) => r.questionId === 'q1')!;
    expect(r1.options!.map((o) => o.id)).toEqual(pres.optionOrder.q1);
    expect(r1.options!.find((o) => o.id === 1)!.text).toBe('B');
    expect(r1.selected).toEqual([1]);
    expect(r1.correctOptionIds).toEqual([1]);
    expect(r1.explanation).toBe('Пояснение q1');
    expect(r1.optionRationales).toEqual(['r0', 'r1', 'r2', 'r3']);
    expect(r1.source).toEqual({ lectureId: 'lec1', title: 'Лекция о власти', lectureNumber: 4, timecode: '12:30', seconds: 750 });
    const r4 = review.find((r) => r.questionId === 'q4')!;
    expect(r4.selected).toEqual([]);
    expect(r4.isCorrect).toBe(false);
  });

  it('FULL — источник неизвестной лекции → null', () => {
    const review = buildReview('FULL', presented, answers, new Map());
    expect(review.every((r) => r.source === null)).toBe(true);
  });
});

/* ── Прочее ── */

describe('заморозка, длительность, пауза, сводка', () => {
  it('frozenQuestionIds — из presentation и ключей answers', () => {
    const ids = frozenQuestionIds([
      { presentation: { version: 1, questionIds: ['q1', 'q2'], optionOrder: {}, seed: null }, answers: {} },
      { presentation: null, answers: { q7: [1] } },
      { presentation: 'мусор', answers: null },
    ]);
    expect([...ids].sort()).toEqual(['q1', 'q2', 'q7']);
  });

  it('activeDurationSec ограничен лимитом попытки', () => {
    const start = new Date('2026-09-25T10:00:00Z');
    expect(activeDurationSec(start, new Date('2026-09-25T10:11:00Z'), 24)).toBe(660);
    expect(activeDurationSec(start, new Date('2026-09-27T10:00:00Z'), 24)).toBe(86_400);
    expect(activeDurationSec(start, new Date('2026-09-25T09:00:00Z'), 24)).toBe(0);
  });

  it('isAttemptStale — от последнего сохранения, иначе от старта', () => {
    const now = new Date('2026-09-26T12:00:00Z');
    expect(isAttemptStale({ startedAt: new Date('2026-09-25T10:00:00Z'), lastSavedAt: null }, 24, now)).toBe(true);
    expect(isAttemptStale({ startedAt: new Date('2026-09-25T10:00:00Z'), lastSavedAt: new Date('2026-09-26T11:00:00Z') }, 24, now)).toBe(false);
  });

  it('effectiveCooldownMinutes: значение теста важнее env, 0 — без паузы', () => {
    expect(effectiveCooldownMinutes(null, 1440)).toBe(1440);
    expect(effectiveCooldownMinutes(undefined, 1440)).toBe(1440);
    expect(effectiveCooldownMinutes(0, 1440)).toBe(0);
    expect(effectiveCooldownMinutes(60, 1440)).toBe(60);
  });

  it('summarizeAttempt — длительность, верные по показанным вопросам, зачётность', () => {
    const presented = presentedQuestions({ presentation: null }, BANK);
    const s = summarizeAttempt(
      { id: 'a1', startedAt: new Date('2026-09-25T10:00:00Z'), submittedAt: new Date('2026-09-25T10:11:00Z'), score: 0.25, passed: false, autoSubmitted: false },
      { attemptNumber: 2, counted: true },
      presented,
      { q1: [1], q2: [3], q3: [1] },
    );
    expect(s).toMatchObject({ attemptNumber: 2, durationSec: 660, correctCount: 2, total: 8, counted: true, autoSubmitted: false });
  });

  it('toPolicyQuestion нормализует Json-поля', () => {
    const p = toPolicyQuestion({ id: 'x', type: 'SINGLE_CHOICE', prompt: 'p', options: ['a', 'b'], correctOptionIds: [1, 'x'], explanation: null, optionRationales: ['', 'b'], orderIndex: 0 });
    expect(p.correctOptionIds).toEqual([1]);
    expect(p.optionRationales).toEqual([null, 'b']);
    expect(p.archivedAt).toBeNull();
  });
});
