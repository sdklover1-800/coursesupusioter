import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiErrorCode, EventType, LANGUAGES, Role, type Language, type PublicUser } from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { parse } from '../../lib/validate.js';
import { Errors } from '../../lib/errors.js';
import { hashPassword, generateStartPassword } from '../../lib/password.js';
import { paginationSchema, paginate, pageMeta } from '../../lib/pagination.js';
import { audit, logEvent } from '../../telemetry/events.js';
import { revokeAllSessions } from '../../lib/sessions.js';
import { parseImportFile, validateAndMaybeApply, SELF_REGISTERED_EMAIL_TAKEN } from './import.service.js';

const langEnum = z.enum(LANGUAGES);

function publicUser(u: {
  id: string; email: string; name: string; role: string; interfaceLanguage: string;
  cohortId: string | null; researchConsentAt: Date | null; researchConsentVersion: string | null;
}): PublicUser {
  return {
    id: u.id, email: u.email, name: u.name, role: u.role as PublicUser['role'],
    interfaceLanguage: u.interfaceLanguage as Language, cohortId: u.cohortId,
    researchConsentAt: u.researchConsentAt?.toISOString() ?? null, researchConsentVersion: u.researchConsentVersion,
  };
}

/** Управление пользователями (ADMIN, §3.2, FR-1.2–1.4). */
export async function userRoutes(app: FastifyInstance): Promise<void> {
  const adminOnly = { preHandler: [app.authenticate, app.requireRole(Role.ADMIN)] };

  // POST /admin/users — создание студента вручную (FR-1.2, FR-1.4).
  app.post('/admin/users', adminOnly, async (req) => {
    const schema = z.object({
      email: z.string().email(),
      name: z.string().min(1),
      role: z.enum([Role.STUDENT, Role.COURSE_MANAGER, Role.ADMIN]).default(Role.STUDENT),
      interfaceLanguage: langEnum.default('ru'),
      cohortId: z.string().optional().nullable(),
    });
    const data = parse(schema, req.body);
    const email = data.email.toLowerCase();
    const taken = await prisma.user.findUnique({ where: { email }, select: { selfRegisteredAt: true } });
    if (taken) throw Errors.conflict(taken.selfRegisteredAt ? SELF_REGISTERED_EMAIL_TAKEN : 'Email уже существует');
    if (data.cohortId && !(await prisma.cohort.findUnique({ where: { id: data.cohortId } }))) {
      throw Errors.badRequest('Когорта не найдена');
    }
    const startPassword = generateStartPassword();
    const user = await prisma.user.create({
      data: {
        email, name: data.name, role: data.role, interfaceLanguage: data.interfaceLanguage,
        cohortId: data.cohortId ?? null, passwordHash: await hashPassword(startPassword), mustChangePassword: true,
      },
    });
    await audit({ actorId: req.user!.id, action: 'USER_CREATED', targetType: 'User', targetId: user.id, detail: { role: user.role } });
    return { user: publicUser(user), startPassword }; // пароль показывается один раз
  });

  // GET /admin/users — список/поиск (FR пагинация).
  app.get('/admin/users', adminOnly, async (req) => {
    const p = parse(paginationSchema, req.query);
    const filters = parse(
      z.object({
        role: z.enum([Role.STUDENT, Role.COURSE_MANAGER, Role.ADMIN]).optional(),
        cohortId: z.string().optional(),
        // Статус согласия на участие (FE5 «Фильтры»): given — текущая версия текста, outdated — старая, missing — нет
        consent: z.enum(['given', 'outdated', 'missing']).optional(),
      }),
      req.query,
    );
    const consentWhere =
      filters.consent === 'given'
        ? { researchConsentAt: { not: null }, researchConsentVersion: env.RESEARCH_CONSENT_VERSION }
        : filters.consent === 'outdated'
          ? { researchConsentAt: { not: null }, OR: [{ researchConsentVersion: null }, { researchConsentVersion: { not: env.RESEARCH_CONSENT_VERSION } }] }
          : filters.consent === 'missing'
            ? { researchConsentAt: null }
            : {};
    const where = {
      ...(p.q ? { OR: [{ email: { contains: p.q, mode: 'insensitive' as const } }, { name: { contains: p.q, mode: 'insensitive' as const } }] } : {}),
      ...(filters.role ? { role: filters.role } : {}),
      ...(filters.cohortId ? { cohortId: filters.cohortId } : {}),
      // Через AND: у фильтра согласия свой OR, он не должен затирать OR поиска
      AND: [consentWhere],
    };
    const [items, total] = await Promise.all([
      prisma.user.findMany({ where, ...paginate(p), orderBy: { createdAt: 'desc' } }),
      prisma.user.count({ where }),
    ]);
    // Последняя учебная активность — max(Enrollment.lastActivityAt) одним запросом на страницу.
    const activity = items.length
      ? await prisma.enrollment.groupBy({ by: ['userId'], where: { userId: { in: items.map((u) => u.id) } }, _max: { lastActivityAt: true } })
      : [];
    const lastActivity = new Map(activity.map((a) => [a.userId, a._max.lastActivityAt]));
    // selfRegisteredAt/isActive — для админа: саморегистрация (email не подтверждён), деактивация;
    // researchConsentAt/Version (в publicUser) и lastActivityAt — для контроля участия.
    return {
      items: items.map((u) => ({
        ...publicUser(u),
        isActive: u.isActive,
        selfRegisteredAt: u.selfRegisteredAt?.toISOString() ?? null,
        lastActivityAt: lastActivity.get(u.id)?.toISOString() ?? null,
      })),
      meta: pageMeta(total, p),
    };
  });

  // PATCH /admin/users/:id — роль, когорта, сброс пароля (FR-1.7).
  app.patch('/admin/users/:id', adminOnly, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const schema = z.object({
      role: z.enum([Role.STUDENT, Role.COURSE_MANAGER, Role.ADMIN]).optional(),
      cohortId: z.string().nullable().optional(),
      interfaceLanguage: langEnum.optional(),
      isActive: z.boolean().optional(),
      resetPassword: z.boolean().optional(),
      // Явное подтверждение смены группы при зафиксированном составе (STUDY_COHORTS_LOCKED)
      force: z.boolean().optional(),
    });
    const data = parse(schema, req.body);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw Errors.notFound('Пользователь не найден');
    const cohortChanged = data.cohortId !== undefined && data.cohortId !== user.cohortId;
    if (cohortChanged) {
      if (env.STUDY_COHORTS_LOCKED && !data.force) {
        throw Errors.coded(409, ApiErrorCode.COHORTS_LOCKED, 'Состав групп эксперимента зафиксирован — смена группы только с явным подтверждением (force)');
      }
      if (data.cohortId && !(await prisma.cohort.findUnique({ where: { id: data.cohortId }, select: { id: true } }))) {
        throw Errors.badRequest('Когорта не найдена');
      }
    }

    let startPassword: string | undefined;
    const update: Record<string, unknown> = {};
    if (data.role) update.role = data.role;
    if (cohortChanged) update.cohortId = data.cohortId;
    if (data.interfaceLanguage) update.interfaceLanguage = data.interfaceLanguage;
    if (data.isActive !== undefined) update.isActive = data.isActive;
    if (data.resetPassword) {
      startPassword = generateStartPassword();
      update.passwordHash = await hashPassword(startPassword);
      update.mustChangePassword = true;
    }
    const updated = await prisma.user.update({ where: { id }, data: update });
    // Сброс пароля и деактивация обрывают все сессии: без этого ротация refresh-токена
    // продлевала бы сессию деактивированного аккаунта бесконечно.
    if (data.resetPassword || data.isActive === false) await revokeAllSessions(id);
    await audit({
      actorId: req.user!.id, action: 'USER_UPDATED', targetType: 'User', targetId: id,
      detail: { fields: Object.keys(update), ...(cohortChanged ? { cohort: { from: user.cohortId, to: data.cohortId ?? null } } : {}) },
    });
    // Смена группы эксперимента — отдельный аудит from/to и событие в журнал исследования (A27).
    if (cohortChanged) {
      const change = { from: user.cohortId, to: data.cohortId ?? null };
      await audit({ actorId: req.user!.id, action: 'USER_COHORT_CHANGED', targetType: 'User', targetId: id, detail: { ...change, source: 'ADMIN_EDIT' } });
      await logEvent({ eventType: EventType.COHORT_CHANGED, userId: id, cohortId: change.to, payload: { ...change, actorId: req.user!.id, source: 'ADMIN_EDIT' } });
    }
    return { user: publicUser(updated), ...(startPassword ? { startPassword } : {}) };
  });

  // POST /admin/users/import — импорт CSV/Excel: preview (dryRun) или apply (FR-1.3).
  app.post('/admin/users/import', adminOnly, async (req) => {
    const file = await req.file();
    if (!file) throw Errors.badRequest('Файл не приложен (поле "file")');
    const apply = (file.fields?.apply as { value?: string } | undefined)?.value === 'true';
    const buffer = await file.toBuffer();
    const rows = parseImportFile(buffer, file.filename);
    if (rows.length === 0) throw Errors.badRequest('Файл пуст или не распознан');
    const defaultLanguage = 'ru' as Language;
    const report = await validateAndMaybeApply(rows, defaultLanguage, apply);
    if (apply) {
      await audit({ actorId: req.user!.id, action: 'USERS_IMPORTED', detail: { total: report.total, valid: report.valid } });
    }
    return { applied: apply, report };
  });

  // GET /admin/consent-info — текущая версия текста согласия (для формы).
  app.get('/admin/consent-info', { preHandler: [app.authenticate] }, async () => {
    return { version: env.RESEARCH_CONSENT_VERSION };
  });
}
