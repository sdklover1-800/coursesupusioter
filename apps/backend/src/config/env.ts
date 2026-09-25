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

  // auto — OpenAI, если задан его ключ, иначе Anthropic, иначе mock.
  LLM_PROVIDER: z.enum(['mock', 'anthropic', 'openai', 'auto']).default('mock'),
  // Пусто — модель по умолчанию для выбранного провайдера (см. DEFAULT_MODELS).
  LLM_MODEL_GENERATION: z.string().default(''),
  LLM_MODEL_DIALOG: z.string().default(''),
  LLM_MODEL_JUDGE: z.string().default(''),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  // Уровень рассуждений reasoning-моделей OpenAI (GPT-5.x, o-серия) по назначению вызова.
  // none — без рассуждений: быстрее всего и допускает temperature (нужно живому диалогу);
  // пусто — параметр не передаётся (для моделей без рассуждений и совместимых эндпоинтов).
  OPENAI_REASONING_GENERATION: z.enum(['', 'none', 'low', 'medium', 'high', 'xhigh']).default('low'),
  OPENAI_REASONING_DIALOG: z.enum(['', 'none', 'low', 'medium', 'high', 'xhigh']).default('none'),
  OPENAI_REASONING_JUDGE: z.enum(['', 'none', 'low', 'medium', 'high', 'xhigh']).default('low'),
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

/** Модели по умолчанию для провайдера — чтобы смена LLM_PROVIDER не оставляла чужие id. */
export const DEFAULT_MODELS = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-5.4-mini',
  mock: 'mock',
} as const;

export type ResolvedProvider = keyof typeof DEFAULT_MODELS;

export function resolveProvider(e: Pick<z.infer<typeof envSchema>, 'LLM_PROVIDER' | 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY'>): ResolvedProvider {
  if (e.LLM_PROVIDER !== 'auto') return e.LLM_PROVIDER;
  if (e.OPENAI_API_KEY) return 'openai';
  if (e.ANTHROPIC_API_KEY) return 'anthropic';
  return 'mock';
}

const provider = resolveProvider(parsed.data);
const defaultModel = DEFAULT_MODELS[provider];

export const env = {
  ...parsed.data,
  LLM_PROVIDER: provider,
  LLM_MODEL_GENERATION: parsed.data.LLM_MODEL_GENERATION || defaultModel,
  LLM_MODEL_DIALOG: parsed.data.LLM_MODEL_DIALOG || defaultModel,
  LLM_MODEL_JUDGE: parsed.data.LLM_MODEL_JUDGE || defaultModel,
};
export const isProd = env.NODE_ENV === 'production';

/**
 * Бюджет практического задания: рекомендацию модели не опускаем ниже потолка языка.
 * Модель не знает, что в потолок сессии входит и повторно отправляемая история диалога,
 * и советует 2–3 тыс. токенов — с таким бюджетом сессия обрывается на 1–2 ходу.
 */
export function practicalTokenBudget(recommended: number, language: string): number {
  return Math.max(recommended, tokenCeilingFor(language));
}

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
