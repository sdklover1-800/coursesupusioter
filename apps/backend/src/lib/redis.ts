import { Redis } from 'ioredis';
import { env } from '../config/env.js';

/**
 * Подключение к Redis: очереди BullMQ, rate-limit, вспомогательное состояние
 * стриминга (§9.2). Бэкенд stateless — всё разделяемое состояние здесь/в БД (NFR-1.2).
 */
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // требование BullMQ
  enableReadyCheck: true,
});

/** Отдельное соединение для BullMQ-воркеров (рекомендация BullMQ). */
export function createRedisConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
