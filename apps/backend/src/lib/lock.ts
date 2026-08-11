import { redis } from './redis.js';
import { Errors } from './errors.js';

/**
 * Лёгкая взаимоблокировка на Redis (аудит H5).
 * Сериализует критические операции по ключу (ход сократической сессии, старт
 * сессии), чтобы параллельные запросы не обходили лимит реплик и не портили
 * серверный учёт токенов. Бэкенд stateless — состояние блокировки в Redis.
 */
export async function withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const lockKey = `lock:${key}`;
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const acquired = await redis.set(lockKey, token, 'PX', ttlMs, 'NX');
  if (!acquired) throw Errors.conflict('Операция уже выполняется, дождитесь ответа');
  try {
    return await fn();
  } finally {
    // Снимаем блокировку только если она всё ещё наша (Lua — атомарно).
    await redis
      .eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lockKey, token)
      .catch(() => undefined);
  }
}
