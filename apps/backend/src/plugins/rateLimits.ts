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

/**
 * Самостоятельная регистрация (POST /auth/register): жёсткий лимит на IP в час —
 * против массового создания аккаунтов и перебора email (ответ одинаков всегда).
 */
export const registerRateLimit = {
  rateLimit: { max: env.RATE_LIMIT_REGISTER_MAX, timeWindow: '1 hour' },
} as const;

/** Публичные эндпоинты без входа (каталог курсов): умеренный лимит на IP. */
export const publicRateLimit = {
  rateLimit: { max: env.RATE_LIMIT_PUBLIC_MAX, timeWindow: '1 minute' },
} as const;
