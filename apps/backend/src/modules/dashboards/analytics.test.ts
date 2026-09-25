import { describe, it, expect } from 'vitest';
import {
  columnAverages,
  itemStats,
  lectureCell,
  meanOf,
  meanSubmittedScore,
  practicalCell,
  practicalOutcome,
  practicalPassRate,
  quizCell,
  quizOutcome,
  type AttemptLite,
  type MatrixColumn,
  type SessionLite,
} from './analytics.js';

const NOW = new Date('2026-09-25T12:00:00Z');
const t = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const att = (id: string, h: number, score: number | null, passed = false): AttemptLite => ({
  id,
  startedAt: t(h),
  submittedAt: score === null ? null : t(h - 0.2),
  score: score ?? 0,
  passed,
});
const BEST = { maxAttempts: 2, cooldownMinutes: 1440, scoringRule: 'BEST' as const };
const FIRST = { ...BEST, scoringRule: 'FIRST' as const };

describe('тест: зачётный балл по записи (A16)', () => {
  const two = [att('a1', 50, 0.25), att('a2', 10, 0.875, true)];

  it('BEST — лучший балл, а не среднее (прежний bestByQuiz был средним)', () => {
    expect(meanSubmittedScore(two)).toBeCloseTo(0.5625);
    expect(quizOutcome(two, BEST, NOW).countedScore).toBe(0.875);
  });

  it('FIRST — балл первой отправленной', () => {
    expect(quizOutcome(two, FIRST, NOW).countedScore).toBe(0.25);
  });

  it('незавершённая попытка не влияет на балл, но занимает слот', () => {
    const o = quizOutcome([att('a1', 50, 0.5), att('a2', 1, null)], BEST, NOW);
    expect(o).toMatchObject({ countedScore: 0.5, submittedCount: 1, inProgress: true, finalReached: false });
    expect(meanSubmittedScore([att('a2', 1, null)])).toBeNull();
  });

  it('meanOf считает n только по имеющимся значениям', () => {
    expect(meanOf([0.5, null, 1, undefined])).toEqual({ mean: 0.75, n: 2 });
    expect(meanOf([])).toEqual({ mean: null, n: 0 });
  });
});

const sess = (id: string, h: number, status: SessionLite['status'], over: Partial<SessionLite> = {}): SessionLite => ({
  id,
  status,
  startedAt: t(h),
  endedAt: status === 'IN_PROGRESS' ? null : t(h - 1),
  userMessageCount: 5,
  excusedAt: null,
  verdictCode: status === 'PASSED' ? 'PASSED' : status === 'FAILED' ? 'FAILED_LIMIT' : null,
  ...over,
});

describe('практикум: итог по записи (A16)', () => {
  it('нет сессий → NOT_STARTED', () => {
    expect(practicalOutcome([], 2, NOW)).toMatchObject({ outcome: 'NOT_STARTED', verdict: null, final: false });
  });
  it('сдана хоть одна сессия → PASSED', () => {
    expect(practicalOutcome([sess('s1', 30, 'FAILED'), sess('s2', 5, 'PASSED')], 2, NOW)).toMatchObject({ outcome: 'PASSED', verdict: 'PASSED', final: true });
  });
  it('одна неудачная из двух → ещё не окончательно, verdict — итог последней', () => {
    expect(practicalOutcome([sess('s1', 30, 'FAILED')], 2, NOW)).toMatchObject({ outcome: 'IN_PROGRESS', verdict: 'FAILED_LIMIT', final: false, sessionsUsed: 1 });
  });
  it('две неудачные → FAILED, verdict — последней', () => {
    const o = practicalOutcome([sess('s1', 30, 'FAILED'), sess('s2', 5, 'ABANDONED', { verdictCode: 'ABANDONED' })], 2, NOW);
    expect(o).toMatchObject({ outcome: 'FAILED', verdict: 'ABANDONED', final: true });
  });
  it('сессия без реплик студента или освобождённая не считается попыткой', () => {
    const o = practicalOutcome([sess('s1', 30, 'FAILED'), sess('s2', 20, 'ABANDONED', { userMessageCount: 0 }), sess('s3', 10, 'FAILED', { excusedAt: t(9) })], 2, NOW);
    expect(o).toMatchObject({ outcome: 'IN_PROGRESS', sessionsUsed: 1 });
  });
  it('passRate — по записям с окончательным итогом, а не по сессиям', () => {
    const outcomes = [
      practicalOutcome([sess('a', 30, 'FAILED'), sess('b', 5, 'PASSED')], 2, NOW), // сдал со 2-й
      practicalOutcome([sess('c', 30, 'FAILED'), sess('d', 5, 'FAILED')], 2, NOW), // не сдал
      practicalOutcome([sess('e', 30, 'FAILED')], 2, NOW), // ещё может
      practicalOutcome([], 2, NOW),
    ];
    // По сессиям было бы 1/4 = 0.25; по записям — 1/2.
    expect(practicalPassRate(outcomes)).toEqual({ n: 3, passed: 1, failed: 1, inProgress: 1, passRate: 0.5 });
  });
});

describe('матрица: состояния ячеек и итоговая строка', () => {
  it('лекция', () => {
    expect(lectureCell(undefined)).toEqual({ state: 'NOT_STARTED' });
    expect(lectureCell({ isCompleted: true, positionSec: 0, watchedSec: 0, lastViewedAt: null })).toEqual({ state: 'DONE' });
    expect(lectureCell({ isCompleted: false, positionSec: 120, watchedSec: 90, lastViewedAt: t(1) })).toEqual({ state: 'IN_PROGRESS' });
    expect(lectureCell({ isCompleted: false, positionSec: 0, watchedSec: 0, lastViewedAt: null })).toEqual({ state: 'NOT_STARTED' });
  });
  it('тест модуля', () => {
    expect(quizCell([], BEST, NOW)).toEqual({ state: 'NOT_STARTED' });
    expect(quizCell([att('a', 5, 0.5)], BEST, NOW)).toEqual({ state: 'IN_PROGRESS', score: 0.5 });
    expect(quizCell([att('a', 50, 0.5), att('b', 5, 0.625)], BEST, NOW)).toEqual({ state: 'FAILED', score: 0.625 });
    expect(quizCell([att('a', 5, 0.75, true)], BEST, NOW)).toEqual({ state: 'PASSED', score: 0.75 });
    expect(quizCell([att('a', 1, null)], BEST, NOW)).toEqual({ state: 'IN_PROGRESS' });
  });
  it('практикум', () => {
    expect(practicalCell([], 2, NOW)).toEqual({ state: 'NOT_STARTED' });
    expect(practicalCell([sess('s', 1, 'IN_PROGRESS')], 2, NOW)).toEqual({ state: 'IN_PROGRESS' });
    expect(practicalCell([sess('s', 5, 'PASSED')], 2, NOW)).toEqual({ state: 'PASSED' });
    expect(practicalCell([sess('a', 30, 'FAILED'), sess('b', 5, 'FAILED')], 2, NOW)).toEqual({ state: 'FAILED' });
  });
  it('итоговая строка по видам столбцов', () => {
    const cols: MatrixColumn[] = [
      { key: 'l1', kind: 'LECTURE', moduleOrderIndex: 0, label: '1', title: 'Л1' },
      { key: 'q1', kind: 'MODULE_QUIZ', moduleOrderIndex: 0, label: 'I', title: 'Тест' },
      { key: 'p1', kind: 'PRACTICAL', moduleOrderIndex: 4, label: 'V', title: 'Практикум' },
    ];
    const rows = [
      { cells: [{ state: 'DONE' as const }, { state: 'PASSED' as const, score: 0.75 }, { state: 'PASSED' as const }] },
      { cells: [{ state: 'IN_PROGRESS' as const }, { state: 'FAILED' as const, score: 0.5 }, { state: 'IN_PROGRESS' as const }] },
      { cells: [{ state: 'NOT_STARTED' as const }, { state: 'NOT_STARTED' as const }, { state: 'FAILED' as const }] },
    ];
    expect(columnAverages(cols, rows)).toEqual([
      { key: 'l1', value: 0.333, n: 3 },
      { key: 'q1', value: 0.625, n: 2 },
      { key: 'p1', value: 0.5, n: 2 },
    ]);
  });
});

describe('анализ заданий: p-value и распределение выборов', () => {
  const qs = [
    { id: 'q1', canonicalKey: 'polit:M1:Q1', prompt: 'P1', options: ['A', 'B', 'C', 'D'], correctOptionIds: [1] },
    { id: 'q2', canonicalKey: null, prompt: 'P2', options: ['Верно', 'Неверно'], correctOptionIds: [0] },
    { id: 'q3', canonicalKey: null, prompt: 'P3', options: ['A', 'B'], correctOptionIds: [0] },
  ];
  const attempts = [
    { presentedIds: ['q1', 'q2'], answers: { q1: [1], q2: [0] } },
    { presentedIds: ['q2', 'q1'], answers: { q1: [3], q2: [0] } },
    { presentedIds: ['q1', 'q2'], answers: { q1: [1] } },
    { presentedIds: ['q1', 'q2'], answers: { q1: [2], q2: [1] } },
  ];
  it('p = верные / показы; пропуск — неверно и считается отдельно; выборы по каноническим id', () => {
    const [s1, s2, s3] = itemStats(qs, attempts);
    expect(s1).toMatchObject({ questionId: 'q1', canonicalKey: 'polit:M1:Q1', n: 4, pValue: 0.5, optionCounts: [0, 2, 1, 1], unansweredCount: 0 });
    expect(s2).toMatchObject({ n: 4, pValue: 0.5, optionCounts: [2, 1], unansweredCount: 1 });
    expect(s3).toMatchObject({ n: 0, pValue: null, optionCounts: [0, 0] });
  });
});
