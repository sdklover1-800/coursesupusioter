import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Role, type RubricAggregate } from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { Errors } from '../../lib/errors.js';
import { env } from '../../config/env.js';

const guard = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.COURSE_MANAGER, Role.ADMIN)] });
const adminOnly = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.ADMIN)] });

/** Дашборды и аналитика (FR-10, §11.4). Подробные метрики — явное требование. */
export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  // GET /dashboards/courses/:id — метрики по курсу (FR-10.2, 10.3, 10.4).
  app.get('/dashboards/courses/:id', guard(app), async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const course = await prisma.course.findUnique({ where: { id }, include: { languageVersions: { include: { modules: { include: { quiz: { include: { questions: true } }, practicalTask: true } } } } } });
    if (!course) throw Errors.notFound('Курс не найден');
    // FR-10.6 (аудит M1): менеджер видит только СВОИ курсы; администратор — все.
    if (req.user!.role === Role.COURSE_MANAGER && course.createdById !== req.user!.id) {
      throw Errors.forbidden('Дашборд доступен только автору курса');
    }

    const enrollments = await prisma.enrollment.findMany({ where: { courseId: id } });
    const total = enrollments.length;
    const completed = enrollments.filter((e) => e.status === 'COMPLETED').length;
    const avgProgress = total ? enrollments.reduce((s, e) => s + e.progressPercent, 0) / total : 0;

    // Тесты: средние баллы, «сложные» вопросы (высокий % ошибок).
    const quizIds = course.languageVersions.flatMap((v) => v.modules.map((m) => m.quiz?.id).filter(Boolean) as string[]);
    const attempts = await prisma.quizAttempt.findMany({ where: { quizId: { in: quizIds } } });
    const avgQuizScore = attempts.length ? attempts.reduce((s, a) => s + a.score, 0) / attempts.length : 0;
    const hardQuestions = await computeHardQuestions(quizIds);

    // Практические: PASSED/FAILED, средний расход токенов, среднее число сообщений, рубрика.
    const practicalTaskIds = course.languageVersions.flatMap((v) => v.modules.map((m) => m.practicalTask?.id).filter(Boolean) as string[]);
    const sessions = await prisma.practicalSession.findMany({ where: { practicalTaskId: { in: practicalTaskIds } } });
    const practicalStats = summarizePractical(sessions);

    return {
      course: { id: course.id, status: course.status },
      enrollment: { total, completed, completionRate: total ? completed / total : 0, avgProgress: +avgProgress.toFixed(1) },
      quizzes: { attempts: attempts.length, avgScore: +avgQuizScore.toFixed(3), hardQuestions },
      practical: practicalStats,
    };
  });

  // GET /dashboards/courses/:id/students — метрики по отдельным студентам (FR-10.2):
  // прогресс, результаты тестов/практики, время прохождения.
  app.get('/dashboards/courses/:id/students', guard(app), async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const course = await prisma.course.findUnique({ where: { id } });
    if (!course) throw Errors.notFound('Курс не найден');
    if (req.user!.role === Role.COURSE_MANAGER && course.createdById !== req.user!.id) throw Errors.forbidden('Только автор курса');

    const enrollments = await prisma.enrollment.findMany({
      where: { courseId: id },
      include: {
        user: { select: { id: true, name: true, cohortId: true } },
        quizAttempts: { select: { score: true, passed: true } },
        practicalSessions: { select: { status: true, aiMessageCount: true } },
        languageVersion: { select: { language: true } },
      },
    });

    const students = enrollments.map((e) => {
      const bestByQuiz = e.quizAttempts.length ? +(e.quizAttempts.reduce((s, a) => s + a.score, 0) / e.quizAttempts.length).toFixed(2) : null;
      const practicalPassed = e.practicalSessions.filter((s) => s.status === 'PASSED').length;
      // «Время прохождения» — от старта до завершения (FR-10.2)
      const durationMs = e.completedAt ? e.completedAt.getTime() - e.startedAt.getTime() : null;
      return {
        studentId: e.user.id,
        name: e.user.name,
        cohortId: e.user.cohortId,
        language: e.languageVersion.language,
        progressPercent: e.progressPercent,
        status: e.status,
        avgQuizScore: bestByQuiz,
        quizAttempts: e.quizAttempts.length,
        practicalPassed,
        practicalMessages: e.practicalSessions.reduce((s, x) => s + x.aiMessageCount, 0),
        startedAt: e.startedAt,
        completedAt: e.completedAt,
        durationDays: durationMs != null ? +(durationMs / 86_400_000).toFixed(1) : null,
      };
    });
    return { students };
  });

  // GET /dashboards/overview — сводные метрики (ADMIN, FR-10.6).
  app.get('/dashboards/overview', adminOnly(app), async () => {
    const [users, students, courses, publishedVersions, enrollments, completedEnrollments, sessions, certificates] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: 'STUDENT' } }),
      prisma.course.count(),
      prisma.courseLanguageVersion.count({ where: { status: 'PUBLISHED' } }),
      prisma.enrollment.count(),
      prisma.enrollment.count({ where: { status: 'COMPLETED' } }),
      prisma.practicalSession.findMany(),
      prisma.certificate.count(),
    ]);
    return {
      users, students, courses, publishedVersions, enrollments, completedEnrollments, certificates,
      practical: summarizePractical(sessions),
    };
  });

  // GET /dashboards/cohorts — сравнение когорт (ADMIN, FR-10.5, FR-R.5).
  // Без N+1 (аудит M4): enrollments и сессии — по одному запросу, группировка в памяти.
  app.get('/dashboards/cohorts', adminOnly(app), async () => {
    const cohorts = await prisma.cohort.findMany({ include: { users: { select: { id: true } }, _count: { select: { teacherSessions: true } } } });
    const userToCohort = new Map<string, string>();
    for (const c of cohorts) for (const u of c.users) userToCohort.set(u.id, c.id);
    const userIds = [...userToCohort.keys()];

    const [enrollments, sessions] = await Promise.all([
      prisma.enrollment.findMany({ where: { userId: { in: userIds } }, select: { userId: true, status: true } }),
      prisma.practicalSession.findMany({ where: { enrollment: { userId: { in: userIds } } }, include: { enrollment: { select: { userId: true } } } }),
    ]);

    const enrByCohort = new Map<string, typeof enrollments>();
    for (const e of enrollments) {
      const cid = userToCohort.get(e.userId);
      if (cid) (enrByCohort.get(cid) ?? enrByCohort.set(cid, []).get(cid)!).push(e);
    }
    const sessByCohort = new Map<string, typeof sessions>();
    for (const s of sessions) {
      const cid = userToCohort.get(s.enrollment.userId);
      if (cid) (sessByCohort.get(cid) ?? sessByCohort.set(cid, []).get(cid)!).push(s);
    }

    const rows = cohorts.map((c) => {
      const enr = enrByCohort.get(c.id) ?? [];
      const practical = summarizePractical(sessByCohort.get(c.id) ?? []);
      return {
        cohortId: c.id, name: c.name, condition: c.condition, students: c.users.length,
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
 * «Сложные» вопросы: доля ошибок по каждому вопросу теста (FR-10.3).
 * L6: учитываем только ФАКТИЧЕСКИ отвеченные вопросы — пропущенный вопрос не
 * считается ошибкой (иначе errorRate завышается пустыми ответами).
 */
async function computeHardQuestions(quizIds: string[]): Promise<{ questionId: string; prompt: string; errorRate: number; attempts: number }[]> {
  if (quizIds.length === 0) return [];
  const questions = await prisma.quizQuestion.findMany({ where: { quizId: { in: quizIds } } });
  const byQuiz = new Map<string, typeof questions>();
  for (const q of questions) (byQuiz.get(q.quizId) ?? byQuiz.set(q.quizId, []).get(q.quizId)!).push(q);
  const attempts = await prisma.quizAttempt.findMany({ where: { quizId: { in: quizIds } } });
  const stats = new Map<string, { correct: number; total: number }>();
  for (const q of questions) stats.set(q.id, { correct: 0, total: 0 });
  for (const a of attempts) {
    const answers = a.answers as Record<string, number[]>;
    for (const q of byQuiz.get(a.quizId) ?? []) {
      const given = answers[q.id];
      if (!given || given.length === 0) continue; // вопрос не отвечали — не считаем
      const s = stats.get(q.id)!;
      s.total++;
      const g = [...given].sort();
      const expected = (q.correctOptionIds as number[]).slice().sort();
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

/** Сводка по практическим сессиям + агрегат рубрики критического мышления (FR-10.3, 10.4). */
function summarizePractical(sessions: { status: string; tokensUsed: number; aiMessageCount: number; evaluationResult: unknown }[]) {
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

  return {
    total: sessions.length, passed, failed, abandoned,
    passRate: passed + failed ? +(passed / (passed + failed)).toFixed(2) : 0,
    avgTokens, avgMessages, totalTokens, estCostUsd, rubric,
  };
}
