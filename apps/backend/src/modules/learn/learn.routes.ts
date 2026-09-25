import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  Role,
  EventType,
  ApiErrorCode,
  ADMITTED_ENROLLMENT_STATUSES,
  type LanguageSwitchPreview,
  type LearnView,
  type LectureView,
  type PublishStatus,
  type StudentEnrollment,
} from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { parse } from '../../lib/validate.js';
import { Errors } from '../../lib/errors.js';
import { requireConsent } from '../../plugins/consentGate.js';
import { logEvent, audit } from '../../telemetry/events.js';
import { learnViewOptions, loadLearnInput, loadLearnInputs, recomputeProgress, recomputeProgressWithView } from './progress.service.js';
import { loadOwnedEnrollment, assertLectureInEnrollment, assertEnrollmentAdmitted } from './access.js';
import { buildCourseSummary, buildLearnView, lectureNeighbors, locateLecture } from './learn.view.js';
import { languageLockState, lockEnrollmentLanguage, matchParallelLectures, type ParallelModule } from './language.js';
import { decideManagerEnroll, isAdmitted, languageSwitchDecision } from '../enrollments/policy.js';
import { studentEnrollmentSelect } from '../enrollments/views.js';

const managerGuard = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.COURSE_MANAGER, Role.ADMIN)] });
const studentContent = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.STUDENT), requireConsent] });
const studentOnly = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.STUDENT)] });

/** Повторный LECTURE_VIEWED по той же лекции не пишется чаще раза в 30 мин. */
const LECTURE_VIEW_DEDUPE_MS = 30 * 60_000;

/**
 * Автосохранение позиции видео (A14): плеер сохраняет раз в 15 с и на паузе/уходе,
 * поэтому лимит — 6 запросов за 10 с на пару «пользователь + лекция». Хук preHandler —
 * чтобы ключ строился уже после аутентификации (req.user).
 */
const progressRateLimit = {
  rateLimit: {
    max: 6,
    timeWindow: '10 seconds',
    hook: 'preHandler' as const,
    keyGenerator: (req: FastifyRequest) => `${req.user?.id ?? req.ip}:${(req.params as { id?: string }).id ?? ''}`,
  },
};

/** Модули версии с лекциями — для переноса пройденных лекций при смене языка. */
const parallelModules = (versionId: string, db: Pick<Prisma.TransactionClient, 'module'> = prisma): Promise<ParallelModule[]> =>
  db.module.findMany({
    where: { courseLanguageVersionId: versionId },
    select: { orderIndex: true, lectures: { select: { id: true, orderIndex: true } } },
  });

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
  // summary (MyCourseSummary) — только для допущенных записей на опубликованной версии;
  // строится пакетно (фиксированное число запросов, без N+1 по записям и лекциям).
  app.get('/me/courses', studentOnly(app), async (req): Promise<{ items: StudentEnrollment[] }> => {
    const rows = await prisma.enrollment.findMany({
      where: { userId: req.user!.id },
      select: studentEnrollmentSelect,
      orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
    });
    const eligible = rows.filter((r) => isAdmitted(r.status) && r.languageVersion.status === 'PUBLISHED').map((r) => r.id);
    const inputs = await loadLearnInputs(eligible);
    const now = new Date();
    const opts = learnViewOptions();
    const items = rows.map((r) => {
      const input = inputs.get(r.id);
      const summary = input ? buildCourseSummary(buildLearnView(input, now, opts), r.languageVersion.status as PublishStatus) : null;
      return {
        ...r,
        // Процент — тот же, что на карте курса (считается при чтении)
        progressPercent: summary ? summary.progress.percent : r.progressPercent,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
        requestedAt: r.requestedAt?.toISOString() ?? null,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        languageVersion: { ...r.languageVersion, status: r.languageVersion.status as PublishStatus },
        summary,
      };
    });
    return { items };
  });

  // GET /courses/:id/languages — опубликованные языки прохождения курса (FR-3.4).
  // Только студенту, допущенному к этому курсу (A27).
  app.get('/courses/:id/languages', studentOnly(app), async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const admitted = await prisma.enrollment.findFirst({
      where: { userId: req.user!.id, courseId: id, status: { in: [...ADMITTED_ENROLLMENT_STATUSES] } },
      select: { id: true },
    });
    if (!admitted) throw Errors.forbidden('Нет доступа к курсу');
    const versions = await prisma.courseLanguageVersion.findMany({
      where: { courseId: id, status: 'PUBLISHED' },
      select: { id: true, language: true, title: true },
    });
    return { items: versions };
  });

  // GET /enrollments/:id/language-switch-preview?languageVersionId — можно ли сменить
  // язык и сколько пройденных лекций перенесётся (USER_DECISIONS §3).
  app.get('/enrollments/:id/language-switch-preview', studentOnly(app), async (req): Promise<LanguageSwitchPreview> => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { languageVersionId } = parse(z.object({ languageVersionId: z.string().min(1) }), req.query);
    const enrollment = await prisma.enrollment.findUnique({ where: { id } });
    if (!enrollment || enrollment.userId !== req.user!.id) throw Errors.forbidden('Нет доступа к записи');
    const decision = languageSwitchDecision(enrollment.status);
    if (decision === 'not-approved') assertEnrollmentAdmitted(enrollment);

    const target = await prisma.courseLanguageVersion.findUnique({ where: { id: languageVersionId }, select: { id: true, courseId: true, status: true, title: true } });
    const sameCourse = !!target && target.courseId === enrollment.courseId;
    const base = { lockReason: null, carriedLectures: 0, targetTitle: sameCourse ? target!.title : '' };
    if (decision === 'completed') return { ...base, allowed: false, reason: 'COMPLETED' };
    if (!sameCourse || target!.status !== 'PUBLISHED') return { ...base, allowed: false, reason: 'NOT_AVAILABLE' };
    if (target!.id === enrollment.languageVersionId) return { ...base, allowed: false, reason: 'SAME_LANGUAGE' };

    const lock = await languageLockState(prisma, id, env.LANGUAGE_LOCK);
    if (lock.locked) return { ...base, allowed: false, reason: 'LOCKED_AFTER_GRADED', lockReason: lock.reason };

    const [from, to] = await Promise.all([parallelModules(enrollment.languageVersionId), parallelModules(target!.id)]);
    const pairs = matchParallelLectures(from, to);
    const carriedLectures = pairs.size
      ? await prisma.lectureProgress.count({ where: { enrollmentId: id, isCompleted: true, lectureId: { in: [...pairs.keys()] } } })
      : 0;
    return { ...base, allowed: true, reason: null, carriedLectures };
  });

  // POST /enrollments/:id/language — студент выбирает язык прохождения (FR-3.4).
  // Язык закрепляется после первой оцениваемой активности (USER_DECISIONS §3) → 409 LANGUAGE_LOCKED.
  // Пройденные лекции переносятся на параллельные лекции новой версии; старые строки не удаляются.
  app.post('/enrollments/:id/language', studentOnly(app), async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { languageVersionId } = parse(z.object({ languageVersionId: z.string() }), req.body);
    const enrollment = await prisma.enrollment.findUnique({ where: { id }, include: { languageVersion: { select: { language: true } } } });
    if (!enrollment || enrollment.userId !== req.user!.id) throw Errors.forbidden('Нет доступа к записи');
    // Язык можно сменить у ожидающей заявки и у активного курса; у завершённого — нет
    // (пересчёт под другую версию «раззавершил» бы курс), у отклонённой — только новой заявкой.
    const decision = languageSwitchDecision(enrollment.status);
    if (decision === 'not-approved') assertEnrollmentAdmitted(enrollment);
    if (decision === 'completed') throw Errors.conflict('Курс уже завершён — смена языка недоступна');
    // Активный курс — учебный маршрут: гейт согласия и смены пароля (заявке он не нужен).
    if (enrollment.status === 'ACTIVE') await requireConsent(req);
    const target = await prisma.courseLanguageVersion.findUnique({ where: { id: languageVersionId } });
    if (!target || target.courseId !== enrollment.courseId) throw Errors.badRequest('Версия не относится к этому курсу');
    if (target.status !== 'PUBLISHED') throw Errors.badRequest('Версия не опубликована');
    if (target.id === enrollment.languageVersionId) {
      const current = await prisma.enrollment.findUniqueOrThrow({ where: { id }, select: studentEnrollmentSelect });
      return { enrollment: current, progress: { percent: current.progressPercent, completed: current.status === 'COMPLETED' }, carriedLectures: 0 };
    }

    const now = new Date();
    const carriedLectures = await prisma.$transaction(async (tx) => {
      // Строка записи блокируется ДО проверки: старт оцениваемой попытки берёт ту же
      // блокировку, поэтому проверка видит уже созданную попытку (гонки нет).
      await lockEnrollmentLanguage(tx, id);
      const lock = await languageLockState(tx, id, env.LANGUAGE_LOCK);
      if (lock.locked) {
        throw Errors.coded(409, ApiErrorCode.LANGUAGE_LOCKED, 'Язык курса закреплён после первого оценивания', { reason: lock.reason });
      }
      // Условие по статусу и версии: заявку могли одобрить/отклонить между чтением и записью.
      const { count } = await tx.enrollment.updateMany({
        where: { id, status: enrollment.status, languageVersionId: enrollment.languageVersionId },
        data: { languageVersionId, lastLectureId: null },
      });
      if (count === 0) throw Errors.conflict('Статус записи изменился, обновите страницу');

      const [from, to] = await Promise.all([parallelModules(enrollment.languageVersionId, tx), parallelModules(languageVersionId, tx)]);
      const pairs = matchParallelLectures(from, to);
      if (!pairs.size) return 0;
      const done = await tx.lectureProgress.findMany({
        where: { enrollmentId: id, isCompleted: true, lectureId: { in: [...pairs.keys()] } },
        select: { lectureId: true, completedAt: true },
      });
      if (!done.length) return 0;
      const targetIds = done.map((p) => pairs.get(p.lectureId)!);
      const existing = new Map(
        (await tx.lectureProgress.findMany({ where: { enrollmentId: id, lectureId: { in: targetIds } }, select: { lectureId: true, isCompleted: true } })).map((p) => [p.lectureId, p]),
      );
      for (const p of done) {
        const lectureId = pairs.get(p.lectureId)!;
        const completedAt = p.completedAt ?? now;
        const row = existing.get(lectureId);
        if (!row) await tx.lectureProgress.create({ data: { enrollmentId: id, lectureId, isCompleted: true, completedAt } });
        else if (!row.isCompleted) {
          await tx.lectureProgress.updateMany({ where: { enrollmentId: id, lectureId, isCompleted: false }, data: { isCompleted: true, completedAt } });
        }
      }
      return done.length;
    });

    // Прогресс пересчитывается под новую версию; для заявки PENDING статус не меняется.
    const progress = await recomputeProgress(id);
    await logEvent({
      eventType: EventType.LANGUAGE_SWITCHED, userId: req.user!.id, enrollmentId: id,
      payload: { from: enrollment.languageVersion.language, to: target.language, fromVersionId: enrollment.languageVersionId, toVersionId: target.id, carriedLectures },
    });
    const updated = await prisma.enrollment.findUniqueOrThrow({ where: { id }, select: studentEnrollmentSelect });
    return { enrollment: updated, progress, carriedLectures };
  });

  // GET /courses/:id/learn?enrollmentId — карта курса (LearnView): модули, прогресс,
  // рекомендуемый шаг, сертификат, блокировка языка. Порядок свободный (USER_DECISIONS §3).
  app.get('/courses/:id/learn', studentContent(app), async (req): Promise<LearnView> => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { enrollmentId } = parse(z.object({ enrollmentId: z.string() }), req.query);
    // Владение + одобрение заявки + опубликованность версии — единым гейтом.
    const owned = await loadOwnedEnrollment(req.user!.id, enrollmentId);
    if (owned.courseId !== id) throw Errors.forbidden('Нет доступа к этой записи');
    const input = await loadLearnInput(enrollmentId);
    if (!input) throw Errors.forbidden('Нет доступа к этой записи');
    const view = buildLearnView(input, new Date(), learnViewOptions());
    // Процент считается при чтении; расхождение с сохранённым — сохраняем (статус не трогаем).
    if (view.progress.percent !== input.enrollment.progressPercent) {
      await prisma.enrollment.updateMany({ where: { id: enrollmentId, status: owned.status }, data: { progressPercent: view.progress.percent } });
    }
    return view;
  });

  // GET /lectures/:id?enrollmentId&context=PRACTICAL — лекция (LectureView): видео,
  // расшифровка, позиция возобновления, соседи на учебном пути.
  // context=PRACTICAL — расшифровка открыта из практикума (USER_DECISIONS §4): точку
  // возобновления курса не трогаем, только пишем событие просмотра с контекстом.
  app.get('/lectures/:id', studentContent(app), async (req): Promise<{ lecture: LectureView }> => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { enrollmentId, context } = parse(
      z.object({ enrollmentId: z.string(), context: z.enum(['LECTURE', 'PRACTICAL']).optional() }),
      req.query,
    );
    const enr = await loadOwnedEnrollment(req.user!.id, enrollmentId);
    await assertLectureInEnrollment(id, enr); // H2: лекция должна входить в курс студента
    const [lecture, input] = await Promise.all([
      prisma.lecture.findUnique({ where: { id }, select: { id: true, title: true, youtubeVideoId: true, transcriptText: true, durationSec: true, summary: true } }),
      loadLearnInput(enrollmentId, { activity: false }),
    ]);
    if (!lecture || !input) throw Errors.notFound('Лекция не найдена');
    const view = buildLearnView(input, new Date(), learnViewOptions());
    const place = locateLecture(view, id);
    if (!place) throw Errors.notFound('Лекция не найдена');
    const { prev, next } = lectureNeighbors(view, id);
    const progress = input.lectureProgress.find((p) => p.lectureId === id);

    const now = new Date();
    const viewContext = context ?? 'LECTURE';
    if (viewContext === 'LECTURE') {
      await prisma.$transaction([
        prisma.enrollment.updateMany({ where: { id: enrollmentId }, data: { lastLectureId: id, lastActivityAt: now } }),
        prisma.lectureProgress.upsert({
          where: { enrollmentId_lectureId: { enrollmentId, lectureId: id } },
          create: { enrollmentId, lectureId: id, isCompleted: false, lastViewedAt: now },
          update: { lastViewedAt: now },
        }),
      ]);
    }
    // Не чаще раза в 30 мин на (запись, лекция, контекст) — иначе автообновления
    // страницы раздувают телеметрию просмотров.
    const recent = await prisma.eventLog.findFirst({
      where: {
        eventType: EventType.LECTURE_VIEWED,
        enrollmentId,
        createdAt: { gte: new Date(now.getTime() - LECTURE_VIEW_DEDUPE_MS) },
        AND: [{ payload: { path: ['lectureId'], equals: id } }, { payload: { path: ['context'], equals: viewContext } }],
      },
      select: { id: true },
    });
    if (!recent) {
      await logEvent({ eventType: EventType.LECTURE_VIEWED, userId: req.user!.id, enrollmentId, payload: { lectureId: id, context: viewContext } });
    }

    return {
      lecture: {
        id: lecture.id,
        title: lecture.title,
        youtubeVideoId: lecture.youtubeVideoId,
        transcriptText: lecture.transcriptText,
        durationSec: lecture.durationSec,
        summary: lecture.summary,
        completed: place.lecture.completed,
        positionSec: progress?.positionSec ?? 0,
        watchedSec: progress?.watchedSec ?? 0,
        miniQuizId: place.lecture.miniQuizId,
        lectureNumber: place.lecture.lectureNumber,
        lecturesTotal: place.lecturesTotal,
        module: {
          id: place.module.id,
          title: place.module.title,
          orderIndex: place.module.orderIndex,
          indexInModule: place.indexInModule,
          lecturesInModule: place.module.lectures.length,
        },
        prev,
        next,
      },
    };
  });

  // PATCH /lectures/:id/progress — автосохранение позиции видео (без EventLog).
  // positionSec — последняя запись побеждает; watchedSec — только растёт (max).
  app.patch('/lectures/:id/progress', { ...studentContent(app), config: progressRateLimit }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const data = parse(
      z.object({
        enrollmentId: z.string(),
        positionSec: z.number().int().min(0).max(36000),
        // Верхняя граница — защита от переполнения INT (100 ч больше любой лекции)
        watchedSec: z.number().int().min(0).max(360000),
      }),
      req.body,
    );
    const enr = await loadOwnedEnrollment(req.user!.id, data.enrollmentId);
    await assertLectureInEnrollment(id, enr);
    const now = new Date();
    const key = { enrollmentId_lectureId: { enrollmentId: data.enrollmentId, lectureId: id } };
    await prisma.lectureProgress.upsert({
      where: key,
      create: { enrollmentId: data.enrollmentId, lectureId: id, isCompleted: false, positionSec: data.positionSec, watchedSec: data.watchedSec, lastViewedAt: now },
      update: { positionSec: data.positionSec },
    });
    // Монотонность watchedSec — условным обновлением (гонка параллельных сохранений безопасна)
    await prisma.lectureProgress.updateMany({
      where: { enrollmentId: data.enrollmentId, lectureId: id, watchedSec: { lt: data.watchedSec } },
      data: { watchedSec: data.watchedSec },
    });
    await prisma.enrollment.updateMany({ where: { id: data.enrollmentId }, data: { lastActivityAt: now } });
    return { ok: true };
  });

  // POST /lectures/:id/complete — отметить лекцию просмотренной (FR-8.2).
  // Только переход false → true: completedAt не перезаписывается, LECTURE_COMPLETED —
  // один раз. Автозавершения и отмены нет.
  app.post('/lectures/:id/complete', studentContent(app), async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { enrollmentId } = parse(z.object({ enrollmentId: z.string() }), req.body);
    const enr = await loadOwnedEnrollment(req.user!.id, enrollmentId);
    await assertLectureInEnrollment(id, enr); // H2
    const now = new Date();
    const transitioned = await completeLecture(enrollmentId, id, now);
    await prisma.enrollment.updateMany({ where: { id: enrollmentId }, data: { lastActivityAt: now } });
    if (transitioned) {
      await logEvent({ eventType: EventType.LECTURE_COMPLETED, userId: req.user!.id, enrollmentId, payload: { lectureId: id } });
    }
    const { view } = await recomputeProgressWithView(enrollmentId);
    return { ok: true, progress: view?.progress ?? null, next: view?.next ?? null };
  });
}

/**
 * Переход лекции в «просмотрена» ровно один раз. true — именно этот вызов перевёл.
 * Строки может не быть (лекцию не открывали) — создаём; при гонке с параллельным
 * созданием (P2002) повторяем условное обновление.
 */
async function completeLecture(enrollmentId: string, lectureId: string, now: Date): Promise<boolean> {
  const mark = () =>
    prisma.lectureProgress.updateMany({ where: { enrollmentId, lectureId, isCompleted: false }, data: { isCompleted: true, completedAt: now } });
  if ((await mark()).count === 1) return true;
  const exists = await prisma.lectureProgress.findUnique({ where: { enrollmentId_lectureId: { enrollmentId, lectureId } }, select: { id: true } });
  if (exists) return false; // уже была завершена
  try {
    await prisma.lectureProgress.create({ data: { enrollmentId, lectureId, isCompleted: true, completedAt: now } });
    return true;
  } catch (err) {
    if ((err as { code?: string }).code !== 'P2002') throw err;
    return (await mark()).count === 1;
  }
}
