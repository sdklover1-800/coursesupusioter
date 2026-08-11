import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from '../lib/tokens.js';
import { Errors } from '../lib/errors.js';
import type { Role } from '@edu/shared';

export interface AuthUser {
  id: string;
  role: Role;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
  interface FastifyInstance {
    /** Требует валидный access-токен; заполняет request.user. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** RBAC: требует одну из ролей (§3.2, NFR-2.3). */
    requireRole: (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Аутентификация по Bearer access-токену (FR-1.6).
 * RBAC проверяется на стороне сервера на каждом защищённом эндпоинте (NFR-2.3).
 */
export default fp(async (app) => {
  app.decorate('authenticate', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw Errors.unauthorized('Отсутствует access-токен');
    const token = header.slice(7);
    try {
      const claims = await verifyAccessToken(token);
      req.user = { id: claims.sub, role: claims.role, email: claims.email };
    } catch {
      throw Errors.unauthorized('Недействительный или истёкший токен');
    }
  });

  app.decorate('requireRole', (...roles: Role[]) => {
    return async (req: FastifyRequest) => {
      if (!req.user) throw Errors.unauthorized();
      if (!roles.includes(req.user.role)) throw Errors.forbidden('Роль не имеет доступа к этому ресурсу');
    };
  });
});
