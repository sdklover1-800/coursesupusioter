import Fastify, { type FastifyInstance, type FastifyBaseLogger } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import authPlugin from './plugins/auth.js';
import { registerErrorHandler } from './plugins/errorHandler.js';
import { registerRoutes } from './http/routes.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { registry, httpDuration, httpErrors } from './lib/metrics.js';

/** Сборка Fastify-приложения со всеми плагинами безопасности (§8.2). */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // cast: наш pino-инстанс структурно совместим с FastifyBaseLogger; каст не даёт
    // generic-параметру логгера «протекать» в тип FastifyInstance (иначе плагины/маршруты не матчатся)
    loggerInstance: logger as unknown as FastifyBaseLogger,
    trustProxy: true, // за балансировщиком (NFR-1.2)
    genReqId: () => crypto.randomUUID(),
    bodyLimit: 2 * 1024 * 1024, // 2 МБ (импорт файлов идёт через multipart)
  });

  // Безопасные заголовки + CSP (NFR-2.5, NFR-2.6). API отдаёт JSON, но политику
  // задаём явно; фронтенд (SPA) дублирует CSP в index.html (там реальная XSS-поверхность).
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        frameSrc: ['https://www.youtube-nocookie.com', 'https://www.youtube.com'], // встраивание видео (FR-4.2)
        imgSrc: ["'self'", 'data:', 'https:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, // иначе ломает встраивание YouTube-iframe
  });

  // CORS по белому списку (NFR-2.6)
  await app.register(cors, {
    origin: env.FRONTEND_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  });

  await app.register(cookie, { secret: env.COOKIE_SECRET });

  // Глобальный rate limit (NFR-2.5); дорогие эндпоинты усиливают его локально (NFR-2.8)
  await app.register(rateLimit, {
    global: false,
    redis,
    max: 300,
    timeWindow: '1 minute',
  });

  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // импорт CSV/Excel (FR-1.3)

  await app.register(authPlugin);
  registerErrorHandler(app);

  // Метрики нагрузки/ошибок (NFR-5.2): длительность и статусы запросов.
  app.addHook('onResponse', async (req, reply) => {
    const route = (req.routeOptions?.url as string) ?? req.url;
    httpDuration.observe({ method: req.method, route, status: reply.statusCode }, reply.elapsedTime);
    if (reply.statusCode >= 500) httpErrors.inc({ route });
  });

  // GET /metrics — экспорт Prometheus (в проде ограничить сетевым доступом).
  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });

  // Health-check (NFR-3.1)
  app.get('/health', async () => {
    const checks = { db: false, redis: false };
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.db = true;
    } catch {
      /* db down */
    }
    try {
      checks.redis = (await redis.ping()) === 'PONG';
    } catch {
      /* redis down */
    }
    const ok = checks.db && checks.redis;
    return { status: ok ? 'ok' : 'degraded', checks, ts: new Date().toISOString() };
  });

  await registerRoutes(app);
  return app;
}
