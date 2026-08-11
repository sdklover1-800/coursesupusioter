import { Worker, type ConnectionOptions } from 'bullmq';
import { createRedisConnection } from '../lib/redis.js';
import { GENERATION_QUEUE, MAINTENANCE_QUEUE, QUEUE_PREFIX, scheduleMaintenance, type GenerationJobData } from './queues.js';
import { runGeneration } from '../generation/service.js';
import { sweepAbandonedSessions, cleanupRefreshTokens } from '../modules/practical/sweep.service.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { logEvent } from '../telemetry/events.js';
import { EventType } from '@edu/shared';
import { env } from '../config/env.js';

/**
 * Воркер генерации ИИ-материалов (FR-7.1, §5.7).
 * Обновляет статус GenerationJob (QUEUED→RUNNING→DONE|ERROR); идемпотентен по generationJobId.
 * Ограничение параллелизма LLM — на уровне шлюза (NFR-1.5) + concurrency воркера.
 */
export function startGenerationWorker(): Worker<GenerationJobData> {
  const worker = new Worker<GenerationJobData>(
    GENERATION_QUEUE,
    async (job) => {
      const { generationJobId, createdById } = job.data;
      logger.info({ generationJobId, type: job.data.type }, 'Старт задачи генерации');

      await prisma.generationJob.update({ where: { id: generationJobId }, data: { status: 'RUNNING' } });
      await logEvent({ eventType: EventType.GENERATION_JOB_STARTED, userId: createdById, payload: { generationJobId, type: job.data.type } });

      try {
        const result = await runGeneration(job.data);
        await prisma.generationJob.update({
          where: { id: generationJobId },
          data: { status: 'DONE', result: result as object, error: null },
        });
        await logEvent({ eventType: EventType.GENERATION_JOB_FINISHED, userId: createdById, payload: { generationJobId, result } });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err, generationJobId }, 'Ошибка задачи генерации');
        // Помечаем ERROR только на финальной попытке
        if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
          await prisma.generationJob.update({ where: { id: generationJobId }, data: { status: 'ERROR', error: message } });
          await logEvent({ eventType: EventType.GENERATION_JOB_FINISHED, userId: createdById, payload: { generationJobId, error: message } });
        }
        throw err; // отдаём BullMQ для ретрая
      }
    },
    {
      prefix: QUEUE_PREFIX, // должен совпадать с Queue, иначе воркер не увидит задачи
      connection: createRedisConnection() as unknown as ConnectionOptions,
      concurrency: Math.min(4, env.LLM_MAX_CONCURRENCY),
    },
  );

  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'Задача генерации упала'));
  return worker;
}

/**
 * Воркер обслуживания (§5.7, аудит H3): по расписанию закрывает брошенные сессии.
 * Ставит повторяемую задачу при старте (идемпотентно).
 */
export function startMaintenanceWorker(): Worker {
  const worker = new Worker(
    MAINTENANCE_QUEUE,
    async () => {
      const closed = await sweepAbandonedSessions();
      const tokens = await cleanupRefreshTokens();
      return { closed, tokens };
    },
    { prefix: QUEUE_PREFIX, connection: createRedisConnection() as unknown as ConnectionOptions },
  );
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'Задача обслуживания упала'));
  void scheduleMaintenance();
  return worker;
}

// Позволяет запускать воркеры отдельным процессом: `npm run worker`
if (process.argv[1]?.endsWith('worker.ts') || process.argv[1]?.endsWith('worker.js')) {
  const genWorker = startGenerationWorker();
  const maintWorker = startMaintenanceWorker();
  logger.info('Воркеры генерации и обслуживания запущены (standalone)');

  // Graceful shutdown (NFR-3.1): дать текущим задачам завершиться, закрыть соединения.
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Остановка воркеров…');
    try {
      await Promise.all([genWorker.close(), maintWorker.close()]);
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
