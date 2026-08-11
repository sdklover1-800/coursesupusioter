import { redis } from '../lib/redis.js';
import { env } from '../config/env.js';

/**
 * Глобальный (межинстансный) лимит параллелизма вызовов LLM (NFR-1.5).
 * Внутрипроцессного семафора недостаточно при горизонтальном масштабировании
 * (NFR-1.2): суммарный параллелизм = инстансы × LLM_MAX_CONCURRENCY. Здесь —
 * распределённый семафор на Redis (ZSET активных токенов) с TTL-самоочисткой:
 * упавший инстанс не «залипает» держателем слота.
 */
const KEY = 'llm:concurrency';
const TTL_MS = 120_000; // страховка: слот старше TTL считается протухшим

// Атомарно: убрать протухшие → если активных < max, добавить свой токен.
const ACQUIRE = `
redis.call('zremrangebyscore', KEYS[1], '-inf', ARGV[3])
if redis.call('zcard', KEYS[1]) < tonumber(ARGV[2]) then
  redis.call('zadd', KEYS[1], ARGV[4], ARGV[1])
  return 1
end
return 0`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function acquireLlmSlot(): Promise<string> {
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  for (let i = 0; ; i++) {
    const now = Date.now();
    try {
      const ok = await redis.eval(ACQUIRE, 1, KEY, token, String(env.LLM_MAX_CONCURRENCY), String(now - TTL_MS), String(now));
      if (ok === 1) return token;
    } catch {
      // Redis недоступен — не блокируем работу LLM бесконечно, отдаём слот локально.
      return token;
    }
    await sleep(Math.min(500, 40 + i * 20) + Math.floor(Math.random() * 40));
  }
}

export async function releaseLlmSlot(token: string): Promise<void> {
  await redis.zrem(KEY, token).catch(() => undefined);
}
