import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { isProd } from '../config/env.js';
import { captureError } from '../lib/sentry.js';

/** Единый обработчик ошибок → стандартный конверт { error: { code, message, details, requestId } }. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, req, reply) => {
    const requestId = req.id;

    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details, requestId },
      });
      return;
    }

    if (error instanceof ZodError) {
      reply.status(422).send({
        error: { code: 'VALIDATION', message: 'Ошибка валидации', details: error.flatten(), requestId },
      });
      return;
    }

    // Rate limit от @fastify/rate-limit
    if ((error as { statusCode?: number }).statusCode === 429) {
      reply.status(429).send({
        error: { code: 'TOO_MANY_REQUESTS', message: 'Слишком много запросов, попробуйте позже', requestId },
      });
      return;
    }

    req.log.error({ err: error }, 'Необработанная ошибка');
    captureError(error, { requestId, method: req.method, url: req.url }); // NFR-5.3
    reply.status(500).send({
      error: {
        code: 'INTERNAL',
        message: isProd ? 'Внутренняя ошибка сервера' : String(error.message ?? error),
        requestId,
      },
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Маршрут ${req.method} ${req.url} не найден`, requestId: req.id },
    });
  });
}
