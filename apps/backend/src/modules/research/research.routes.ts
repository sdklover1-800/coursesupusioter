import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Role, EventType } from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { Errors } from '../../lib/errors.js';
import { audit, logEvent } from '../../telemetry/events.js';
import { streamExportCsv, filenameFor, type ExportType } from './export.service.js';

const adminOnly = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.ADMIN)] });

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

  // PATCH /admin/cohorts/:id — правка когорты.
  app.patch('/admin/cohorts/:id', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const data = parse(z.object({ name: z.string().min(1).optional(), condition: z.string().min(1).optional(), description: z.string().optional() }), req.body);
    const cohort = await prisma.cohort.update({ where: { id }, data });
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

  // GET /admin/export?type=... — экспорт исследовательских данных в CSV (FR-R.4, DP-6).
  // Потоковая выгрузка (аудит M4): без загрузки всей таблицы в память.
  app.get('/admin/export', guard, async (req, reply) => {
    const { type } = parse(z.object({ type: z.enum(['events', 'sessions', 'rubric', 'quiz_attempts', 'cohort_summary']) }), req.query);
    await audit({ actorId: req.user!.id, action: 'DATA_EXPORTED', detail: { type } }); // NFR-2.9
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filenameFor(type as ExportType)}"`,
      'Cache-Control': 'no-store',
    });
    try {
      await streamExportCsv(type as ExportType, (chunk) => reply.raw.write(chunk));
    } catch (err) {
      req.log.error({ err, type }, 'Ошибка потокового экспорта');
    } finally {
      reply.raw.end();
    }
  });

  // GET /admin/audit — журнал аудита (NFR-2.9).
  app.get('/admin/audit', guard, async (req) => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    const items = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit, include: { actor: { select: { name: true, email: true, role: true } } } });
    return { items };
  });
}
