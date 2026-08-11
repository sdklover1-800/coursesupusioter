import { Queue, type ConnectionOptions } from 'bullmq';
import { createRedisConnection } from '../lib/redis.js';

/** Имя очереди генерации ИИ-материалов (FR-7.1). */
export const GENERATION_QUEUE = 'generation';

/**
 * Префикс ключей BullMQ. По умолчанию BullMQ использует "bull", из-за чего
 * воркер ЛЮБОГО другого проекта с очередью того же имени, подключённый к тому
 * же Redis, начинает разбирать наши задачи (и валить их об свою БД).
 * Собственный неймспейс исключает это независимо от соседей.
 */
export const QUEUE_PREFIX = 'edu';

export interface GenerationJobData {
  generationJobId: string;
  courseLanguageVersionId: string;
  type: 'QUIZ' | 'PRACTICAL' | 'MINI' | 'ALL';
  params: {
    moduleIds?: string[];
    singleChoiceCount?: number;
    trueFalseCount?: number;
    difficulty?: 'VERY_EASY' | 'EASY' | 'MEDIUM' | 'HARD';
    regenStrategy?: 'OVERWRITE' | 'APPEND' | 'KEEP';
  };
  createdById: string;
}

export const generationQueue = new Queue<GenerationJobData, unknown, 'generate'>(GENERATION_QUEUE, {
  prefix: QUEUE_PREFIX,
  connection: createRedisConnection() as unknown as ConnectionOptions,
  defaultJobOptions: {
    // Идемпотентность + ретраи с backoff (§5.7)
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 500,
    removeOnFail: 1000,
  },
});

/** Очередь фонового обслуживания: закрытие брошенных сессий (§5.7, аудит H3). */
export const MAINTENANCE_QUEUE = 'maintenance';

export const maintenanceQueue = new Queue(MAINTENANCE_QUEUE, {
  prefix: QUEUE_PREFIX,
  connection: createRedisConnection() as unknown as ConnectionOptions,
  defaultJobOptions: { removeOnComplete: 50, removeOnFail: 50 },
});

/** Ставит повторяемую задачу «уборки» сессий (раз в час). Идемпотентно по jobId. */
export async function scheduleMaintenance(): Promise<void> {
  await maintenanceQueue.add(
    'sweep-abandoned-sessions',
    {},
    { repeat: { pattern: '0 * * * *' }, jobId: 'sweep-abandoned-sessions' },
  );
}
