import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Role, EventType } from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { Errors } from '../../lib/errors.js';
import { requireConsent } from '../../plugins/consentGate.js';
import { logEvent, audit } from '../../telemetry/events.js';
import { recomputeProgress } from './progress.service.js';
import { loadOwnedEnrollment, assertLectureInEnrollment, assertEnrollmentAdmitted } from './access.js';
import { decideManagerEnroll, languageSwitchDecision } from '../enrollments/policy.js';
import { studentEnrollmentSelect } from '../enrollments/views.js';

const managerGuard = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.COURSE_MANAGER, Role.ADMIN)] });
const studentContent = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.STUDENT), requireConsent] });

export async function learnRoutes(app: FastifyInstance): Promise<void> {
  /* ── Менеджер/админ: запись студентов на курс (FR-8.1, §3.2) ── */

  // POST /enrollments — записать студента на курс с выбором языковой версии.
  // Если студент уже подал заявку (PENDING/REJECTED) — прямая запись её одобряет.
  app.post('/enrollments', managerGuard(app), async (req) => {
    const data = parse(z.object({ userId: z.string(), courseId: z.string(), languageVersionId: z.string() }), req.body);
    const version = await prisma.courseLanguageVersion.findUnique({ where: { id: data.languageVersionId } });
    if (!version || version.courseId !== data.courseId) throw Errors.badRequest('Языковая версия не соответствует курсу');
    if (version.status !== 'PUBLISHED') throw Errors.badRequest('Языковая версия не опубликована');
    const student = await prisma.user.findUnique({ where: { id: data.userId }, select: { isActive: true } });
    if (!student) throw Errors.notFound('Пользователь не найден');
    if (!student.isActive) throw Errors.conflict('Учётная запись студента деактивирована');
    const existing = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId: data.userId, courseId: data.courseId } } });
    const decision = decideManagerEnroll(existing?.status ?? null);
    if (decision === 'conflict') throw Errors.conflict('Студент уже записан на этот курс');

    let enrollment;
    if (decision === 'convert' && existing) {
      const now = new Date();
      // Условное обновление: заявку могли одновременно одобрить/отменить (TOCTOU)
      const { count } = await prisma.enrollment.updateMany({
        where: { id: existing.id, status: existing.status },
        data: { status: 'ACTIVE', languageVersionId: data.languageVersionId, startedAt: now, reviewedAt: now, reviewedById: req.user!.id },
      });
      if (count === 0) throw Errors.conflict('Заявка уже изменилась, обновите страницу');
      enrollment = await prisma.enrollment.findUniqueOrThrow({ where: { id: existing.id } });
    } else {
      enrollment = await prisma.enrollment.create({ data: { userId: data.userId, courseId: data.courseId, languageVersionId: data.languageVersionId } });
    }
    await audit({
      actorId: req.user!.id, action: 'STUDENT_ENROLLED', targetType: 'Enrollment', targetId: enrollment.id,
      detail: { userId: data.userId, courseId: data.courseId, ...(decision === 'convert' ? { fromRequest: existing?.status } : {}) },
    });
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

  // GET /me/courses — записи на курсы с прогрессом, ВКЛЮЧАЯ заявки всех статусов
  // (PENDING/REJECTED/WITHDRAWN) — клиент показывает их отдельными карточками.
  app.get('/me/courses', { preHandler: [app.authenticate, app.requireRole(Role.STUDENT)] }, async (req) => {
    const enrollments = await prisma.enrollment.findMany({
      where: { userId: req.user!.id },
      select: studentEnrollmentSelect,
      orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
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
    // Язык можно сменить у ожидающей заявки и у активного курса; у завершённого — нет
    // (пересчёт под другую версию «раззавершил» бы курс), у отклонённой — только новой заявкой.
    const decision = languageSwitchDecision(enrollment.status);
    if (decision === 'not-approved') assertEnrollmentAdmitted(enrollment);
    if (decision === 'completed') throw Errors.conflict('Курс уже завершён — смена языка недоступна');
    const target = await prisma.courseLanguageVersion.findUnique({ where: { id: languageVersionId } });
    if (!target || target.courseId !== enrollment.courseId) throw Errors.badRequest('Версия не относится к этому курсу');
    if (target.status !== 'PUBLISHED') throw Errors.badRequest('Версия не опубликована');
    // Условие по статусу: заявку могли одобрить/отклонить между чтением и записью.
    const { count } = await prisma.enrollment.updateMany({ where: { id, status: enrollment.status }, data: { languageVersionId } });
    if (count === 0) throw Errors.conflict('Статус записи изменился, обновите страницу');
    // Прогресс пересчитывается под новую версию (у неё свои лекции/оценивания);
    // для заявки PENDING пересчёт статус не меняет (см. recomputeProgress).
    const progress = await recomputeProgress(id);
    const updated = await prisma.enrollment.findUniqueOrThrow({ where: { id }, select: studentEnrollmentSelect });
    return { enrollment: updated, progress };
  });

  // GET /courses/:id/learn?enrollmentId — структура курса для прохождения + прогресс.
  app.get('/courses/:id/learn', studentContent(app), async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { enrollmentId } = parse(z.object({ enrollmentId: z.string() }), req.query);
    // Владение + одобрение заявки + опубликованность версии — единым гейтом.
    const owned = await loadOwnedEnrollment(req.user!.id, enrollmentId);
    if (owned.courseId !== id) throw Errors.forbidden('Нет доступа к этой записи');
    const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId }, include: { lectureProgress: true, quizAttempts: true, practicalSessions: true } });
    if (!enrollment) throw Errors.forbidden('Нет доступа к этой записи');

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
