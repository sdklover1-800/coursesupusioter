import { prisma } from './prisma.js';

/**
 * Отзыв всех активных refresh-сессий пользователя (FR-1.6): смена/сброс пароля,
 * деактивация аккаунта. Уже выданный access-токен живёт до истечения
 * (JWT_ACCESS_TTL), поэтому учебные маршруты и заявки дополнительно проверяют isActive.
 */
export async function revokeAllSessions(userId: string): Promise<number> {
  const { count } = await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return count;
}
