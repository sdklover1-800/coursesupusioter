import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { EventType, LANGUAGES, type PublicUser } from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { parse } from '../../lib/validate.js';
import { Errors } from '../../lib/errors.js';
import { verifyPassword, hashPassword } from '../../lib/password.js';
import { signAccessToken, generateRefreshToken, hashToken } from '../../lib/tokens.js';
import { logEvent } from '../../telemetry/events.js';

/**
 * ЭТАЛОННЫЙ модуль маршрутов (пример конвенций для остальных модулей).
 * Аутентификация: JWT access + refresh (httpOnly cookie, ротация) — FR-1.6.
 */

const REFRESH_COOKIE = 'refresh_token';

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    // Путь совпадает с фактическим монтированием auth-роутов (/api/auth),
    // иначе браузер не отправит cookie на /api/auth/refresh (сессия не восстановится).
    path: '/api/auth',
    maxAge: env.JWT_REFRESH_TTL,
    signed: true,
  };
}

function toPublicUser(u: {
  id: string; email: string; name: string; role: string; interfaceLanguage: string;
  cohortId: string | null; researchConsentAt: Date | null; researchConsentVersion: string | null;
}): PublicUser {
  return {
    id: u.id, email: u.email, name: u.name, role: u.role as PublicUser['role'],
    interfaceLanguage: u.interfaceLanguage as PublicUser['interfaceLanguage'],
    cohortId: u.cohortId,
    researchConsentAt: u.researchConsentAt?.toISOString() ?? null,
    researchConsentVersion: u.researchConsentVersion,
  };
}

async function issueSession(userId: string) {
  const { token, tokenHash } = generateRefreshToken();
  const rec = await prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL * 1000) },
  });
  return { token, jti: rec.id };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

  // POST /auth/login — вход. Rate limit против брутфорса (NFR-2.5).
  app.post('/auth/login', {
    config: { rateLimit: { max: env.RATE_LIMIT_LOGIN_MAX, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Единое сообщение — не раскрываем существование email
    const invalid = Errors.unauthorized('Неверный email или пароль');
    if (!user || !user.isActive) throw invalid;
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) throw invalid;

    const access = await signAccessToken({ sub: user.id, role: user.role, email: user.email });
    const { token } = await issueSession(user.id);
    reply.setCookie(REFRESH_COOKIE, token, cookieOptions());
    await logEvent({ eventType: EventType.USER_LOGIN, userId: user.id, cohortId: user.cohortId });
    return { accessToken: access, user: toPublicUser(user), mustChangePassword: user.mustChangePassword };
  });

  // POST /auth/refresh — обновление токена с ротацией refresh (FR-1.6).
  app.post('/auth/refresh', async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (!raw) throw Errors.unauthorized('Нет refresh-токена');
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) throw Errors.unauthorized('Повреждённый refresh-токен');
    const tokenHash = hashToken(unsigned.value);
    const existing = await prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
      throw Errors.unauthorized('Refresh-токен недействителен');
    }
    // Ротация: отзываем старый, выпускаем новый
    const rotated = await issueSession(existing.userId);
    await prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date(), replacedBy: rotated.jti } });
    reply.setCookie(REFRESH_COOKIE, rotated.token, cookieOptions());
    const access = await signAccessToken({ sub: existing.user.id, role: existing.user.role, email: existing.user.email });
    return { accessToken: access, user: toPublicUser(existing.user) };
  });

  // POST /auth/logout — выход (инвалидация сессии, FR-1.6).
  app.post('/auth/logout', async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (raw) {
      const unsigned = req.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) {
        await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(unsigned.value) }, data: { revokedAt: new Date() } });
      }
    }
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { ok: true };
  });

  // POST /auth/password/change — смена пароля пользователем (FR-1.7).
  app.post('/auth/password/change', { preHandler: [app.authenticate] }, async (req) => {
    const schema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) });
    const { currentPassword, newPassword } = parse(schema, req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw Errors.notFound();
    if (!(await verifyPassword(user.passwordHash, currentPassword))) throw Errors.badRequest('Текущий пароль неверен');
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false } });
    // Инвалидируем все прочие refresh-сессии
    await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    return { ok: true };
  });

  // GET /me — текущий пользователь.
  app.get('/me', { preHandler: [app.authenticate] }, async (req) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw Errors.notFound();
    return { user: toPublicUser(user) };
  });

  // PATCH /me — сохранение предпочтений (язык интерфейса) в профиль (§6.2).
  app.patch('/me', { preHandler: [app.authenticate] }, async (req) => {
    const { interfaceLanguage } = parse(z.object({ interfaceLanguage: z.enum(LANGUAGES) }), req.body);
    const user = await prisma.user.update({ where: { id: req.user!.id }, data: { interfaceLanguage } });
    return { user: toPublicUser(user) };
  });

  // POST /me/consent — принятие информированного согласия (FR-R.6, STUDENT).
  app.post('/me/consent', { preHandler: [app.authenticate, app.requireRole('STUDENT')] }, async (req) => {
    const schema = z.object({ version: z.string().min(1) });
    const { version } = parse(schema, req.body);
    if (version !== env.RESEARCH_CONSENT_VERSION) throw Errors.conflict('Версия согласия устарела, обновите страницу');
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { researchConsentAt: new Date(), researchConsentVersion: version },
    });
    await logEvent({ eventType: EventType.CONSENT_ACCEPTED, userId: user.id, cohortId: user.cohortId, payload: { version } });
    return { user: toPublicUser(user) };
  });
}
