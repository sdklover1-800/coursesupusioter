import type { FastifyInstance } from 'fastify';
import { authRoutes } from '../modules/auth/auth.routes.js';
import { userRoutes } from '../modules/users/users.routes.js';
import { courseRoutes } from '../modules/courses/courses.routes.js';
import { quizRoutes } from '../modules/quizzes/quizzes.routes.js';
import { practicalRoutes } from '../modules/practical/practical.routes.js';
import { learnRoutes } from '../modules/learn/learn.routes.js';
import { certificateRoutes } from '../modules/certificates/certificates.routes.js';
import { dashboardRoutes } from '../modules/dashboards/dashboards.routes.js';
import { researchRoutes } from '../modules/research/research.routes.js';
import { catalogRoutes } from '../modules/catalog/catalog.routes.js';
import { enrollmentRoutes } from '../modules/enrollments/enrollments.routes.js';
import { issuesRoutes } from '../modules/issues/issues.routes.js';
import { verifyRoutes } from '../modules/verify/verify.routes.js';

/** Регистрация всех доменных маршрутов под префиксом /api. */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (api) => {
      await authRoutes(api);
      await userRoutes(api);
      await courseRoutes(api);
      await quizRoutes(api);
      await practicalRoutes(api);
      await learnRoutes(api);
      await certificateRoutes(api);
      await dashboardRoutes(api);
      await researchRoutes(api);
      await catalogRoutes(api); // публичный каталог (без входа)
      await enrollmentRoutes(api); // заявки на курс и их рассмотрение
      await issuesRoutes(api); // жалобы на контент
      await verifyRoutes(api); // публичная проверка сертификата (без входа)
    },
    { prefix: '/api' },
  );
}
