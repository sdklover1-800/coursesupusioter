import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Role, EventType } from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { Errors } from '../../lib/errors.js';
import { audit, logEvent } from '../../telemetry/events.js';
import { streamExportCsv, filenameFor, EXPORT_TYPES, type ExportFilters } from './export.service.js';

/** Дата «по» включительно: '2026-09-30' без времени — до конца этого дня (UTC). */
const dateTo = z.preprocess(
  (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59.999Z` : v),
  z.coerce.date(),
);

const adminOnly = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.ADMIN)] });
const managerOrAdmin = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.COURSE_MANAGER, Role.ADMIN)] });

/** Поддержка научного исследования (§7, §11.4): когорты, занятия с преподавателем, экспорт. */
export async function researchRoutes(app: FastifyInstance): Promise<void> {
  const guard = adminOnly(app);

  // POST /admin/cohorts — создать когорту (FR-R.1).
  app.post('/admin/cohorts', guard, async (req) => {
    const data = parse(z.object({ name: z.string().min(1), condition: z.string().min(1), description: z.string().optional() }), req.body);
    if (await prisma.cohort.findUnique({ where: { name: data.name } })) throw Errors.conflict('Когорта с таким именем уже есть');
    const cohort = await prisma.cohort.create({ data });
    await audit({ actorId: req.user!.id, action: 'COHORT_CREATED', targetType: 'Cohort', targetId: cohort.id, detail: { condition: cohort.condition } });
    return { cohort };
  });

  // GET /admin/cohorts — список когорт.
  app.get('/admin/cohorts', guard, async () => {
    const cohorts = await prisma.cohort.findMany({ include: { _count: { select: { users: true, teacherSessions: true } } }, orderBy: { createdAt: 'asc' } });
    return { items: cohorts };
  });

  // GET /cohorts — краткий список когорт для выбора при одобрении заявки на курс
  // (менеджер и админ; без счётчиков и описаний — полная версия в /admin/cohorts).
  app.get('/cohorts', managerOrAdmin(app), async () => {
    const items = await prisma.cohort.findMany({ select: { id: true, name: true, condition: true }, orderBy: { createdAt: 'asc' } });
    return { items };
  });

  // PATCH /admin/cohorts/:id — правка когорты.
  app.patch('/admin/cohorts/:id', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const data = parse(z.object({ name: z.string().min(1).optional(), condition: z.string().min(1).optional(), description: z.string().optional() }), req.body);
    const before = await prisma.cohort.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('Когорта не найдена');
    if (data.name && data.name !== before.name && (await prisma.cohort.findUnique({ where: { name: data.name } }))) {
      throw Errors.conflict('Когорта с таким именем уже есть');
    }
    const cohort = await prisma.cohort.update({ where: { id }, data });
    // Смена условия эксперимента меняет интерпретацию данных всех студентов когорты — в аудит с from/to (NFR-2.9)
    await audit({
      actorId: req.user!.id, action: 'COHORT_UPDATED', targetType: 'Cohort', targetId: id,
      detail: { fields: Object.keys(data), ...(data.condition && data.condition !== before.condition ? { condition: { from: before.condition, to: data.condition } } : {}) },
    });
    return { cohort };
  });

  // POST /admin/teacher-sessions — ручная регистрация занятия с преподавателем (FR-R.9).
  app.post('/admin/teacher-sessions', guard, async (req) => {
    const data = parse(z.object({ cohortId: z.string(), date: z.string().datetime().or(z.string()), topic: z.string().min(1) }), req.body);
    const cohort = await prisma.cohort.findUnique({ where: { id: data.cohortId } });
    if (!cohort) throw Errors.notFound('Когорта не найдена');
    const session = await prisma.teacherSession.create({ data: { cohortId: data.cohortId, date: new Date(data.date), topic: data.topic, loggedById: req.user!.id } });
    await logEvent({ eventType: EventType.TEACHER_SESSION_LOGGED, userId: req.user!.id, cohortId: data.cohortId, payload: { topic: data.topic, date: session.date } });
    return { session };
  });

  // GET /admin/teacher-sessions?cohortId — список занятий.
  app.get('/admin/teacher-sessions', guard, async (req) => {
    const { cohortId } = parse(z.object({ cohortId: z.string().optional() }), req.query);
    const items = await prisma.teacherSession.findMany({ where: cohortId ? { cohortId } : {}, orderBy: { date: 'desc' }, include: { cohort: { select: { name: true } } } });
    return { items };
  });

  // GET /admin/export?type=...&courseId&cohortId&from&to — экспорт исследовательских
  // данных в CSV (FR-R.4, DP-6). Потоковая выгрузка (аудит M4): без загрузки всей
  // таблицы в память. Фильтры — для всех типов (курс, когорта, период).
  app.get('/admin/export', guard, async (req, reply) => {
    const q = parse(
      z.object({
        type: z.enum(EXPORT_TYPES),
        courseId: z.string().optional(),
        cohortId: z.string().optional(),
        from: z.coerce.date().optional(),
        to: dateTo.optional(),
      }),
      req.query,
    );
    const filters: ExportFilters = { courseId: q.courseId, cohortId: q.cohortId, from: q.from, to: q.to };
    await audit({
      actorId: req.user!.id,
      action: 'DATA_EXPORTED',
      detail: { type: q.type, courseId: q.courseId ?? null, cohortId: q.cohortId ?? null, from: q.from?.toISOString() ?? null, to: q.to?.toISOString() ?? null },
    }); // NFR-2.9
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filenameFor(q.type)}"`,
      'Cache-Control': 'no-store',
    });
    try {
      await streamExportCsv(q.type, (chunk) => reply.raw.write(chunk), filters);
    } catch (err) {
      req.log.error({ err, type: q.type }, 'Ошибка потокового экспорта');
    } finally {
      reply.raw.end();
    }
  });

  // GET /admin/audit?cursor&limit&action&actorId&targetType&from&to — журнал аудита
  // (NFR-2.9): курсорная пагинация (новые сверху), limit ≤ 200 → {items, nextCursor}.
  app.get('/admin/audit', guard, async (req) => {
    const q = parse(
      z.object({
        cursor: z.string().max(64).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        action: z.string().max(80).optional(),
        actorId: z.string().max(64).optional(),
        targetType: z.string().max(80).optional(),
        from: z.coerce.date().optional(),
        to: dateTo.optional(),
      }),
      req.query,
    );
    const where = {
      ...(q.action ? { action: q.action } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.targetType ? { targetType: q.targetType } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    };
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: { actor: { select: { name: true, email: true, role: true } } },
    });
    const items = rows.slice(0, q.limit);
    return { items, nextCursor: rows.length > q.limit ? (items[items.length - 1]?.id ?? null) : null };
  });
}
