import { describe, it, expect } from 'vitest';
import { isAnswerCorrect, scoreQuiz, type ScorableQuestion } from './scoring.js';

describe('isAnswerCorrect', () => {
  it('верно при точном совпадении', () => {
    expect(isAnswerCorrect([1], [1])).toBe(true);
  });
  it('порядок не важен', () => {
    expect(isAnswerCorrect([2, 0], [0, 2])).toBe(true);
  });
  it('неверно при неполном ответе', () => {
    expect(isAnswerCorrect([0], [0, 1])).toBe(false);
  });
  it('неверно при лишнем выборе', () => {
    expect(isAnswerCorrect([0, 1], [0])).toBe(false);
  });
  it('пустой ответ неверен, если есть правильный', () => {
    expect(isAnswerCorrect([], [1])).toBe(false);
  });
});

const Q: ScorableQuestion[] = [
  { id: 'a', correctOptionIds: [1] },
  { id: 'b', correctOptionIds: [0] },
  { id: 'c', correctOptionIds: [2] },
];

describe('scoreQuiz', () => {
  it('все верно → 1.0, passed', () => {
    const r = scoreQuiz(Q, { a: [1], b: [0], c: [2] }, 0.7);
    expect(r.score).toBe(1);
    expect(r.passed).toBe(true);
    expect(r.correctCount).toBe(3);
  });

  it('2 из 3 = 0.667, порог 0.6 → passed', () => {
    const r = scoreQuiz(Q, { a: [1], b: [0], c: [0] }, 0.6);
    expect(r.correctCount).toBe(2);
    expect(r.passed).toBe(true);
  });

  it('2 из 3 при пороге 0.7 → НЕ passed (строго >=)', () => {
    const r = scoreQuiz(Q, { a: [1], b: [0], c: [0] }, 0.7);
    expect(r.passed).toBe(false);
  });

  it('ровно порог засчитывается (>=)', () => {
    const r = scoreQuiz(Q, { a: [1], b: [0], c: [0] }, 2 / 3);
    expect(r.passed).toBe(true);
  });

  it('пропущенные ответы считаются неверными', () => {
    const r = scoreQuiz(Q, { a: [1] }, 0.5);
    expect(r.correctCount).toBe(1);
    expect(r.passed).toBe(false);
  });

  it('пустой тест → 0, не passed', () => {
    const r = scoreQuiz([], {}, 0.5);
    expect(r.score).toBe(0);
    expect(r.total).toBe(0);
    expect(r.passed).toBe(false);
  });

  it('review возвращает правильные ответы и пояснения (FR-5.5)', () => {
    const withExpl: ScorableQuestion[] = [{ id: 'x', correctOptionIds: [1], explanation: 'потому что' }];
    const r = scoreQuiz(withExpl, { x: [0] }, 0.5);
    expect(r.review[0]).toMatchObject({ questionId: 'x', isCorrect: false, correctOptionIds: [1], explanation: 'потому что' });
  });
});
