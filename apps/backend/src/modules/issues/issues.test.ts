import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ContentIssueInput } from '@edu/shared';

/**
 * Жалобы на контент: валидация причины/контекста, принадлежность объекта автору,
 * суточный лимит и форма ответа ({ok: true} — и ничего о верности ответа).
 * Prisma, доступ к записи и телеметрия подменены in-memory фейками.
 */

/* ── In-memory «БД» ── */

interface Db {
  issues: { id: string; reporterId: string | null; targetType: string; targetId: string; reason: string; status: string; createdAt: Date; [k: string]: unknown }[];
  recentCount: number | null;
}
const db: Db = { issues: [], recentCount: null };

// Версии: v-ru (курс c1) — версия студента s1; v-kk (курс c1) — чужая.
const questions: Record<string, { id: string; archivedAt: Date | null; quizId: string; version: string }> = {
  'q-own': { id: 'q-own', archivedAt: null, quizId: 'quiz-ru', version: 'v-ru' },
  'q-foreign': { id: 'q-foreign', archivedAt: null, quizId: 'quiz-kk', version: 'v-kk' },
  'q-arch-answered': { id: 'q-arch-answered', archivedAt: new Date(), quizId: 'quiz-ru', version: 'v-ru' },
  'q-arch-unseen': { id: 'q-arch-unseen', archivedAt: new Date(), quizId: 'quiz-ru', version: 'v-ru' },
};
const enrollments: Record<string, { id: string; userId: string; courseId: string; languageVersionId: string; status: string }> = {
  'e-s1': { id: 'e-s1', userId: 's1', courseId: 'c1', languageVersionId: 'v-ru', status: 'ACTIVE' },
  'e-s2': { id: 'e-s2', userId: 's2', courseId: 'c1', languageVersionId: 'v-kk', status: 'ACTIVE' },
};
const messages: Record<string, { sessionEnrollmentId: string; version: string }> = {
  'm-own': { sessionEnrollmentId: 'e-s1', version: 'v-ru' },
  'm-foreign': { sessionEnrollmentId: 'e-s2', version: 'v-kk' },
};
const lectures: Record<string, string> = { 'l-own': 'v-ru', 'l-foreign': 'v-kk' };
const versions: Record<string, string> = { 'v-ru': 'c1', 'v-kk': 'c1' };

vi.mock('../../lib/prisma.js', () => {
  const quizRel = (version: string) => ({ courseLanguageVersionId: null, module: { courseLanguageVersionId: version }, lecture: null });
  return {
    prisma: {
      contentIssue: {
        count: vi.fn(async ({ where }: { where: { reporterId: string } }) => db.recentCount ?? db.issues.filter((i) => i.reporterId === where.reporterId).length),
        findFirst: vi.fn(async ({ where }: { where: { reporterId: string; targetType: string; targetId: string; reason: string; status: string } }) =>
          db.issues.find((i) => i.reporterId === where.reporterId && i.targetType === where.targetType && i.targetId === where.targetId && i.reason === where.reason && i.status === where.status) ?? null,
        ),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `ci${db.issues.length + 1}`, status: 'OPEN', createdAt: new Date(), ...data } as Db['issues'][number];
          db.issues.push(row);
          return row;
        }),
      },
      quizQuestion: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          const q = questions[where.id];
          return q ? { id: q.id, archivedAt: q.archivedAt, quizId: q.quizId, quiz: quizRel(q.version) } : null;
        }),
      },
      chatMessage: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          const m = messages[where.id];
          if (!m) return null;
          const e = enrollments[m.sessionEnrollmentId]!;
          return { session: { enrollmentId: e.id, enrollment: { userId: e.userId }, practicalTask: { module: { courseLanguageVersionId: m.version } } } };
        }),
      },
      lecture: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (lectures[where.id] ? { module: { courseLanguageVersionId: lectures[where.id] } } : null)),
      },
      practicalTask: { findUnique: vi.fn(async () => null) },
      courseLanguageVersion: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (versions[where.id] ? { courseId: versions[where.id] } : null)),
      },
      enrollment: {
        findFirst: vi.fn(async ({ where }: { where: { userId: string; languageVersionId: string } }) =>
          Object.values(enrollments).find((e) => e.userId === where.userId && e.languageVersionId === where.languageVersionId) ?? null,
        ),
      },
      quizAttempt: {
        // Студент s1 отвечал на архивный q-arch-answered в своей попытке.
        findMany: vi.fn(async ({ where }: { where: { enrollmentId: string } }) =>
          where.enrollmentId === 'e-s1' ? [{ presentation: { version: 1, questionIds: ['q-own', 'q-arch-answered'], optionOrder: {}, seed: null }, answers: { 'q-own': [1] } }] : [],
        ),
      },
    },
  };
});

vi.mock('../learn/access.js', async () => {
  const { Errors } = await import('../../lib/errors.js');
  return {
    loadOwnedEnrollment: vi.fn(async (userId: string, enrollmentId: string) => {
      const e = enrollments[enrollmentId];
      if (!e || e.userId !== userId) throw Errors.forbidden('Запись на курс не принадлежит пользователю');
      return e;
    }),
  };
});

const logEvent = vi.fn(async () => undefined);
vi.mock('../../telemetry/events.js', () => ({ logEvent: (...args: unknown[]) => (logEvent as (...a: unknown[]) => Promise<void>)(...args), audit: vi.fn() }));

const { reportIssue, validateIssueInput, isOverDailyLimit, issueAccepted, groupIssueRows, statusPatch } = await import('./issues.service.js');
const { AppError } = await import('../../lib/errors.js');

const student = { id: 's1', role: 'STUDENT' as const };
const manager = { id: 'm1', role: 'COURSE_MANAGER' as const };
const input = (over: Partial<ContentIssueInput> = {}): ContentIssueInput => ({
  targetType: 'QUIZ_QUESTION',
  targetId: 'q-own',
  reason: 'UNCLEAR',
  context: 'OFFICIAL',
  enrollmentId: 'e-s1',
  ...over,
});

async function expectError(p: Promise<unknown>, status: number, code?: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as InstanceType<typeof AppError>).statusCode).toBe(status);
    if (code) expect((e as InstanceType<typeof AppError>).code).toBe(code);
    return;
  }
  throw new Error(`ожидалась ошибка ${status}`);
}

beforeEach(() => {
  db.issues = [];
  db.recentCount = null;
  logEvent.mockClear();
});

describe('validateIssueInput — причина и контекст', () => {
  it('причина из списка своего типа объекта', () => {
    expect(() => validateIssueInput(input({ reason: 'TWO_CORRECT' }))).not.toThrow();
    expect(() => validateIssueInput(input({ targetType: 'CHAT_MESSAGE', targetId: 'm-own', reason: 'GIVES_ANSWER', context: 'PRACTICAL' }))).not.toThrow();
  });
  it('причина чужого типа → 422', () => {
    expect(() => validateIssueInput(input({ reason: 'GIVES_ANSWER' }))).toThrow(AppError);
    expect(() => validateIssueInput(input({ targetType: 'LECTURE', reason: 'TWO_CORRECT' }))).toThrow(AppError);
  });
  it('системные причины и контекст CONTENT_PIPELINE через API недоступны', () => {
    expect(() => validateIssueInput(input({ reason: 'EXPERT_REVIEW' }))).toThrow(AppError);
    expect(() => validateIssueInput(input({ context: 'CONTENT_PIPELINE' }))).toThrow(AppError);
    expect(() => validateIssueInput(input({ context: 'SOMEWHERE' }))).toThrow(AppError);
  });
  it('слишком длинный комментарий → 422', () => {
    expect(() => validateIssueInput(input({ comment: 'x'.repeat(2001) }))).toThrow(AppError);
  });
});

describe('reportIssue — принадлежность объекта', () => {
  it('вопрос своей версии → запись с курсом, версией и записью на курс', async () => {
    await reportIssue(student, input());
    expect(db.issues).toHaveLength(1);
    expect(db.issues[0]).toMatchObject({ origin: 'STUDENT', reporterId: 's1', enrollmentId: 'e-s1', courseId: 'c1', languageVersionId: 'v-ru', targetId: 'q-own' });
  });
  it('без enrollmentId запись находится по версии объекта', async () => {
    await reportIssue(student, input({ enrollmentId: undefined }));
    expect(db.issues[0]).toMatchObject({ enrollmentId: 'e-s1' });
  });
  it('вопрос чужой версии → 403', async () => {
    await expectError(reportIssue(student, input({ targetId: 'q-foreign' })), 403);
    await expectError(reportIssue(student, input({ targetId: 'q-foreign', enrollmentId: undefined })), 403);
    expect(db.issues).toHaveLength(0);
  });
  it('чужая запись на курс → 403', async () => {
    await expectError(reportIssue(student, input({ enrollmentId: 'e-s2' })), 403);
  });
  it('архивный вопрос — только если студент на него отвечал', async () => {
    await reportIssue(student, input({ targetId: 'q-arch-answered', context: 'REVIEW' }));
    await expectError(reportIssue(student, input({ targetId: 'q-arch-unseen', context: 'REVIEW' })), 404);
  });
  it('реплика тьютора — только из своей сессии', async () => {
    await reportIssue(student, input({ targetType: 'CHAT_MESSAGE', targetId: 'm-own', reason: 'GIVES_ANSWER', context: 'PRACTICAL', enrollmentId: undefined }));
    await expectError(reportIssue(student, input({ targetType: 'CHAT_MESSAGE', targetId: 'm-foreign', reason: 'GIVES_ANSWER', context: 'PRACTICAL', enrollmentId: undefined })), 403);
    expect(db.issues).toHaveLength(1);
  });
  it('лекция чужой версии → 403; несуществующий объект → 404', async () => {
    await expectError(reportIssue(student, input({ targetType: 'LECTURE', targetId: 'l-foreign', reason: 'VIDEO', context: 'LECTURE' })), 403);
    await expectError(reportIssue(student, input({ targetType: 'LECTURE', targetId: 'nope', reason: 'VIDEO', context: 'LECTURE' })), 404);
  });
  it('сотрудник может сообщить о любом существующем объекте (без записи на курс)', async () => {
    await reportIssue(manager, input({ targetId: 'q-foreign', enrollmentId: undefined }));
    expect(db.issues[0]).toMatchObject({ reporterId: 'm1', enrollmentId: null, languageVersionId: 'v-kk' });
  });
});

describe('reportIssue — суточный лимит', () => {
  it('isOverDailyLimit: 30 в сутки', () => {
    expect(isOverDailyLimit(29)).toBe(false);
    expect(isOverDailyLimit(30)).toBe(true);
  });
  it('на лимите → 429, запись не создаётся', async () => {
    db.recentCount = 30;
    await expectError(reportIssue(student, input()), 429, 'TOO_MANY_REQUESTS');
    expect(db.issues).toHaveLength(0);
  });
  it('ниже лимита → принято', async () => {
    db.recentCount = 29;
    await expect(reportIssue(student, input())).resolves.toEqual({ ok: true });
  });
});

describe('reportIssue — форма ответа и телеметрия', () => {
  it('ответ — ровно {ok: true}, без сведений о верности', async () => {
    const res = await reportIssue(student, input({ reason: 'NO_CORRECT', comment: 'Кажется, верного варианта нет' }));
    expect(res).toEqual({ ok: true });
    expect(Object.keys(res)).toEqual(['ok']);
    expect(JSON.stringify(res)).not.toMatch(/correct|isCorrect|explanation/i);
    expect(issueAccepted()).toEqual({ ok: true });
  });
  it('повтор той же жалобы не дублируется, ответ тот же', async () => {
    await reportIssue(student, input());
    const again = await reportIssue(student, input());
    expect(again).toEqual({ ok: true });
    expect(db.issues).toHaveLength(1);
    expect(logEvent).toHaveBeenCalledTimes(1);
  });
  it('CONTENT_ISSUE_REPORTED — {targetType, reason, context}', async () => {
    await reportIssue(student, input({ context: 'PRACTICE' }));
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'CONTENT_ISSUE_REPORTED', userId: 's1', enrollmentId: 'e-s1', payload: { targetType: 'QUIZ_QUESTION', reason: 'UNCLEAR', context: 'PRACTICE' } }),
    );
  });
});

describe('очередь сотрудника', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 'i1', origin: 'STUDENT', reporterId: 's1', reason: 'UNCLEAR', comment: null, context: 'OFFICIAL', status: 'OPEN',
    createdAt: new Date('2026-09-25T10:00:00Z'), courseId: 'c1', languageVersionId: 'v-ru', targetType: 'QUIZ_QUESTION', targetId: 'q1', ...over,
  }) as Parameters<typeof groupIssueRows>[0][number];

  it('groupIssueRows: авторы, причины, статус и происхождение группы', () => {
    const g = groupIssueRows([
      row({ id: 'i3', reporterId: 's2', reason: 'TWO_CORRECT', comment: 'два верных', createdAt: new Date('2026-09-25T12:00:00Z') }),
      row({ id: 'i2', reporterId: 's1', reason: 'TWO_CORRECT', status: 'RESOLVED' }),
      row({ id: 'i1', reporterId: null, origin: 'SYSTEM', reason: 'EXPERT_REVIEW', context: 'CONTENT_PIPELINE' }),
    ]);
    expect(g).toMatchObject({ key: 'QUIZ_QUESTION:q1', reporterCount: 2, issueCount: 3, status: 'OPEN', origin: 'MIXED', latestAt: '2026-09-25T12:00:00.000Z' });
    expect(g.reasons).toEqual([{ reason: 'TWO_CORRECT', count: 2 }, { reason: 'EXPERT_REVIEW', count: 1 }]);
    expect(g.openIssueIds).toEqual(['i3', 'i1']);
    expect(g.comments).toEqual([{ text: 'два верных', reason: 'TWO_CORRECT', origin: 'STUDENT', createdAt: '2026-09-25T12:00:00.000Z' }]);
  });

  it('statusPatch: закрытие фиксирует кто/когда, переоткрытие сбрасывает', () => {
    const now = new Date('2026-09-25T12:00:00Z');
    expect(statusPatch('RESOLVED', 'm1', ' проверено ', now)).toEqual({ status: 'RESOLVED', resolvedById: 'm1', resolvedAt: now, note: 'проверено' });
    expect(statusPatch('OPEN', 'm1', undefined, now)).toEqual({ status: 'OPEN', resolvedById: null, resolvedAt: null });
  });
});
