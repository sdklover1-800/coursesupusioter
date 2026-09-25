import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { Errors } from '../../lib/errors.js';
import { publicRateLimit } from '../../plugins/rateLimits.js';
import { catalogDetailSelect, catalogListSelect, hasPublishedVersion, toCatalogDetail, toCatalogSummary } from './catalog.view.js';

/**
 * Публичный каталог курсов (без входа): витрина для регистрации и заявки.
 * Только опубликованные версии и только описание/программа — никакого учебного
 * контента (видео, расшифровок, тестов, практического): он выдаётся лишь по
 * одобренной записи через учебные маршруты (гейт loadOwnedEnrollment).
 * Заявка на курс — POST /catalog/:courseId/requests (modules/enrollments).
 */
export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  // GET /catalog — курсы, у которых есть хотя бы одна опубликованная версия.
  app.get('/catalog', { config: publicRateLimit }, async () => {
    const courses = await prisma.course.findMany({
      where: hasPublishedVersion,
      select: catalogListSelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return { items: courses.map(toCatalogSummary) };
  });

  // GET /catalog/:courseId — страница курса: языки, описание, программа (модули и названия лекций).
  app.get('/catalog/:courseId', { config: publicRateLimit }, async (req) => {
    const { courseId } = parse(z.object({ courseId: z.string().min(1).max(64) }), req.params);
    const course = await prisma.course.findFirst({ where: { id: courseId, ...hasPublishedVersion }, select: catalogDetailSelect });
    if (!course) throw Errors.notFound('Курс не найден');
    return { course: toCatalogDetail(course) };
  });
}
