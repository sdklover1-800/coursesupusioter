import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ADMITTED_ENROLLMENT_STATUSES, Role, type QuizRulesInput, type SessionStatus } from '@edu/shared';
import type { RubricAggregate } from '../../llm/schemas/dialog.js';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { Errors } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { loadQuiz, rulesOf } from '../quizzes/attempts.service.js';
import { parseStoredAnswers, presentedQuestions } from '../quizzes/policy.js';
import {
  columnAverages,
  itemStats,
  lectureCell,
  meanOf,
  practicalCell,
  practicalOutcome,
  practicalPassRate,
  quizCell,
  quizOutcome,
  type AttemptLite,
  type MatrixCell,
  type MatrixColumn,
  type PracticalOutcome,
  type SessionLite,
} from './analytics.js';

const guard = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.COURSE_MANAGER, Role.ADMIN)] });
const adminOnly = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.ADMIN)] });

/**
 * Статистика учитывает только допущенных к курсу (ACTIVE/COMPLETED): заявки
 * PENDING/REJECTED — не участники, иначе они занижали бы прогресс/завершаемость.
 * Попытки тестов и сессии без фильтра по статусу записи: создать их можно только
 * при одобренной записи (гейт loadOwnedEnrollment), фильтр по текущему статусу лишь
 * терял бы историю. Баллы — ТОЛЬКО по отправленным попыткам (submittedAt != null),
 * исследовательские показатели — по записи на курс, n = студенты (A16).
 */
const admitted = { status: { in: [...ADMITTED_ENROLLMENT_STATUSES] } };

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** FR-10.6 (аудит M1): менеджер видит только СВОИ курсы; администратор — все. */
function assertCourseAccess(user: { id: string; role: string }, course: { createdById: string | null }): void {
  if (user.role === Role.COURSE_MANAGER && course.createdById !== user.id) {
    throw Errors.forbidden('Дашборд доступен только автору курса');
  }
}

/* ── Загрузка данных ─────────────────────────────────────────────────── */

const attemptSelect = { id: true, enrollmentId: true, quizId: true, startedAt: true, submittedAt: true, score: true, passed: true } satisfies Prisma.QuizAttemptSelect;
type AttemptRow = Prisma.QuizAttemptGetPayload<{ select: typeof attemptSelect }>;

/** Итог по тесту для каждой пары (запись, тест). */
function quizOutcomes(attempts: readonly AttemptRow[], rules: ReadonlyMap<string, QuizRulesInput>, now = new Date()) {
  const groups = new Map<string, AttemptRow[]>();
  for (const a of attempts) {
    const k = `${a.enrollmentId}:${a.quizId}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(a);
  }
  const out = new Map<string, ReturnType<typeof quizOutcome> & { enrollmentId: string; quizId: string }>();
  for (const [k, list] of groups) {
    const r = rules.get(list[0]!.quizId);
    if (!r) continue;
    out.set(k, { ...quizOutcome(list, r, now), enrollmentId: list[0]!.enrollmentId, quizId: list[0]!.quizId });
  }
  return out;
}

/** Сессии практикума с числом реплик СТУДЕНТА (зачётность сессии, A7). */
async function loadSessions(where: Prisma.PracticalSessionWhereInput) {
  const sessions = await prisma.practicalSession.findMany({
    where,
    select: {
      id: true,
      enrollmentId: true,
      practicalTaskId: true,
      status: true,
      startedAt: true,
      endedAt: true,
      excusedAt: true,
      verdictCode: true,
      tokensUsed: true,
      aiMessageCount: true,
      evaluationResult: true,
      practicalTask: { select: { maxSessions: true } },
    },
  });
  const counts = sessions.length
    ? await prisma.chatMessage.groupBy({ by: ['sessionId'], where: { role: 'STUDENT', sessionId: { in: sessions.map((s) => s.id) } }, _count: { _all: true } })
    : [];
  const byId = new Map(counts.map((c) => [c.sessionId, c._count._all]));
  return sessions.map((s) => ({ ...s, userMessageCount: byId.get(s.id) ?? 0 }));
}
type SessionRow = Awaited<ReturnType<typeof loadSessions>>[number];

const toLite = (s: SessionRow): SessionLite => ({
  id: s.id,
  status: s.status as SessionStatus,
  startedAt: s.startedAt,
  endedAt: s.endedAt,
  userMessageCount: s.userMessageCount,
  excusedAt: s.excusedAt,
  verdictCode: s.verdictCode,
});

/** Итог практикума для каждой пары (запись, задание). */
function practicalOutcomes(sessions: readonly SessionRow[], now = new Date()): Map<string, PracticalOutcome & { enrollmentId: string; taskId: string }> {
  const groups = new Map<string, SessionRow[]>();
  for (const s of sessions) {
    const k = `${s.enrollmentId}:${s.practicalTaskId}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
  }
  const out = new Map<string, PracticalOutcome & { enrollmentId: string; taskId: string }>();
  for (const [k, list] of groups) {
    out.set(k, { ...practicalOutcome(list.map(toLite), list[0]!.practicalTask.maxSessions, now), enrollmentId: list[0]!.enrollmentId, taskId: list[0]!.practicalTaskId });
  }
  return out;
}

/**
 * Сводка по практикуму (FR-10.3, 10.4). Токены, реплики, стоимость, рубрика — по
 * сессиям (это их свойства); сдача — ПО ЗАПИСИ (A16): passRate = сдавшие / (сдавшие +
 * исчерпавшие попытки), n — число записей (студентов) с хотя бы одной сессией.
 * passed/failed/abandoned — по-прежнему число СЕССИЙ (для мониторинга нагрузки).
 */
function summarizePractical(sessions: readonly SessionRow[]) {
  const done = sessions.filter((s) => s.status === 'PASSED' || s.status === 'FAILED');
  const passed = sessions.filter((s) => s.status === 'PASSED').length;
  const failed = sessions.filter((s) => s.status === 'FAILED').length;
  const abandoned = sessions.filter((s) => s.status === 'ABANDONED').length;
  const totalTokens = sessions.reduce((s, x) => s + x.tokensUsed, 0);
  const avgTokens = done.length ? Math.round(done.reduce((s, x) => s + x.tokensUsed, 0) / done.length) : 0;
  const avgMessages = done.length ? +(done.reduce((s, x) => s + x.aiMessageCount, 0) / done.length).toFixed(1) : 0;
  // §5.6h: оценка стоимости (blended rate; точная цена — по прайсу модели пилота).
  const blended = (env.LLM_PRICE_INPUT_PER_MTOK + env.LLM_PRICE_OUTPUT_PER_MTOK) / 2;
  const estCostUsd = +((totalTokens / 1_000_000) * blended).toFixed(4);

  const rubricDims = ['avg_methodicalness', 'avg_question_quality', 'avg_logical_progression', 'avg_self_correction'] as const;
  const acc: Record<string, number> = {};
  let n = 0;
  for (const s of sessions) {
    const e = s.evaluationResult as RubricAggregate | null;
    if (e && typeof e.avg_methodicalness === 'number') {
      n++;
      for (const d of rubricDims) acc[d] = (acc[d] ?? 0) + (e[d] as number);
    }
  }
  const rubric = Object.fromEntries(rubricDims.map((d) => [d, n ? +(acc[d]! / n).toFixed(2) : 0]));
  const perEnrollment = practicalPassRate([...practicalOutcomes(sessions).values()]);

  return {
    total: sessions.length, passed, failed, abandoned,
    n: perEnrollment.n,
    studentsPassed: perEnrollment.passed,
    studentsFailed: perEnrollment.failed,
    studentsInProgress: perEnrollment.inProgress,
    passRate: perEnrollment.passRate,
    avgTokens, avgMessages, totalTokens, estCostUsd, rubric,
    rubricN: n,
  };
}

/** Правила попыток тестов по id. */
function rulesMap(quizzes: readonly { id: string; maxAttempts: number; cooldownMinutes: number | null; scoringRule: string }[]): Map<string, QuizRulesInput> {
  return new Map(quizzes.map((q) => [q.id, rulesOf(q)]));
}

const quizRuleSelect = { id: true, title: true, maxAttempts: true, cooldownMinutes: true, scoringRule: true, isGraded: true } satisfies Prisma.QuizSelect;

/** Дашборды и аналитика (FR-10, §11.4). Подробные метрики — явное требование. */
export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  // GET /dashboards/courses/:id — метрики по курсу (FR-10.2, 10.3, 10.4).
  app.get('/dashboards/courses/:id', guard(app), async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const course = await prisma.course.findUnique({
      where: { id },
      include: { languageVersions: { include: { modules: { orderBy: { orderIndex: 'asc' }, include: { quiz: { select: quizRuleSelect }, practicalTask: { select: { id: true } } } } } } },
    });
    if (!course) throw Errors.notFound('Курс не найден');
    assertCourseAccess(req.user!, course);

    const enrollments = await prisma.enrollment.findMany({ where: { courseId: id, ...admitted } });
    const total = enrollments.length;
    const completed = enrollments.filter((e) => e.status === 'COMPLETED').length;
    const avgProgress = total ? enrollments.reduce((s, e) => s + e.progressPercent, 0) / total : 0;

    // Тесты: зачётный балл по записи (не среднее по попыткам), «сложные» вопросы.
    const quizMeta = course.languageVersions.flatMap((v) =>
      v.modules.filter((m) => m.quiz).map((m) => ({ ...m.quiz!, language: v.language, moduleOrderIndex: m.orderIndex })),
    );
    const quizIds = quizMeta.map((q) => q.id);
    const attempts = await prisma.quizAttempt.findMany({ where: { quizId: { in: quizIds }, submittedAt: { not: null } }, select: attemptSelect });
    const outcomes = [...quizOutcomes(attempts, rulesMap(quizMeta)).values()];
    const counted = meanOf(outcomes.map((o) => o.countedScore));
    const byQuiz = quizMeta.map((q) => {
      const own = outcomes.filter((o) => o.quizId === q.id);
      const m = meanOf(own.map((o) => o.countedScore));
      const decided = own.filter((o) => o.passed || o.finalReached);
      return {
        quizId: q.id,
        title: q.title,
        language: q.language,
        moduleOrderIndex: q.moduleOrderIndex,
        n: m.n,
        avgCountedScore: m.mean === null ? null : +m.mean.toFixed(3),
        passRate: decided.length ? +(decided.filter((o) => o.passed).length / decided.length).toFixed(3) : null,
        attempts: attempts.filter((a) => a.quizId === q.id).length,
      };
    });
    const hardQuestions = await computeHardQuestions(quizIds);

    // Практические: сдача по записи, средний расход токенов, реплики, рубрика.
    const practicalTaskIds = course.languageVersions.flatMap((v) => v.modules.map((m) => m.practicalTask?.id).filter(Boolean) as string[]);
    const sessions = await loadSessions({ practicalTaskId: { in: practicalTaskIds } });

    return {
      course: { id: course.id, status: course.status },
      enrollment: { total, n: total, completed, completionRate: total ? completed / total : 0, avgProgress: +avgProgress.toFixed(1) },
      quizzes: {
        attempts: attempts.length,
        // Средний ЗАЧЁТНЫЙ балл по парам (студент, тест); n — студентов с баллом
        avgScore: counted.mean === null ? 0 : +counted.mean.toFixed(3),
        n: new Set(outcomes.filter((o) => o.countedScore !== null).map((o) => o.enrollmentId)).size,
        byQuiz,
        hardQuestions,
      },
      practical: summarizePractical(sessions),
    };
  });

  // GET /dashboards/courses/:id/students — метрики по отдельным студентам (FR-10.2):
  // прогресс, зачётные баллы тестов, итог практикума, время прохождения.
  app.get('/dashboards/courses/:id/students', guard(app), async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const course = await prisma.course.findUnique({
      where: { id },
      include: { languageVersions: { include: { modules: { include: { quiz: { select: quizRuleSelect } } } } } },
    });
    if (!course) throw Errors.notFound('Курс не найден');
    if (req.user!.role === Role.COURSE_MANAGER && course.createdById !== req.user!.id) throw Errors.forbidden('Только автор курса');

    const quizzes = course.languageVersions.flatMap((v) => v.modules.map((m) => m.quiz).filter((q): q is NonNullable<typeof q> => !!q && q.isGraded));
    const rules = rulesMap(quizzes);
    const enrollments = await prisma.enrollment.findMany({
      where: { courseId: id, ...admitted },
      include: {
        user: { select: { id: true, name: true, cohortId: true } },
        quizAttempts: { select: attemptSelect },
        languageVersion: { select: { language: true } },
      },
    });
    const sessions = await loadSessions({ enrollment: { courseId: id } });
    const practical = practicalOutcomes(sessions);

    const students = enrollments.map((e) => {
      const outcomes = [...quizOutcomes(e.quizAttempts, rules).values()];
      const own = [...practical.values()].filter((o) => o.enrollmentId === e.id);
      const mySessions = sessions.filter((s) => s.enrollmentId === e.id);
      const avg = meanOf(outcomes.map((o) => o.countedScore));
      // «Время прохождения» — от старта до завершения (FR-10.2)
      const durationMs = e.completedAt ? e.completedAt.getTime() - e.startedAt.getTime() : null;
      return {
        studentId: e.user.id,
        enrollmentId: e.id,
        name: e.user.name,
        cohortId: e.user.cohortId,
        language: e.languageVersion.language,
        progressPercent: e.progressPercent,
        status: e.status,
        // Среднее ЗАЧЁТНЫХ баллов по тестам (раньше — среднее всех попыток)
        avgQuizScore: avg.mean === null ? null : +avg.mean.toFixed(2),
        quizAttempts: e.quizAttempts.filter((a) => a.submittedAt !== null).length,
        quizzes: outcomes.map((o) => ({ quizId: o.quizId, countedScore: o.countedScore, passed: o.passed, finalReached: o.finalReached, attempts: o.submittedCount })),
        practicalPassed: own.filter((o) => o.outcome === 'PASSED').length,
        practicalOutcome: own[0] ? { outcome: own[0].outcome, verdict: own[0].verdict, sessionsUsed: own[0].sessionsUsed } : null,
        practicalMessages: mySessions.reduce((s, x) => s + x.aiMessageCount, 0),
        startedAt: e.startedAt,
        completedAt: e.completedAt,
        durationDays: durationMs != null ? +(durationMs / 86_400_000).toFixed(1) : null,
      };
    });
    return { students, n: students.length };
  });

  // GET /dashboards/courses/:id/matrix?languageVersionId&cohortId — матрица «студенты ×
  // элементы курса»: лекции, тесты модулей (зачётный балл), практикум; итоговая строка.
  app.get('/dashboards/courses/:id/matrix', guard(app), async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const q = parse(z.object({ languageVersionId: z.string().optional(), cohortId: z.string().optional() }), req.query);
    const course = await prisma.course.findUnique({
      where: { id },
      select: { id: true, createdById: true, languageVersions: { orderBy: { createdAt: 'asc' }, select: { id: true, language: true, title: true } } },
    });
    if (!course) throw Errors.notFound('Курс не найден');
    assertCourseAccess(req.user!, course);
    const versionId = q.languageVersionId ?? course.languageVersions[0]?.id;
    if (!versionId || !course.languageVersions.some((v) => v.id === versionId)) throw Errors.notFound('Языковая версия не найдена');

    const modules = await prisma.module.findMany({
      where: { courseLanguageVersionId: versionId },
      orderBy: { orderIndex: 'asc' },
      select: {
        orderIndex: true,
        title: true,
        lectures: { orderBy: { orderIndex: 'asc' }, select: { id: true, title: true } },
        quiz: { select: quizRuleSelect },
        practicalTask: { select: { id: true, title: true, maxSessions: true } },
      },
    });
    const columns: MatrixColumn[] = [];
    let lectureNo = 0;
    for (const m of modules) {
      const roman = ROMAN[m.orderIndex] ?? String(m.orderIndex + 1);
      for (const l of m.lectures) columns.push({ key: l.id, kind: 'LECTURE', moduleOrderIndex: m.orderIndex, label: String(++lectureNo), title: l.title });
      if (m.quiz?.isGraded) columns.push({ key: m.quiz.id, kind: 'MODULE_QUIZ', moduleOrderIndex: m.orderIndex, label: roman, title: m.quiz.title });
      if (m.practicalTask) columns.push({ key: m.practicalTask.id, kind: 'PRACTICAL', moduleOrderIndex: m.orderIndex, label: roman, title: m.practicalTask.title });
    }
    const quizzes = modules.map((m) => m.quiz).filter((x): x is NonNullable<typeof x> => !!x && x.isGraded);
    const rules = rulesMap(quizzes);
    const maxSessions = new Map(modules.filter((m) => m.practicalTask).map((m) => [m.practicalTask!.id, m.practicalTask!.maxSessions]));

    const enrollments = await prisma.enrollment.findMany({
      where: { courseId: id, languageVersionId: versionId, ...admitted, ...(q.cohortId ? { user: { cohortId: q.cohortId } } : {}) },
      select: {
        id: true,
        user: { select: { id: true, name: true, cohort: { select: { id: true, name: true, condition: true } } } },
        lectureProgress: { select: { lectureId: true, isCompleted: true, positionSec: true, watchedSec: true, lastViewedAt: true } },
        quizAttempts: { where: { quizId: { in: quizzes.map((x) => x.id) } }, select: attemptSelect },
      },
      orderBy: { user: { name: 'asc' } },
    });
    const sessions = await loadSessions({ enrollmentId: { in: enrollments.map((e) => e.id) }, practicalTaskId: { in: [...maxSessions.keys()] } });
    const now = new Date();

    const rows = enrollments.map((e) => {
      const progress = new Map(e.lectureProgress.map((p) => [p.lectureId, p]));
      const cells: MatrixCell[] = columns.map((c) => {
        if (c.kind === 'LECTURE') return lectureCell(progress.get(c.key));
        if (c.kind === 'MODULE_QUIZ') {
          const own: AttemptLite[] = e.quizAttempts.filter((a) => a.quizId === c.key);
          return quizCell(own, rules.get(c.key)!, now);
        }
        const own = sessions.filter((s) => s.enrollmentId === e.id && s.practicalTaskId === c.key).map(toLite);
        return practicalCell(own, maxSessions.get(c.key) ?? 2, now);
      });
      return { studentId: e.user.id, enrollmentId: e.id, name: e.user.name, cohort: e.user.cohort, cells };
    });

    return {
      languageVersionId: versionId,
      versions: course.languageVersions,
      columns,
      rows,
      averages: columnAverages(columns, rows),
      n: rows.length,
    };
  });

  // GET /dashboards/quizzes/:id/items[?includeArchived=1][&attemptNumber=1] — анализ заданий:
  // p-value, выборы по каноническим вариантам, пропуски, открытые жалобы. Только
  // отправленные попытки; attemptNumber=1 — только первые попытки (без влияния разбора).
  app.get('/dashboards/quizzes/:id/items', guard(app), async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const q = parse(
      z.object({ includeArchived: z.enum(['0', '1', 'true', 'false']).optional(), attemptNumber: z.coerce.number().int().min(1).max(10).optional() }),
      req.query,
    );
    const quiz = await loadQuiz(id);
    const version = quiz.versionId
      ? await prisma.courseLanguageVersion.findUnique({ where: { id: quiz.versionId }, select: { courseId: true, language: true, course: { select: { createdById: true } } } })
      : null;
    if (!version) throw Errors.notFound('Курс теста не найден');
    assertCourseAccess(req.user!, version.course);

    const all = await prisma.quizAttempt.findMany({
      where: { quizId: id, submittedAt: { not: null } },
      select: { id: true, enrollmentId: true, startedAt: true, presentation: true, answers: true },
      orderBy: { startedAt: 'asc' },
    });
    // Номер попытки внутри записи — по порядку начала (все отправленные идут подряд).
    const seen = new Map<string, number>();
    const numbered = all.map((a) => {
      const n = (seen.get(a.enrollmentId) ?? 0) + 1;
      seen.set(a.enrollmentId, n);
      return { ...a, attemptNumber: n };
    });
    const attempts = q.attemptNumber ? numbered.filter((a) => a.attemptNumber === q.attemptNumber) : numbered;

    const withArchived = q.includeArchived === '1' || q.includeArchived === 'true';
    const questions = withArchived ? [...quiz.questions].sort((a, b) => a.orderIndex - b.orderIndex) : quiz.active;
    const rows = await prisma.quizQuestion.findMany({ where: { id: { in: questions.map((x) => x.id) } }, select: { id: true, canonicalKey: true, archivedAt: true } });
    const meta = new Map(rows.map((r) => [r.id, r]));
    const stats = itemStats(
      questions.map((x) => ({ id: x.id, canonicalKey: meta.get(x.id)?.canonicalKey ?? null, prompt: x.prompt, options: x.options, correctOptionIds: x.correctOptionIds })),
      attempts.map((a) => ({ presentedIds: presentedQuestions(a, quiz.questions).map((p) => p.id), answers: parseStoredAnswers(a.answers) })),
    );
    const issues = questions.length
      ? await prisma.contentIssue.groupBy({
          by: ['targetId', 'origin'],
          where: { targetType: 'QUIZ_QUESTION', status: 'OPEN', targetId: { in: questions.map((x) => x.id) } },
          _count: { _all: true },
        })
      : [];
    const openIssues = new Map<string, number>();
    const pending = new Set<string>();
    for (const g of issues) {
      if (g.origin === 'STUDENT') openIssues.set(g.targetId, g._count._all);
      else pending.add(g.targetId);
    }
    return {
      quizId: id,
      title: quiz.row.title,
      language: version.language,
      attempts: attempts.length,
      n: new Set(attempts.map((a) => a.enrollmentId)).size,
      items: stats.map((s) => ({
        ...s,
        archived: meta.get(s.questionId)?.archivedAt != null,
        openIssues: openIssues.get(s.questionId) ?? 0,
        reviewPending: pending.has(s.questionId),
      })),
    };
  });

  // GET /dashboards/overview — сводные метрики (ADMIN, FR-10.6).
  app.get('/dashboards/overview', adminOnly(app), async () => {
    const [users, students, registeredStudents, courses, publishedVersions, enrollments, completedEnrollments, pendingRequests, sessions, certificates] = await Promise.all([
      prisma.user.count(),
      // Студенты-участники: хотя бы одна одобренная запись (самозарегистрированные
      // без одобренной заявки сюда не входят — они в registeredStudents).
      prisma.user.count({ where: { role: 'STUDENT', enrollments: { some: admitted } } }),
      prisma.user.count({ where: { role: 'STUDENT' } }),
      prisma.course.count(),
      prisma.courseLanguageVersion.count({ where: { status: 'PUBLISHED' } }),
      prisma.enrollment.count({ where: admitted }),
      prisma.enrollment.count({ where: { status: 'COMPLETED' } }),
      prisma.enrollment.count({ where: { status: 'PENDING' } }),
      loadSessions({}),
      prisma.certificate.count(),
    ]);
    return {
      users, students, registeredStudents, courses, publishedVersions, enrollments, completedEnrollments, pendingRequests, certificates,
      n: students,
      practical: summarizePractical(sessions),
    };
  });

  // GET /dashboards/cohorts — сравнение когорт (ADMIN, FR-10.5, FR-R.5).
  // Без N+1 (аудит M4): enrollments и сессии — по одному запросу, группировка в памяти.
  // n — студенты когорты с допущенной записью (показатели по записи, A16).
  app.get('/dashboards/cohorts', adminOnly(app), async () => {
    const cohorts = await prisma.cohort.findMany({ include: { users: { select: { id: true } }, _count: { select: { teacherSessions: true } } } });
    const userToCohort = new Map<string, string>();
    for (const c of cohorts) for (const u of c.users) userToCohort.set(u.id, c.id);
    const userIds = [...userToCohort.keys()];

    const [enrollments, sessions] = await Promise.all([
      prisma.enrollment.findMany({ where: { userId: { in: userIds }, ...admitted }, select: { id: true, userId: true, status: true } }),
      loadSessions({ enrollment: { userId: { in: userIds } } }),
    ]);
    const enrUser = new Map(enrollments.map((e) => [e.id, e.userId]));

    const enrByCohort = new Map<string, typeof enrollments>();
    for (const e of enrollments) {
      const cid = userToCohort.get(e.userId);
      if (cid) (enrByCohort.get(cid) ?? enrByCohort.set(cid, []).get(cid)!).push(e);
    }
    const sessByCohort = new Map<string, SessionRow[]>();
    for (const s of sessions) {
      const uid = enrUser.get(s.enrollmentId);
      const cid = uid ? userToCohort.get(uid) : undefined;
      if (cid) (sessByCohort.get(cid) ?? sessByCohort.set(cid, []).get(cid)!).push(s);
    }

    const rows = cohorts.map((c) => {
      const enr = enrByCohort.get(c.id) ?? [];
      const practical = summarizePractical(sessByCohort.get(c.id) ?? []);
      return {
        cohortId: c.id, name: c.name, condition: c.condition, students: c.users.length,
        n: new Set(enr.map((e) => e.userId)).size,
        enrollments: enr.length,
        completionRate: enr.length ? enr.filter((e) => e.status === 'COMPLETED').length / enr.length : 0,
        teacherSessions: c._count.teacherSessions, // FR-R.9
        practical,
      };
    });
    return { cohorts: rows };
  });
}

/**
 * «Сложные» вопросы: доля ошибок по каждому вопросу теста (FR-10.3). Только
 * отправленные попытки и действующие вопросы.
 * L6: учитываем только ФАКТИЧЕСКИ отвеченные вопросы — пропущенный вопрос не
 * считается ошибкой (иначе errorRate завышается пустыми ответами).
 */
async function computeHardQuestions(quizIds: string[]): Promise<{ questionId: string; prompt: string; errorRate: number; attempts: number }[]> {
  if (quizIds.length === 0) return [];
  const questions = await prisma.quizQuestion.findMany({ where: { quizId: { in: quizIds }, archivedAt: null } });
  const byQuiz = new Map<string, typeof questions>();
  for (const q of questions) (byQuiz.get(q.quizId) ?? byQuiz.set(q.quizId, []).get(q.quizId)!).push(q);
  const attempts = await prisma.quizAttempt.findMany({ where: { quizId: { in: quizIds }, submittedAt: { not: null } }, select: { quizId: true, answers: true } });
  const stats = new Map<string, { correct: number; total: number }>();
  for (const q of questions) stats.set(q.id, { correct: 0, total: 0 });
  for (const a of attempts) {
    const answers = parseStoredAnswers(a.answers);
    for (const q of byQuiz.get(a.quizId) ?? []) {
      const given = answers[q.id];
      if (!given || given.length === 0) continue; // вопрос не отвечали — не считаем
      const s = stats.get(q.id)!;
      s.total++;
      const g = [...given].sort((x, y) => x - y);
      const expected = (q.correctOptionIds as number[]).slice().sort((x, y) => x - y);
      if (g.length === expected.length && g.every((v, i) => v === expected[i])) s.correct++;
    }
  }
  return questions
    .map((q) => {
      const s = stats.get(q.id)!;
      return { questionId: q.id, prompt: q.prompt.slice(0, 120), attempts: s.total, errorRate: s.total ? +(1 - s.correct / s.total).toFixed(2) : 0 };
    })
    .filter((x) => x.attempts > 0)
    .sort((a, b) => b.errorRate - a.errorRate)
    .slice(0, 10);
}
