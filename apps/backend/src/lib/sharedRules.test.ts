import { describe, it, expect } from 'vitest';
import {
  passCountFor,
  timecodeToSeconds,
  quizAttemptState,
  practicalAttemptState,
  isPracticalSessionCounted,
  type QuizAttemptInput,
  type PracticalSessionInput,
} from '@edu/shared';

/**
 * Чистые правила попыток из @edu/shared/learn.ts — общие для backend и frontend.
 * USER_DECISIONS §1 (2 попытки, лучшая в зачёт, пауза 24 ч), §4 (2 сессии практикума),
 * критика A7 (что считается попыткой практикума).
 */

const T0 = new Date('2026-09-01T10:00:00.000Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const iso = (min: number) => at(min).toISOString();

const quiz = { maxAttempts: 2, cooldownMinutes: 1440, scoringRule: 'BEST' as const };

function attempt(id: string, startMin: number, submitMin: number | null, score: number, passed: boolean): QuizAttemptInput {
  return { id, startedAt: at(startMin), submittedAt: submitMin === null ? null : at(submitMin), score, passed };
}

describe('passCountFor / timecodeToSeconds', () => {
  it('passCountFor: 70% от 8 вопросов — 6 верных', () => {
    expect(passCountFor(0.7, 8)).toBe(6);
  });

  it('passCountFor: погрешность float не завышает порог (0.7 × 10 → 7)', () => {
    expect(passCountFor(0.7, 10)).toBe(7);
    expect(passCountFor(0.7, 3)).toBe(3);
  });

  it("timecodeToSeconds: '04:12' → 252", () => {
    expect(timecodeToSeconds('04:12')).toBe(252);
  });

  it('timecodeToSeconds: h:mm:ss и пробелы вокруг двоеточий', () => {
    expect(timecodeToSeconds('1:02:03')).toBe(3723);
    expect(timecodeToSeconds(' 4 : 12 ')).toBe(252);
    expect(timecodeToSeconds('75:10')).toBe(4510);
  });

  it('timecodeToSeconds: некорректный ввод → null', () => {
    expect(timecodeToSeconds('4:75')).toBeNull();
    expect(timecodeToSeconds('1:75:00')).toBeNull();
    expect(timecodeToSeconds('abc')).toBeNull();
    expect(timecodeToSeconds('')).toBeNull();
    expect(timecodeToSeconds(null)).toBeNull();
    expect(timecodeToSeconds(undefined)).toBeNull();
  });
});

describe('quizAttemptState (USER_DECISIONS §1)', () => {
  it('без попыток: можно начать, финала нет', () => {
    const s = quizAttemptState([], quiz, at(0));
    expect(s).toMatchObject({ attemptsUsed: 0, attemptsLeft: 2, canStart: true, finalReached: false, passed: false });
    expect(s.bestScore).toBeNull();
    expect(s.countedScore).toBeNull();
    expect(s.cooldownUntil).toBeNull();
  });

  it('незавершённая попытка занимает слот и блокирует старт', () => {
    const s = quizAttemptState([attempt('a1', 0, null, 0, false)], quiz, at(5));
    expect(s.attemptsUsed).toBe(1);
    expect(s.attemptsLeft).toBe(1);
    expect(s.inProgressId).toBe('a1');
    expect(s.canStart).toBe(false);
    expect(s.cooldownUntil).toBeNull();
    expect(s.finalReached).toBe(false);
  });

  it('идёт пауза: старт заблокирован, cooldownUntil = отправка + пауза', () => {
    const s = quizAttemptState([attempt('a1', 0, 20, 0.5, false)], quiz, at(60));
    expect(s.cooldownUntil).toBe(iso(20 + 1440));
    expect(s.canStart).toBe(false);
    expect(s.lastSubmittedAt).toBe(iso(20));
    expect(s.finalReached).toBe(false);
  });

  it('пауза истекла: можно начать вторую попытку', () => {
    const s = quizAttemptState([attempt('a1', 0, 20, 0.5, false)], quiz, at(20 + 1440 + 1));
    expect(s.cooldownUntil).toBeNull();
    expect(s.canStart).toBe(true);
  });

  it('cooldownMinutes: 0 — паузы нет', () => {
    const s = quizAttemptState([attempt('a1', 0, 20, 0.5, false)], { ...quiz, cooldownMinutes: 0 }, at(21));
    expect(s.cooldownUntil).toBeNull();
    expect(s.canStart).toBe(true);
  });

  it('сдан с первой попытки: финал, второй попытки нет', () => {
    const s = quizAttemptState([attempt('a1', 0, 20, 0.875, true)], quiz, at(30));
    expect(s.passed).toBe(true);
    expect(s.finalReached).toBe(true);
    expect(s.canStart).toBe(false);
    expect(s.attemptsLeft).toBe(1);
    expect(s.cooldownUntil).toBeNull();
  });

  it('две проваленные попытки: финал', () => {
    const s = quizAttemptState([attempt('a1', 0, 20, 0.25, false), attempt('a2', 2000, 2020, 0.5, false)], quiz, at(2030));
    expect(s.attemptsLeft).toBe(0);
    expect(s.finalReached).toBe(true);
    expect(s.canStart).toBe(false);
    expect(s.cooldownUntil).toBeNull();
    expect(s.bestScore).toBe(0.5);
  });

  it('последняя попытка ещё идёт: финал НЕ достигнут (ключ закрыт)', () => {
    const s = quizAttemptState([attempt('a1', 0, 20, 0.25, false), attempt('a2', 2000, null, 0, false)], quiz, at(2010));
    expect(s.attemptsLeft).toBe(0);
    expect(s.inProgressId).toBe('a2');
    expect(s.finalReached).toBe(false);
    expect(s.canStart).toBe(false);
  });

  it('BEST: в зачёт лучшая попытка', () => {
    const list = [attempt('a1', 0, 20, 0.75, true), attempt('a0', -3000, -2980, 0.5, false)];
    const s = quizAttemptState(list, quiz, at(30));
    expect(s.countedScore).toBe(0.75);
    expect(s.countedAttemptId).toBe('a1');
    // Нумерация — по времени начала, а не по порядку во входном массиве
    expect(s.numbered).toEqual([
      { id: 'a0', attemptNumber: 1, counted: false },
      { id: 'a1', attemptNumber: 2, counted: true },
    ]);
  });

  it('FIRST: в зачёт первая отправленная попытка, bestScore — всё равно лучший', () => {
    const list = [attempt('a1', 0, 20, 0.5, false), attempt('a2', 2000, 2020, 0.875, true)];
    const s = quizAttemptState(list, { ...quiz, scoringRule: 'FIRST' }, at(2030));
    expect(s.countedScore).toBe(0.5);
    expect(s.countedAttemptId).toBe('a1');
    expect(s.bestScore).toBe(0.875);
    expect(s.numbered.find((n) => n.counted)?.id).toBe('a1');
  });

  it('принимает ISO-строки так же, как Date', () => {
    const list: QuizAttemptInput[] = [{ id: 'a1', startedAt: iso(0), submittedAt: iso(20), score: 0.5, passed: false }];
    const s = quizAttemptState(list, quiz, iso(60));
    expect(s.cooldownUntil).toBe(iso(1460));
  });
});

describe('practicalAttemptState (USER_DECISIONS §4, A7)', () => {
  const task = { maxSessions: 2, availableFrom: null, availableUntil: null };
  function session(
    id: string,
    startMin: number,
    status: PracticalSessionInput['status'],
    userMessageCount: number,
    extra: Partial<PracticalSessionInput> = {},
  ): PracticalSessionInput {
    return {
      id,
      status,
      startedAt: at(startMin),
      endedAt: status === 'IN_PROGRESS' ? null : at(startMin + 30),
      userMessageCount,
      excusedAt: null,
      ...extra,
    };
  }

  it('без сессий: NOT_STARTED, можно начать', () => {
    const s = practicalAttemptState([], task, at(0));
    expect(s).toMatchObject({ status: 'NOT_STARTED', sessionsUsed: 0, canStart: true, final: false, lock: null });
  });

  it('сессия без реплик студента попыткой не считается', () => {
    const s = practicalAttemptState([session('s1', 0, 'ABANDONED', 0)], task, at(100));
    expect(s.sessionsUsed).toBe(0);
    expect(s.status).toBe('NOT_STARTED');
    expect(s.canStart).toBe(true);
    expect(s.latestFinishedSessionId).toBe('s1'); // запасной вариант — последняя завершённая
  });

  it('ABANDONED с репликами считается попыткой (TECH_ISSUE → закрыта по бездействию, A7)', () => {
    const s = practicalAttemptState([session('s1', 0, 'ABANDONED', 3)], task, at(100));
    expect(s.sessionsUsed).toBe(1);
    expect(s.status).toBe('FAILED');
    expect(s.canStart).toBe(true);
    expect(s.final).toBe(false);
    expect(isPracticalSessionCounted({ status: 'ABANDONED', userMessageCount: 3, excusedAt: null })).toBe(true);
  });

  it('освобождённая сотрудником сессия попыткой не считается', () => {
    const s = practicalAttemptState([session('s1', 0, 'FAILED', 5, { excusedAt: at(40) })], task, at(100));
    expect(s.sessionsUsed).toBe(0);
    expect(s.countedIds).toEqual([]);
    expect(s.status).toBe('NOT_STARTED');
  });

  it('PASSED важнее более поздней IN_PROGRESS', () => {
    const s = practicalAttemptState([session('s1', 0, 'PASSED', 6), session('s2', 100, 'IN_PROGRESS', 1)], task, at(110));
    expect(s.status).toBe('PASSED');
    expect(s.activeSessionId).toBe('s2');
    expect(s.final).toBe(true);
  });

  it('после PASSED начать новую сессию нельзя', () => {
    const s = practicalAttemptState([session('s1', 0, 'PASSED', 6)], task, at(100));
    expect(s.canStart).toBe(false);
    expect(s.final).toBe(true);
    expect(s.latestFinishedSessionId).toBe('s1');
  });

  it('активная сессия: IN_PROGRESS, новую начать нельзя, финала нет', () => {
    const s = practicalAttemptState([session('s1', 0, 'IN_PROGRESS', 2)], task, at(10));
    expect(s.status).toBe('IN_PROGRESS');
    expect(s.activeSessionId).toBe('s1');
    expect(s.sessionsUsed).toBe(0);
    expect(s.canStart).toBe(false);
    expect(s.final).toBe(false);
  });

  it('обе зачётные сессии использованы: начать нельзя, финал', () => {
    const s = practicalAttemptState([session('s1', 0, 'FAILED', 4), session('s2', 100, 'FAILED', 7)], task, at(200));
    expect(s.sessionsUsed).toBe(2);
    expect(s.canStart).toBe(false);
    expect(s.final).toBe(true);
    expect(s.status).toBe('FAILED');
    expect(s.latestFinishedSessionId).toBe('s2');
  });

  it('последняя попытка ещё идёт: финала нет', () => {
    const s = practicalAttemptState([session('s1', 0, 'FAILED', 4), session('s2', 100, 'IN_PROGRESS', 2)], task, at(110));
    expect(s.sessionsUsed).toBe(1);
    expect(s.final).toBe(false);
    expect(s.canStart).toBe(false);
  });

  it('окно доступности: до начала — NOT_YET_AVAILABLE с датой открытия', () => {
    const s = practicalAttemptState([], { ...task, availableFrom: iso(60), availableUntil: iso(600) }, at(0));
    expect(s.lock).toEqual({ code: 'NOT_YET_AVAILABLE', until: iso(60) });
    expect(s.canStart).toBe(false);
  });

  it('окно доступности: после окончания — CLOSED; внутри окна — без блокировки', () => {
    const w = { ...task, availableFrom: at(60), availableUntil: at(600) };
    const closed = practicalAttemptState([], w, at(601));
    expect(closed.lock).toEqual({ code: 'CLOSED', until: null });
    expect(closed.canStart).toBe(false);
    const open = practicalAttemptState([], w, at(300));
    expect(open.lock).toBeNull();
    expect(open.canStart).toBe(true);
  });
});
