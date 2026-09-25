import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { Role, ApiErrorCode, EventType, ENROLLMENT_BULK_APPROVE_MAX, ENROLLMENT_REVIEW_NOTE_MAX, type BulkApproveResult } from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { Errors } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { audit, logEvent } from '../../telemetry/events.js';
import {
  APPROVABLE_STATUSES,
  canApprove,
  canCancel,
  canReject,
  cancelAction,
  decideCohortOnApprove,
  decideSelfRequest,
  isAdmitted,
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
  // назначить нельзя (decideCohortOnApprove: нет прав, конфликт, нужна явная
  // confirmCohortAssign, группы зафиксированы без force) или аккаунт деактивирован,
  // НЕ одобряются и возвращаются в skipped — чтобы студент не попал на курс не в ту группу молча.
  app.post('/enrollment-requests/approve-bulk', managerGuard(app), async (req): Promise<BulkApproveResult> => {
    const { ids, cohortId, confirmCohortAssign, force } = parse(
      z.object({
        ids: z.array(z.string().min(1)).min(1).max(ENROLLMENT_BULK_APPROVE_MAX),
        cohortId: z.string().min(1).optional(),
        confirmCohortAssign: z.boolean().optional(),
        force: z.boolean().optional(),
      }),
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
    const history = cohortId ? await studyHistory(prisma, pending.map((r) => r.userId)) : new Map<string, StudyHistory>();
    const skipped: BulkApproveResult['skipped'] = [];
    const toApprove: string[] = [];
    // Кому назначить когорту: группируем по прежней когорте (условное обновление).
    const assignByCurrent = new Map<string | null, Set<string>>();
    for (const r of pending) {
      if (!r.user.isActive) { skipped.push({ id: r.id, reason: INACTIVE_MESSAGE }); continue; }
      const h = history.get(r.userId) ?? NO_HISTORY;
      const decision = decideCohortOnApprove({
        requested: cohortId, current: r.user.cohortId, actorRole,
        hasAdmittedEnrollments: h.admittedEnrollments > 0, hasPriorStudyData: hasStudyData(h),
        confirmed: !!confirmCohortAssign, cohortsLocked: env.STUDY_COHORTS_LOCKED, force: !!force,
      });
      if (decision.action !== 'keep' && decision.action !== 'assign') { skipped.push({ id: r.id, reason: decision.message }); continue; }
      toApprove.push(r.id);
      if (decision.action === 'assign') {
        const set = assignByCurrent.get(r.user.cohortId) ?? new Set<string>();
        set.add(r.userId);
        assignByCurrent.set(r.user.cohortId, set);
      }
    }

    const { approved, cohortChanges } = await prisma.$transaction(async (tx) => {
      if (!toApprove.length) return { approved: [], cohortChanges: [] };
      const { count } = await tx.enrollment.updateMany({
        where: { id: { in: toApprove }, status: 'PENDING', user: { isActive: true } },
        data: { status: 'ACTIVE', startedAt: now, reviewedAt: now, reviewedById: actorId, reviewNote: null },
      });
      if (count === 0) return { approved: [], cohortChanges: [] };
      // Именно те строки, что перевели мы (метка reviewedAt+reviewedById этой операции).
      const rows = await tx.enrollment.findMany({
        where: { id: { in: toApprove }, status: 'ACTIVE', reviewedAt: now, reviewedById: actorId },
        select: { id: true, userId: true, courseId: true },
      });
      const approvedUsers = new Set(rows.map((r) => r.userId));
      // Фактические смены группы: только тех, чья когорта ещё прежняя (условное обновление).
      const changes: CohortChange[] = [];
      for (const [current, userIds] of assignByCurrent) {
        const target = [...userIds].filter((u) => approvedUsers.has(u));
        if (!target.length) continue;
        const candidates = await tx.user.findMany({ where: { id: { in: target }, cohortId: current }, select: { id: true } });
        if (!candidates.length) continue;
        await tx.user.updateMany({ where: { id: { in: candidates.map((c) => c.id) }, cohortId: current }, data: { cohortId } });
        for (const c of candidates) changes.push({ userId: c.id, from: current, to: cohortId! });
      }
      return { approved: rows, cohortChanges: changes };
    });

    const changedBy = new Map(cohortChanges.map((c) => [c.userId, c]));
    for (const r of approved) {
      const change = changedBy.get(r.userId);
      await audit({
        actorId, action: 'ENROLLMENT_APPROVED', targetType: 'Enrollment', targetId: r.id,
        detail: { userId: r.userId, courseId: r.courseId, bulk: true, ...(change ? { cohortId: change.to, previousCohortId: change.from } : {}) },
      });
    }
    for (const c of cohortChanges) await recordCohortChange(c, actorId, 'APPROVE');
    return { approved: approved.length, skipped };
  });

  // POST /enrollment-requests/:id/approve — одобрить заявку (PENDING или ранее отклонённую).
  // cohortId — назначить студенту когорту (плечо эксперимента, FR-R.1) одновременно с
  // одобрением; правила — decideCohortOnApprove (сменить назначенную может только админ).
  // Студенту без группы, но с учебными данными — 409 COHORT_CONFIRM_REQUIRED, повтор с
  // confirmCohortAssign: true; при STUDY_COHORTS_LOCKED — 409 COHORTS_LOCKED без force.
  app.post('/enrollment-requests/:id/approve', managerGuard(app), async (req) => {
    const { id } = parse(idParams, req.params);
    const { cohortId, confirmCohortAssign, force } = parse(
      z.object({ cohortId: z.string().min(1).optional(), confirmCohortAssign: z.boolean().optional(), force: z.boolean().optional() }),
      req.body ?? {},
    );
    const e = await prisma.enrollment.findUnique({ where: { id }, select: { id: true, status: true, userId: true, courseId: true } });
    if (!e) throw Errors.notFound('Заявка не найдена');
    if (!canApprove(e.status)) throw Errors.conflict('Заявка уже рассмотрена или не требует одобрения');
    await assertCohortExists(cohortId);

    const actorId = req.user!.id;
    const now = new Date();
    // Проверки и запись — в одной транзакции: когорта студента и статус заявки
    // меняются только условными updateMany (гонки параллельных одобрений).
    const change = await prisma.$transaction(async (tx): Promise<CohortChange | null> => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: e.userId }, select: { cohortId: true, isActive: true } });
      if (!user.isActive) throw Errors.conflict(INACTIVE_MESSAGE);
      const h = cohortId ? ((await studyHistory(tx, [e.userId])).get(e.userId) ?? NO_HISTORY) : NO_HISTORY;
      const decision = decideCohortOnApprove({
        requested: cohortId, current: user.cohortId, actorRole: req.user!.role,
        hasAdmittedEnrollments: h.admittedEnrollments > 0, hasPriorStudyData: hasStudyData(h),
        confirmed: !!confirmCohortAssign, cohortsLocked: env.STUDY_COHORTS_LOCKED, force: !!force,
      });
      if (decision.action === 'forbidden') throw Errors.forbidden(decision.message);
      if (decision.action === 'conflict') throw Errors.conflict(decision.message);
      if (decision.action === 'locked') throw Errors.coded(409, ApiErrorCode.COHORTS_LOCKED, decision.message);
      if (decision.action === 'confirm_required') {
        throw Errors.coded(409, ApiErrorCode.COHORT_CONFIRM_REQUIRED, decision.message, {
          requestedCohortId: cohortId,
          priorEnrollments: h.admittedEnrollments,
          priorAttempts: h.quizAttempts + h.practicalSessions,
          priorLectures: h.lectureProgress,
        });
      }

      const { count } = await tx.enrollment.updateMany({
        where: { id, status: { in: [...APPROVABLE_STATUSES] } },
        data: { status: 'ACTIVE', startedAt: now, reviewedAt: now, reviewedById: actorId, reviewNote: null },
      });
      if (count === 0) throw Errors.conflict('Заявка уже рассмотрена или не требует одобрения');
      if (decision.action !== 'assign') return null;
      const moved = await tx.user.updateMany({ where: { id: e.userId, cohortId: user.cohortId }, data: { cohortId } });
      if (moved.count === 0) throw Errors.conflict('Группа студента уже изменилась, обновите страницу');
      return { userId: e.userId, from: user.cohortId, to: cohortId! };
    });
    await audit({
      actorId, action: 'ENROLLMENT_APPROVED', targetType: 'Enrollment', targetId: id,
      detail: { userId: e.userId, courseId: e.courseId, fromStatus: e.status, ...(change ? { cohortId: change.to, previousCohortId: change.from } : {}) },
    });
    if (change) await recordCohortChange(change, actorId, 'APPROVE');
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

/** Учебная история студента (по всем его записям) — для решения о группе эксперимента. */
interface StudyHistory {
  admittedEnrollments: number;
  lectureProgress: number;
  quizAttempts: number;
  practicalSessions: number;
}
const NO_HISTORY: StudyHistory = { admittedEnrollments: 0, lectureProgress: 0, quizAttempts: 0, practicalSessions: 0 };
const hasStudyData = (h: StudyHistory) =>
  h.admittedEnrollments + h.lectureProgress + h.quizAttempts + h.practicalSessions > 0;

/**
 * Учебная история студентов одним запросом: допущенные записи (ACTIVE/COMPLETED) и
 * прогресс лекций/попытки/сессии на ЛЮБЫХ записях — в т. ч. отозванных (данные,
 * собранные вне условия эксперимента, остаются в выгрузке).
 */
async function studyHistory(db: Pick<Prisma.TransactionClient, 'enrollment'>, userIds: string[]): Promise<Map<string, StudyHistory>> {
  const result = new Map<string, StudyHistory>();
  if (!userIds.length) return result;
  const rows = await db.enrollment.findMany({
    where: { userId: { in: [...new Set(userIds)] } },
    select: { userId: true, status: true, _count: { select: { lectureProgress: true, quizAttempts: true, practicalSessions: true } } },
  });
  for (const r of rows) {
    const h = result.get(r.userId) ?? { ...NO_HISTORY };
    if (isAdmitted(r.status)) h.admittedEnrollments++;
    h.lectureProgress += r._count.lectureProgress;
    h.quizAttempts += r._count.quizAttempts;
    h.practicalSessions += r._count.practicalSessions;
    result.set(r.userId, h);
  }
  return result;
}

interface CohortChange {
  userId: string;
  from: string | null;
  to: string;
}

/**
 * Фактическая смена группы эксперимента: аудит (from/to) + событие COHORT_CHANGED
 * в журнал исследования (userId — студент), чтобы выгрузка знала момент смены плеча.
 */
async function recordCohortChange(c: CohortChange, actorId: string, source: 'APPROVE' | 'ADMIN_EDIT'): Promise<void> {
  await audit({ actorId, action: 'USER_COHORT_CHANGED', targetType: 'User', targetId: c.userId, detail: { from: c.from, to: c.to, source } });
  await logEvent({ eventType: EventType.COHORT_CHANGED, userId: c.userId, cohortId: c.to, payload: { from: c.from, to: c.to, actorId, source } });
}

async function assertCohortExists(cohortId: string | undefined): Promise<void> {
  if (!cohortId) return;
  const cohort = await prisma.cohort.findUnique({ where: { id: cohortId }, select: { id: true } });
  if (!cohort) throw Errors.badRequest('Когорта не найдена');
}
