import * as Sentry from '@sentry/node';
import { env, isProd } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Трекинг ошибок (NFR-5.3). Инициализируется только при заданном SENTRY_DSN,
 * иначе всё превращается в no-op — платформа работает без внешней зависимости.
 * Вызвать ДО создания Fastify-приложения.
 */
export function initSentry(): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: isProd ? env.SENTRY_TRACES_SAMPLE_RATE : 0,
    // ПДн не отправляем наружу (DP-1): не прикрепляем тела запросов/IP.
    sendDefaultPii: false,
  });
  logger.info('Sentry инициализирован (трекинг ошибок включён)');
  return true;
}

/** Захват необработанной ошибки. Безопасно при выключенном Sentry. */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!env.SENTRY_DSN) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
