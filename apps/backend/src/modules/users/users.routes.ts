import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LANGUAGES, Role, type Language, type PublicUser } from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { parse } from '../../lib/validate.js';
import { Errors } from '../../lib/errors.js';
import { hashPassword, generateStartPassword } from '../../lib/password.js';
import { paginationSchema, paginate, pageMeta } from '../../lib/pagination.js';
import { audit } from '../../telemetry/events.js';
import { parseImportFile, validateAndMaybeApply } from './import.service.js';

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
    if (await prisma.user.findUnique({ where: { email } })) throw Errors.conflict('Email уже существует');
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
    const filters = parse(z.object({ role: z.enum([Role.STUDENT, Role.COURSE_MANAGER, Role.ADMIN]).optional(), cohortId: z.string().optional() }), req.query);
    const where = {
      ...(p.q ? { OR: [{ email: { contains: p.q, mode: 'insensitive' as const } }, { name: { contains: p.q, mode: 'insensitive' as const } }] } : {}),
      ...(filters.role ? { role: filters.role } : {}),
      ...(filters.cohortId ? { cohortId: filters.cohortId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.user.findMany({ where, ...paginate(p), orderBy: { createdAt: 'desc' } }),
      prisma.user.count({ where }),
    ]);
    return { items: items.map(publicUser), meta: pageMeta(total, p) };
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
    });
    const data = parse(schema, req.body);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw Errors.notFound('Пользователь не найден');

    let startPassword: string | undefined;
    const update: Record<string, unknown> = {};
    if (data.role) update.role = data.role;
    if (data.cohortId !== undefined) update.cohortId = data.cohortId;
    if (data.interfaceLanguage) update.interfaceLanguage = data.interfaceLanguage;
    if (data.isActive !== undefined) update.isActive = data.isActive;
    if (data.resetPassword) {
      startPassword = generateStartPassword();
      update.passwordHash = await hashPassword(startPassword);
      update.mustChangePassword = true;
      await prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    const updated = await prisma.user.update({ where: { id }, data: update });
    await audit({ actorId: req.user!.id, action: 'USER_UPDATED', targetType: 'User', targetId: id, detail: { fields: Object.keys(update) } });
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
