import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { Role, ADMITTED_ENROLLMENT_STATUSES, ENROLLMENT_BULK_APPROVE_MAX, ENROLLMENT_REVIEW_NOTE_MAX, type BulkApproveResult } from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { Errors } from '../../lib/errors.js';
import { audit } from '../../telemetry/events.js';
import {
  APPROVABLE_STATUSES,
  canApprove,
  canCancel,
  canReject,
  cancelAction,
  decideCohortOnApprove,
  decideSelfRequest,
  requestListOrder,
  requestListWhere,
} from './policy.js';
import { requestItemSelect, studentEnrollmentSelect } from './views.js';

const managerGuard = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.COURSE_MANAGER, Role.ADMIN)] });
// Заявку можно подать ДО информированного согласия: согласие (FR-R.6) требуется
// для доступа к контенту (requireConsent на учебных маршрутах), а не для заявки.
const studentGuard = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.STUDENT)] });

const idParams = z.object({ id: z.string().min(1) });

/**
 * Заявки на запись на курс: студент подаёт из публичного каталога (PENDING),
 * менеджер/админ одобряет (ACTIVE, опционально с назначением когорты — плеча
 * эксперимента) или отклоняет (REJECTED). До одобрения контент курса закрыт
 * (гейт loadOwnedEnrollment → 403 ENROLLMENT_NOT_APPROVED).
 * Переходы статусов — только условными updateMany (защита от гонок/TOCTOU).
 */
export async function enrollmentRoutes(app: FastifyInstance): Promise<void> {
  /* ── Студент ── */

  // POST /catalog/:courseId/requests — подать заявку на курс с выбором языка.
  // 201 — новая/повторная заявка; 200 — заявка уже на рассмотрении (язык обновляется).
  app.post('/catalog/:courseId/requests', studentGuard(app), async (req, reply) => {
    const { courseId } = parse(z.object({ courseId: z.string().min(1) }), req.params);
    const { languageVersionId } = parse(z.object({ languageVersionId: z.string().min(1) }), req.body);
    const userId = req.user!.id;
    await assertAccountActive(userId);

    const version = await prisma.courseLanguageVersion.findUnique({ where: { id: languageVersionId }, select: { courseId: true, status: true } });
    if (!version || version.courseId !== courseId) throw Errors.badRequest('Языковая версия не относится к этому курсу');
    if (version.status !== 'PUBLISHED') throw Errors.badRequest('Языковая версия не опубликована');

    const existing = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { id: true, status: true, languageVersionId: true },
    });
    const decision = decideSelfRequest(existing?.status ?? null);
    const now = new Date();

    if (decision.action === 'conflict') throw Errors.conflict(decision.message);

    if (decision.action === 'create') {
      try {
        const created = await prisma.enrollment.create({
          data: { userId, courseId, languageVersionId, status: 'PENDING', requestedAt: now },
          select: studentEnrollmentSelect,
        });
        await audit({ actorId: userId, action: 'ENROLLMENT_REQUESTED', targetType: 'Enrollment', targetId: created.id, detail: { courseId, languageVersionId } });
        return reply.code(201).send({ enrollment: created });
      } catch (err) {
        // Двойной клик: параллельная заявка уже создана — отдаём её (идемпотентно).
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
        const raced = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } }, select: studentEnrollmentSelect });
        if (raced?.status !== 'PENDING') throw Errors.conflict('Заявка уже изменилась, обновите страницу');
        return { enrollment: raced };
      }
    }

    const current = existing!;
    if (decision.action === 'keep-pending') {
      if (current.languageVersionId !== languageVersionId) {
        await prisma.enrollment.updateMany({ where: { id: current.id, status: 'PENDING' }, data: { languageVersionId } });
      }
      const enrollment = await prisma.enrollment.findUniqueOrThrow({ where: { id: current.id }, select: studentEnrollmentSelect });
      return { enrollment };
    }

    // reopen: REJECTED/WITHDRAWN → снова PENDING, прежнее решение сбрасывается
    // (история решения остаётся в журнале аудита).
    const { count } = await prisma.enrollment.updateMany({
      where: { id: current.id, status: current.status },
      data: { status: 'PENDING', languageVersionId, requestedAt: now, reviewedAt: null, reviewedById: null, reviewNote: null },
    });
    if (count === 0) throw Errors.conflict('Заявка уже изменилась, обновите страницу');
    await audit({ actorId: userId, action: 'ENROLLMENT_REQUESTED', targetType: 'Enrollment', targetId: current.id, detail: { courseId, languageVersionId, reopenedFrom: current.status } });
    const enrollment = await prisma.enrollment.findUniqueOrThrow({ where: { id: current.id }, select: studentEnrollmentSelect });
    return reply.code(201).send({ enrollment });
  });

  // DELETE /me/requests/:enrollmentId — отменить свою заявку на рассмотрении.
  app.delete('/me/requests/:enrollmentId', studentGuard(app), async (req) => {
    const { enrollmentId } = parse(z.object({ enrollmentId: z.string().min(1) }), req.params);
    const userId = req.user!.id;
    const e = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      select: {
        id: true, userId: true, status: true, courseId: true,
        certificate: { select: { id: true } },
        _count: { select: { lectureProgress: true, quizAttempts: true, practicalSessions: true } },
      },
    });
    if (!e || e.userId !== userId) throw Errors.forbidden('Нет доступа к заявке');
    if (!canCancel(e.status)) throw Errors.conflict('Отменить можно только заявку на рассмотрении');

    const hasHistory = e._count.lectureProgress + e._count.quizAttempts + e._count.practicalSessions > 0 || !!e.certificate;
    const action = cancelAction(hasHistory);
    const { count } =
      action === 'delete'
        ? await prisma.enrollment.deleteMany({ where: { id: e.id, userId, status: 'PENDING' } })
        : await prisma.enrollment.updateMany({ where: { id: e.id, userId, status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
    if (count === 0) throw Errors.conflict('Заявка уже изменилась, обновите страницу');
    await audit({ actorId: userId, action: 'ENROLLMENT_REQUEST_CANCELLED', targetType: 'Enrollment', targetId: e.id, detail: { courseId: e.courseId, action } });
    return { ok: true };
  });

  /* ── Менеджер/админ: очередь заявок ── */

  // GET /enrollment-requests?status=PENDING|REJECTED|ALL&courseId=&limit= — очередь заявок.
  // counts.pending — для бейджа в навигации (limit=0 — только счётчик, без строк).
  app.get('/enrollment-requests', managerGuard(app), async (req) => {
    const q = parse(
      z.object({
        status: z.enum(['PENDING', 'REJECTED', 'ALL']).default('PENDING'),
        courseId: z.string().min(1).optional(),
        limit: z.coerce.number().int().min(0).max(500).default(500),
      }),
      req.query,
    );
    const [items, pending] = await Promise.all([
      q.limit === 0
        ? Promise.resolve([])
        : prisma.enrollment.findMany({ where: requestListWhere(q.status, q.courseId), select: requestItemSelect, orderBy: requestListOrder(q.status), take: q.limit }),
      prisma.enrollment.count({ where: requestListWhere('PENDING', q.courseId) }),
    ]);
    return { items, counts: { pending } };
  });

  // POST /enrollment-requests/approve-bulk — одобрить выбранные ожидающие заявки.
  // Не-PENDING (уже рассмотренные/отменённые) молча пропускаются. Заявки, где когорту
  // назначить нельзя (decideCohortOnApprove) или аккаунт деактивирован, НЕ одобряются
  // и возвращаются в skipped — чтобы студент не попал на курс не в ту группу молча.
  app.post('/enrollment-requests/approve-bulk', managerGuard(app), async (req): Promise<BulkApproveResult> => {
    const { ids, cohortId } = parse(
      z.object({ ids: z.array(z.string().min(1)).min(1).max(ENROLLMENT_BULK_APPROVE_MAX), cohortId: z.string().min(1).optional() }),
      req.body,
    );
    await assertCohortExists(cohortId);
    const actorId = req.user!.id;
    const actorRole = req.user!.role;
    const now = new Date();
    const unique = [...new Set(ids)];

    const pending = await prisma.enrollment.findMany({
      where: { id: { in: unique }, status: 'PENDING' },
      select: { id: true, userId: true, user: { select: { cohortId: true, isActive: true } } },
    });
    const admittedUsers = cohortId ? await usersWithAdmittedEnrollments(pending.map((r) => r.userId)) : new Set<string>();
    const skipped: BulkApproveResult['skipped'] = [];
    const toApprove: string[] = [];
    // Кому назначить когорту: группируем по прежней когорте (условное обновление).
    const assignByCurrent = new Map<string | null, Set<string>>();
    for (const r of pending) {
      if (!r.user.isActive) { skipped.push({ id: r.id, reason: INACTIVE_MESSAGE }); continue; }
      const decision = decideCohortOnApprove({
        requested: cohortId, current: r.user.cohortId, actorRole, hasAdmittedEnrollments: admittedUsers.has(r.userId),
      });
      if (decision.action === 'forbidden' || decision.action === 'conflict') { skipped.push({ id: r.id, reason: decision.message }); continue; }
      toApprove.push(r.id);
      if (decision.action === 'assign') {
        const set = assignByCurrent.get(r.user.cohortId) ?? new Set<string>();
        set.add(r.userId);
        assignByCurrent.set(r.user.cohortId, set);
      }
    }

    const approved = await prisma.$transaction(async (tx) => {
      if (!toApprove.length) return [];
      const { count } = await tx.enrollment.updateMany({
        where: { id: { in: toApprove }, status: 'PENDING', user: { isActive: true } },
        data: { status: 'ACTIVE', startedAt: now, reviewedAt: now, reviewedById: actorId, reviewNote: null },
      });
      if (count === 0) return [];
      // Именно те строки, что перевели мы (метка reviewedAt+reviewedById этой операции).
      const rows = await tx.enrollment.findMany({
        where: { id: { in: toApprove }, status: 'ACTIVE', reviewedAt: now, reviewedById: actorId },
        select: { id: true, userId: true, courseId: true, user: { select: { cohortId: true } } },
      });
      const approvedUsers = new Set(rows.map((r) => r.userId));
      for (const [current, userIds] of assignByCurrent) {
        const target = [...userIds].filter((u) => approvedUsers.has(u));
        if (target.length) await tx.user.updateMany({ where: { id: { in: target }, cohortId: current }, data: { cohortId } });
      }
      return rows;
    });

    for (const r of approved) {
      const assigned = !!cohortId && [...assignByCurrent.values()].some((set) => set.has(r.userId));
      await audit({
        actorId, action: 'ENROLLMENT_APPROVED', targetType: 'Enrollment', targetId: r.id,
        detail: { userId: r.userId, courseId: r.courseId, bulk: true, ...(assigned ? { cohortId, previousCohortId: r.user.cohortId } : {}) },
      });
    }
    return { approved: approved.length, skipped };
  });

  // POST /enrollment-requests/:id/approve — одобрить заявку (PENDING или ранее отклонённую).
  // cohortId — назначить студенту когорту (плечо эксперимента, FR-R.1) одновременно с
  // одобрением; правила — decideCohortOnApprove (сменить назначенную может только админ).
  app.post('/enrollment-requests/:id/approve', managerGuard(app), async (req) => {
    const { id } = parse(idParams, req.params);
    const { cohortId } = parse(z.object({ cohortId: z.string().min(1).optional() }), req.body ?? {});
    const e = await prisma.enrollment.findUnique({ where: { id }, select: { id: true, status: true, userId: true, courseId: true } });
    if (!e) throw Errors.notFound('Заявка не найдена');
    if (!canApprove(e.status)) throw Errors.conflict('Заявка уже рассмотрена или не требует одобрения');
    await assertCohortExists(cohortId);

    const actorId = req.user!.id;
    const now = new Date();
    // Проверки и запись — в одной транзакции: когорта студента и статус заявки
    // меняются только условными updateMany (гонки параллельных одобрений).
    const previousCohortId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: e.userId }, select: { cohortId: true, isActive: true } });
      if (!user.isActive) throw Errors.conflict(INACTIVE_MESSAGE);
      const hasAdmittedEnrollments = cohortId
        ? (await tx.enrollment.count({ where: { userId: e.userId, status: { in: [...ADMITTED_ENROLLMENT_STATUSES] } } })) > 0
        : false;
      const decision = decideCohortOnApprove({ requested: cohortId, current: user.cohortId, actorRole: req.user!.role, hasAdmittedEnrollments });
      if (decision.action === 'forbidden') throw Errors.forbidden(decision.message);
      if (decision.action === 'conflict') throw Errors.conflict(decision.message);

      const { count } = await tx.enrollment.updateMany({
        where: { id, status: { in: [...APPROVABLE_STATUSES] } },
        data: { status: 'ACTIVE', startedAt: now, reviewedAt: now, reviewedById: actorId, reviewNote: null },
      });
      if (count === 0) throw Errors.conflict('Заявка уже рассмотрена или не требует одобрения');
      if (decision.action !== 'assign') return undefined;
      const moved = await tx.user.updateMany({ where: { id: e.userId, cohortId: user.cohortId }, data: { cohortId } });
      if (moved.count === 0) throw Errors.conflict('Группа студента уже изменилась, обновите страницу');
      return user.cohortId;
    });
    await audit({
      actorId, action: 'ENROLLMENT_APPROVED', targetType: 'Enrollment', targetId: id,
      detail: { userId: e.userId, courseId: e.courseId, fromStatus: e.status, ...(previousCohortId !== undefined ? { cohortId, previousCohortId } : {}) },
    });
    const enrollment = await prisma.enrollment.findUniqueOrThrow({ where: { id }, select: requestItemSelect });
    return { enrollment };
  });

  // POST /enrollment-requests/:id/reject — отклонить ожидающую заявку с комментарием.
  app.post('/enrollment-requests/:id/reject', managerGuard(app), async (req) => {
    const { id } = parse(idParams, req.params);
    const { note } = parse(z.object({ note: z.string().trim().max(ENROLLMENT_REVIEW_NOTE_MAX).optional() }), req.body ?? {});
    const e = await prisma.enrollment.findUnique({ where: { id }, select: { id: true, status: true, userId: true, courseId: true } });
    if (!e) throw Errors.notFound('Заявка не найдена');
    if (!canReject(e.status)) throw Errors.conflict('Отклонить можно только заявку на рассмотрении');

    const actorId = req.user!.id;
    const { count } = await prisma.enrollment.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedAt: new Date(), reviewedById: actorId, reviewNote: note ? note : null },
    });
    if (count === 0) throw Errors.conflict('Отклонить можно только заявку на рассмотрении');
    await audit({ actorId, action: 'ENROLLMENT_REJECTED', targetType: 'Enrollment', targetId: id, detail: { userId: e.userId, courseId: e.courseId, hasNote: !!note } });
    const enrollment = await prisma.enrollment.findUniqueOrThrow({ where: { id }, select: requestItemSelect });
    return { enrollment };
  });
}

const INACTIVE_MESSAGE = 'Учётная запись студента деактивирована';

/**
 * Деактивированный аккаунт не подаёт заявок: access-токен живёт до JWT_ACCESS_TTL
 * и после деактивации, поэтому проверяем по БД, а не по токену.
 */
async function assertAccountActive(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  if (!user?.isActive) throw Errors.forbidden('Учётная запись деактивирована');
}

/** Студенты, уже допущенные (ACTIVE/COMPLETED) к какому-либо курсу. */
async function usersWithAdmittedEnrollments(userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const rows = await prisma.enrollment.groupBy({
    by: ['userId'],
    where: { userId: { in: [...new Set(userIds)] }, status: { in: [...ADMITTED_ENROLLMENT_STATUSES] } },
  });
  return new Set(rows.map((r) => r.userId));
}

async function assertCohortExists(cohortId: string | undefined): Promise<void> {
  if (!cohortId) return;
  const cohort = await prisma.cohort.findUnique({ where: { id: cohortId }, select: { id: true } });
  if (!cohort) throw Errors.badRequest('Когорта не найдена');
}
