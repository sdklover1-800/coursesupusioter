import type { FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';

/**
 * Гейт информированного согласия (FR-R.6, DP-3).
 * Экран согласия блокирует доступ к учебному контенту до принятия.
 * Применяется как preHandler к учебным маршрутам студента.
 */
export async function requireConsent(req: FastifyRequest): Promise<void> {
  if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Не авторизован');
  if (req.user.role !== 'STUDENT') return; // менеджер/админ не проходят обучение
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { researchConsentAt: true } });
  if (!user?.researchConsentAt) {
    throw new AppError(403, 'CONSENT_REQUIRED', 'Требуется принять информированное согласие');
  }
}
