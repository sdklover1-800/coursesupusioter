import { z } from 'zod';

/**
 * Валидация переменных окружения на старте (fail-fast).
 * Секреты берутся только отсюда (NFR-2.7) — в коде их нет.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.coerce.number().default(900),
  JWT_REFRESH_TTL: z.coerce.number().default(1209600),
  COOKIE_SECRET: z.string().min(16),

  LLM_PROVIDER: z.enum(['mock', 'anthropic', 'openai']).default('mock'),
  LLM_MODEL_GENERATION: z.string().default('claude-haiku-4-5-20251001'),
  LLM_MODEL_DIALOG: z.string().default('claude-haiku-4-5-20251001'),
  LLM_MODEL_JUDGE: z.string().default('claude-haiku-4-5-20251001'),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  ORCHESTRATION_MODE: z.enum(['TUTOR_JUDGE', 'SINGLE_CALL']).default('TUTOR_JUDGE'),
  LLM_ZERO_RETENTION: z.coerce.boolean().default(true),
  LLM_MAX_CONCURRENCY: z.coerce.number().default(25),
  // Цена токенов для оценки стоимости (§5.6h), USD за 1M токенов. Дефолты — уровень
  // Haiku-класса; уточняется по фактическому прайсу выбранной моделью пилота.
  LLM_PRICE_INPUT_PER_MTOK: z.coerce.number().default(1),
  LLM_PRICE_OUTPUT_PER_MTOK: z.coerce.number().default(5),

  RESEARCH_CONSENT_VERSION: z.string().default('2026-07-01'),

  DEFAULT_MAX_AI_MESSAGES: z.coerce.number().default(22),
  TOKEN_CEILING_EN: z.coerce.number().default(9000),
  TOKEN_CEILING_RU: z.coerce.number().default(18000),
  TOKEN_CEILING_KK: z.coerce.number().default(24000),
  MAX_STUDENT_MESSAGE_CHARS: z.coerce.number().default(1500),
  SESSION_IDLE_PAUSE_MINUTES: z.coerce.number().default(60),
  SESSION_ABANDON_DAYS: z.coerce.number().default(7),

  RATE_LIMIT_LOGIN_MAX: z.coerce.number().default(10),
  RATE_LIMIT_LLM_MAX: z.coerce.number().default(30),

  // Трекинг ошибок (NFR-5.3). Пусто → Sentry выключен (no-op).
  SENTRY_DSN: z.string().optional().default(''),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Некорректная конфигурация окружения:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

/** Токен-потолок по языку (§5.6). */
export function tokenCeilingFor(language: string): number {
  switch (language) {
    case 'en':
      return env.TOKEN_CEILING_EN;
    case 'ru':
      return env.TOKEN_CEILING_RU;
    case 'kk':
      return env.TOKEN_CEILING_KK;
    default:
      // Для нового языка (§6.4) до калибровки пилотом — консервативно как kk.
      return env.TOKEN_CEILING_KK;
  }
}
