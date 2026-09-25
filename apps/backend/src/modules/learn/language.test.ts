import { describe, it, expect } from 'vitest';
import { languageLockState, lockFromActivity, matchParallelLectures, type LanguageLockDb } from './language.js';

/**
 * Блокировка языка курса после первой оцениваемой активности (USER_DECISIONS §3)
 * и перенос пройденных лекций на параллельную версию.
 */

/** Фейковая БД: запоминает запросы и отвечает по заданным фактам. */
function fakeDb(facts: { gradedAttempt?: boolean; studentReply?: boolean }) {
  const calls: { model: string; where: unknown }[] = [];
  const db = {
    quizAttempt: {
      findFirst: async (args: { where: unknown }) => {
        calls.push({ model: 'quizAttempt', where: args.where });
        return facts.gradedAttempt ? { id: 'a1' } : null;
      },
    },
    chatMessage: {
      findFirst: async (args: { where: unknown }) => {
        calls.push({ model: 'chatMessage', where: args.where });
        return facts.studentReply ? { id: 'm1' } : null;
      },
    },
  };
  return { db: db as unknown as LanguageLockDb, calls };
}

describe('languageLockState', () => {
  it('нет оцениваемой активности — язык можно сменить', async () => {
    const { db, calls } = fakeDb({});
    expect(await languageLockState(db, 'e1', 'after_first_graded')).toEqual({ locked: false, reason: null });
    // Ищем попытку именно ОЦЕНИВАЕМОГО теста этой записи (отправленную или в процессе)
    expect(calls[0]).toEqual({ model: 'quizAttempt', where: { enrollmentId: 'e1', quiz: { isGraded: true } } });
    expect(calls[1]).toEqual({ model: 'chatMessage', where: { role: 'STUDENT', session: { enrollmentId: 'e1' } } });
  });

  it('попытка оцениваемого теста → GRADED_QUIZ (реплики уже не проверяются)', async () => {
    const { db, calls } = fakeDb({ gradedAttempt: true, studentReply: true });
    expect(await languageLockState(db, 'e1', 'after_first_graded')).toEqual({ locked: true, reason: 'GRADED_QUIZ' });
    expect(calls).toHaveLength(1);
  });

  it('реплика студента в практикуме → PRACTICAL_REPLY', async () => {
    const { db } = fakeDb({ studentReply: true });
    expect(await languageLockState(db, 'e1', 'after_first_graded')).toEqual({ locked: true, reason: 'PRACTICAL_REPLY' });
  });

  it('LANGUAGE_LOCK=never — всегда разблокировано, без запросов к БД', async () => {
    const { db, calls } = fakeDb({ gradedAttempt: true, studentReply: true });
    expect(await languageLockState(db, 'e1', 'never')).toEqual({ locked: false, reason: null });
    expect(calls).toHaveLength(0);
  });

  it('чистое правило для пакетной проверки (/me/courses) совпадает с одиночной', () => {
    expect(lockFromActivity({ gradedAttempt: true, practicalReply: true }, 'after_first_graded')).toEqual({ locked: true, reason: 'GRADED_QUIZ' });
    expect(lockFromActivity({ gradedAttempt: false, practicalReply: true }, 'after_first_graded')).toEqual({ locked: true, reason: 'PRACTICAL_REPLY' });
    expect(lockFromActivity({ gradedAttempt: false, practicalReply: false }, 'after_first_graded')).toEqual({ locked: false, reason: null });
    expect(lockFromActivity({ gradedAttempt: true, practicalReply: true }, 'never')).toEqual({ locked: false, reason: null });
  });
});

describe('matchParallelLectures', () => {
  const ru = [
    { orderIndex: 0, lectures: [{ id: 'ru-0-0', orderIndex: 0 }, { id: 'ru-0-1', orderIndex: 1 }] },
    { orderIndex: 1, lectures: [{ id: 'ru-1-0', orderIndex: 0 }, { id: 'ru-1-1', orderIndex: 1 }, { id: 'ru-1-2', orderIndex: 2 }] },
  ];

  it('сопоставляет по (порядок модуля, порядок лекции), а не по id/названию', () => {
    const kk = [
      { orderIndex: 1, lectures: [{ id: 'kk-1-2', orderIndex: 2 }, { id: 'kk-1-0', orderIndex: 0 }, { id: 'kk-1-1', orderIndex: 1 }] },
      { orderIndex: 0, lectures: [{ id: 'kk-0-1', orderIndex: 1 }, { id: 'kk-0-0', orderIndex: 0 }] },
    ];
    const map = matchParallelLectures(ru, kk);
    expect(map.size).toBe(5);
    expect(map.get('ru-0-0')).toBe('kk-0-0');
    expect(map.get('ru-1-2')).toBe('kk-1-2');
  });

  it('лекции без пары (разная структура) не переносятся', () => {
    const en = [{ orderIndex: 0, lectures: [{ id: 'en-0-0', orderIndex: 0 }] }];
    const map = matchParallelLectures(ru, en);
    expect([...map.entries()]).toEqual([['ru-0-0', 'en-0-0']]);
    expect(matchParallelLectures([], en).size).toBe(0);
  });
});
