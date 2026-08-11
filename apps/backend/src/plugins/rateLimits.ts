import { env } from '../config/env.js';

/**
 * Ограничение частоты для дорогих ИИ-эндпоинтов (NFR-2.8, аудит H4).
 * Применяется через `config` маршрута: генерация, старт/ход сократической
 * сессии, перегенерация. Глобальный лимит выключен (global:false), поэтому
 * защита есть только там, где этот config подключён явно.
 */
export const llmRateLimit = {
  rateLimit: { max: env.RATE_LIMIT_LLM_MAX, timeWindow: '1 minute' },
} as const;
