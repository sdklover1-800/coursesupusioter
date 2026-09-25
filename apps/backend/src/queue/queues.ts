import { Queue, type ConnectionOptions } from 'bullmq';
import type { GenerationType } from '@edu/shared';
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
  /**
   * QUIZ | PRACTICAL | MINI | LECTURE_SUMMARY | ALL (ALL включает и краткие содержания).
   * Воркер явно отклоняет неизвестный тип (generation/service.ts RUNNABLE_GENERATION_TYPES).
   */
  type: GenerationType;
  params: {
    moduleIds?: string[];
    /**
     * Устарело для тестов модулей: блюпринт фиксирован — MODULE_QUIZ_QUESTIONS вопросов
     * SINGLE_CHOICE (USER_DECISIONS §5). Поля оставлены для совместимости API/скриптов.
     */
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

/** Очередь фонового обслуживания (queue/maintenance.ts): брошенные сессии, зависшие попытки, токены. */
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
