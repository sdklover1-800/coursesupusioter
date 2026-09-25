import type { FastifyRequest } from 'fastify';
import { ApiErrorCode } from '@edu/shared';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

/**
 * Гейт учебного контента студента (FR-R.6, DP-3, FR-1.7, A27) — один запрос к БД:
 *  - стартовый пароль не сменён (mustChangePassword) → 403 PASSWORD_CHANGE_REQUIRED
 *    (серверная проверка: клиентский редирект после входа можно обойти);
 *  - согласие не принято ИЛИ принято для другой версии текста
 *    (≠ env RESEARCH_CONSENT_VERSION) → 403 CONSENT_REQUIRED — новый текст
 *    согласия запрашивается заново.
 * Порядок как в онбординге: сначала смена пароля, затем согласие.
 * Применяется как preHandler к учебным маршрутам студента.
 */
export async function requireConsent(req: FastifyRequest): Promise<void> {
  if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Не авторизован');
  if (req.user.role !== 'STUDENT') return; // менеджер/админ не проходят обучение
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { researchConsentAt: true, researchConsentVersion: true, mustChangePassword: true },
  });
  if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Не авторизован');
  if (user.mustChangePassword) {
    throw new AppError(403, ApiErrorCode.PASSWORD_CHANGE_REQUIRED, 'Требуется сменить стартовый пароль');
  }
  if (!user.researchConsentAt || user.researchConsentVersion !== env.RESEARCH_CONSENT_VERSION) {
    throw new AppError(403, ApiErrorCode.CONSENT_REQUIRED, 'Требуется принять информированное согласие');
  }
}
