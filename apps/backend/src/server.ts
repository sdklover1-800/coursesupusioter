import { initSentry } from './lib/sentry.js';
initSentry(); // до создания приложения (NFR-5.3)

import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { startGenerationWorker, startMaintenanceWorker } from './queue/worker.js';

async function main(): Promise<void> {
  const app = await buildApp();

  // В dev воркеры поднимаются в том же процессе; в прод — отдельный процесс (`npm run worker`).
  const dev = env.NODE_ENV === 'development';
  const worker = dev ? startGenerationWorker() : null;
  const maintenanceWorker = dev ? startMaintenanceWorker() : null;

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info(`🚀 API на http://localhost:${env.PORT} (provider=${env.LLM_PROVIDER}, mode=${env.ORCHESTRATION_MODE})`);

  // Graceful shutdown (NFR-3.1)
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Завершение работы…');
    try {
      await app.close();
      if (worker) await worker.close();
      if (maintenanceWorker) await maintenanceWorker.close();
      await prisma.$disconnect();
      redis.disconnect();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'Фатальная ошибка запуска');
  process.exit(1);
});
