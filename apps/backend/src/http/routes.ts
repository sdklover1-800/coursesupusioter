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
    },
    { prefix: '/api' },
  );
}
