import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Role, EventType } from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { Errors } from '../../lib/errors.js';
import { requireConsent } from '../../plugins/consentGate.js';
import { logEvent, audit } from '../../telemetry/events.js';
import { recomputeProgress } from './progress.service.js';
import { loadOwnedEnrollment, assertLectureInEnrollment } from './access.js';

const managerGuard = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.COURSE_MANAGER, Role.ADMIN)] });
const studentContent = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.STUDENT), requireConsent] });

export async function learnRoutes(app: FastifyInstance): Promise<void> {
  /* ── Менеджер/админ: запись студентов на курс (FR-8.1, §3.2) ── */

  // POST /enrollments — записать студента на курс с выбором языковой версии.
  app.post('/enrollments', managerGuard(app), async (req) => {
    const data = parse(z.object({ userId: z.string(), courseId: z.string(), languageVersionId: z.string() }), req.body);
    const version = await prisma.courseLanguageVersion.findUnique({ where: { id: data.languageVersionId } });
    if (!version || version.courseId !== data.courseId) throw Errors.badRequest('Языковая версия не соответствует курсу');
    if (version.status !== 'PUBLISHED') throw Errors.badRequest('Языковая версия не опубликована');
    const existing = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId: data.userId, courseId: data.courseId } } });
    if (existing) throw Errors.conflict('Студент уже записан на этот курс');
    const enrollment = await prisma.enrollment.create({ data: { userId: data.userId, courseId: data.courseId, languageVersionId: data.languageVersionId } });
    await audit({ actorId: req.user!.id, action: 'STUDENT_ENROLLED', targetType: 'Enrollment', targetId: enrollment.id, detail: { userId: data.userId, courseId: data.courseId } });
    return { enrollment };
  });

  // GET /enrollments?courseId — записи по курсу (менеджер).
  app.get('/enrollments', managerGuard(app), async (req) => {
    const { courseId } = parse(z.object({ courseId: z.string() }), req.query);
    const items = await prisma.enrollment.findMany({
      where: { courseId },
      include: { user: { select: { id: true, name: true, email: true, cohortId: true } }, languageVersion: { select: { language: true, title: true } } },
      orderBy: { startedAt: 'desc' },
    });
    return { items };
  });

  /* ── Студент: прохождение (FR-8.2, FR-8.4) ── */

  // GET /me/courses — записанные курсы с прогрессом.
  app.get('/me/courses', { preHandler: [app.authenticate, app.requireRole(Role.STUDENT)] }, async (req) => {
    const enrollments = await prisma.enrollment.findMany({
      where: { userId: req.user!.id },
      include: { languageVersion: { select: { id: true, title: true, description: true, language: true } }, certificate: { select: { id: true, serialNumber: true } } },
      orderBy: { startedAt: 'desc' },
    });
    return { items: enrollments };
  });

  // GET /courses/:id/languages — доступные (опубликованные) языки прохождения курса (FR-3.4).
  app.get('/courses/:id/languages', { preHandler: [app.authenticate, app.requireRole(Role.STUDENT)] }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const versions = await prisma.courseLanguageVersion.findMany({
      where: { courseId: id, status: 'PUBLISHED' },
      select: { id: true, language: true, title: true },
    });
    return { items: versions };
  });

  // POST /enrollments/:id/language — студент выбирает язык прохождения (FR-3.4).
  // Переключает запись на другую ОПУБЛИКОВАННУЮ языковую версию того же курса.
  app.post('/enrollments/:id/language', { preHandler: [app.authenticate, app.requireRole(Role.STUDENT)] }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { languageVersionId } = parse(z.object({ languageVersionId: z.string() }), req.body);
    const enrollment = await prisma.enrollment.findUnique({ where: { id } });
    if (!enrollment || enrollment.userId !== req.user!.id) throw Errors.forbidden('Нет доступа к записи');
    const target = await prisma.courseLanguageVersion.findUnique({ where: { id: languageVersionId } });
    if (!target || target.courseId !== enrollment.courseId) throw Errors.badRequest('Версия не относится к этому курсу');
    if (target.status !== 'PUBLISHED') throw Errors.badRequest('Версия не опубликована');
    const updated = await prisma.enrollment.update({ where: { id }, data: { languageVersionId } });
    // Прогресс пересчитывается под новую версию (у неё свои лекции/оценивания).
    const progress = await recomputeProgress(id);
    return { enrollment: updated, progress };
  });

  // GET /courses/:id/learn?enrollmentId — структура курса для прохождения + прогресс.
  app.get('/courses/:id/learn', studentContent(app), async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { enrollmentId } = parse(z.object({ enrollmentId: z.string() }), req.query);
    const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId }, include: { lectureProgress: true, quizAttempts: true, practicalSessions: true } });
    if (!enrollment || enrollment.userId !== req.user!.id || enrollment.courseId !== id) throw Errors.forbidden('Нет доступа к этой записи');

    const version = await prisma.courseLanguageVersion.findUnique({
      where: { id: enrollment.languageVersionId },
      include: {
        modules: {
          orderBy: { orderIndex: 'asc' },
          include: {
            lectures: { orderBy: { orderIndex: 'asc' }, select: { id: true, title: true, youtubeVideoId: true, orderIndex: true } },
            quiz: { select: { id: true, title: true, passThreshold: true, maxAttempts: true } },
            practicalTask: { select: { id: true, title: true, difficulty: true, maxAiMessages: true } }, // без эталона/рубрики
          },
        },
      },
    });
    if (!version || version.status !== 'PUBLISHED') throw Errors.notFound('Курс недоступен');

    const doneLectures = new Set(enrollment.lectureProgress.filter((p) => p.isCompleted).map((p) => p.lectureId));
    const quizPassed = new Set(enrollment.quizAttempts.filter((a) => a.passed).map((a) => a.quizId));
    const bestQuiz = new Map<string, number>();
    for (const a of enrollment.quizAttempts) bestQuiz.set(a.quizId, Math.max(bestQuiz.get(a.quizId) ?? 0, a.score));
    const practicalStatus = new Map(enrollment.practicalSessions.map((s) => [s.practicalTaskId, s.status]));

    return {
      enrollment: { id: enrollment.id, progressPercent: enrollment.progressPercent, status: enrollment.status },
      version: {
        id: version.id, title: version.title, language: version.language,
        modules: version.modules.map((m) => ({
          id: m.id, title: m.title, orderIndex: m.orderIndex, assessmentType: m.assessmentType,
          lectures: m.lectures.map((l) => ({ ...l, completed: doneLectures.has(l.id) })),
          quiz: m.quiz ? { ...m.quiz, passed: quizPassed.has(m.quiz.id), bestScore: bestQuiz.get(m.quiz.id) ?? null } : null,
          practicalTask: m.practicalTask ? { ...m.practicalTask, status: practicalStatus.get(m.practicalTask.id) ?? null } : null,
        })),
      },
    };
  });

  // GET /lectures/:id — лекция (видео + расшифровка) для просмотра.
  app.get('/lectures/:id', studentContent(app), async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { enrollmentId } = parse(z.object({ enrollmentId: z.string() }), req.query);
    const enr = await loadOwnedEnrollment(req.user!.id, enrollmentId);
    await assertLectureInEnrollment(id, enr); // H2: лекция должна входить в курс студента
    const lecture = await prisma.lecture.findUnique({ where: { id }, select: { id: true, title: true, youtubeVideoId: true, transcriptText: true } });
    if (!lecture) throw Errors.notFound('Лекция не найдена');
    await logEvent({ eventType: EventType.LECTURE_VIEWED, userId: req.user!.id, enrollmentId, payload: { lectureId: id } });
    return { lecture };
  });

  // POST /lectures/:id/complete — отметить лекцию просмотренной (FR-8.2).
  app.post('/lectures/:id/complete', studentContent(app), async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { enrollmentId } = parse(z.object({ enrollmentId: z.string() }), req.body);
    const enr = await loadOwnedEnrollment(req.user!.id, enrollmentId);
    await assertLectureInEnrollment(id, enr); // H2
    await prisma.lectureProgress.upsert({
      where: { enrollmentId_lectureId: { enrollmentId, lectureId: id } },
      create: { enrollmentId, lectureId: id, isCompleted: true, completedAt: new Date() },
      update: { isCompleted: true, completedAt: new Date() },
    });
    await logEvent({ eventType: EventType.LECTURE_COMPLETED, userId: req.user!.id, enrollmentId, payload: { lectureId: id } });
    const progress = await recomputeProgress(enrollmentId);
    return { ok: true, progress };
  });
}
