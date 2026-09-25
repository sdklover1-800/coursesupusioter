import { z } from 'zod';
import { isLocalUrl, resolvePublicAppUrl } from './publicUrl.js';

/**
 * Булев флаг окружения. z.coerce.boolean() превращает строку 'false' в true,
 * поэтому новые флаги принимают только 'true' | 'false'.
 */
const bool = (d: boolean) =>
  z
    .enum(['true', 'false'])
    .default(d ? 'true' : 'false')
    .transform((v) => v === 'true');

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
  // Цена токенов для оценки стоимости (§5.6h), USD за 1M токенов. Дефолты — прайс
  // gpt-5.4-mini (модель пилота); кешированный вход тарифицируется отдельно.
  LLM_PRICE_INPUT_PER_MTOK: z.coerce.number().default(0.75),
  LLM_PRICE_OUTPUT_PER_MTOK: z.coerce.number().default(4.5),
  LLM_PRICE_CACHED_INPUT_PER_MTOK: z.coerce.number().default(0.075),

  // ── Диалог практикума: тьютор, судья, проверка утечки ответа ──
  // Температура тьютора (при reasoning none модель её допускает)
  DIALOG_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.25),
  // Лимит выходных токенов реплики тьютора (ru/en) и для kk — казахский длиннее в токенах
  TUTOR_MAX_TOKENS: z.coerce.number().int().positive().default(200),
  TUTOR_MAX_TOKENS_KK: z.coerce.number().int().positive().default(250),
  // Предел длины реплики тьютора на казахском, символов (A22)
  TUTOR_MESSAGE_MAX_CHARS_KK: z.coerce.number().int().positive().default(700),
  // Лимит выходных токенов судьи (A4)
  JUDGE_MAX_TOKENS: z.coerce.number().int().positive().default(600),
  // Подтверждение вердикта «ответ достигнут» повторным вызовом судьи
  JUDGE_CONFIRM_ENABLED: bool(true),
  // Уровень рассуждений подтверждающего вызова судьи
  JUDGE_CONFIRM_EFFORT: z.enum(['low', 'medium', 'high']).default('medium'),
  // Проверка реплики тьютора на раскрытие ответа до отправки студенту (A21)
  LEAK_CHECK_ENABLED: bool(true),
  // Таймаут проверки утечки, мс
  LEAK_CHECK_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  // Поведение при сбое/таймауте проверки: closed — реплика не уходит (безопасно), open — уходит (A21)
  LEAK_CHECK_FAIL_MODE: z.enum(['closed', 'open']).default('closed'),

  // ── Оцениваемые тесты и курс ──
  // Пауза между попытками теста по умолчанию, мин (USER_DECISIONS §1: 24 ч); Quiz.cooldownMinutes важнее
  QUIZ_COOLDOWN_MINUTES: z.coerce.number().int().min(0).default(1440),
  // Незавершённая попытка старше N часов отправляется автоматически (A15)
  QUIZ_ATTEMPT_MAX_HOURS: z.coerce.number().positive().default(24),
  // Блокировка языка курса: после первой оцениваемой активности или никогда (USER_DECISIONS §3)
  LANGUAGE_LOCK: z.enum(['after_first_graded', 'never']).default('after_first_graded'),
  // Условие сертификата: сдать все оценивания или только пройти всё (A30, открытый вопрос PI)
  CERT_RULE: z.enum(['PASS_ALL', 'COMPLETE_ALL']).default('PASS_ALL'),
  // Запрет смены исследовательских групп после старта сбора данных (A27)
  STUDY_COHORTS_LOCKED: bool(false),
  // Публичный адрес фронтенда — для ссылок и QR проверки сертификата.
  // Пусто — первый адрес из FRONTEND_ORIGIN; в проде локальный адрес недопустим (см. ниже).
  PUBLIC_APP_URL: z.string().default(''),
  // Организация-эмитент в сертификате и на странице проверки
  CERT_ISSUER_NAME: z.string().default('EduOpen'),

  RESEARCH_CONSENT_VERSION: z.string().default('2026-07-01'),

  DEFAULT_MAX_AI_MESSAGES: z.coerce.number().default(22),
  // Токен-потолок сессии практикума по языку (§5.6): в него входит и повторно
  // отправляемая история диалога, поэтому он на порядок выше бюджета одной реплики
  TOKEN_CEILING_EN: z.coerce.number().default(120000),
  TOKEN_CEILING_RU: z.coerce.number().default(160000),
  TOKEN_CEILING_KK: z.coerce.number().default(190000),
  MAX_STUDENT_MESSAGE_CHARS: z.coerce.number().default(1500),
  SESSION_IDLE_PAUSE_MINUTES: z.coerce.number().default(60),
  SESSION_ABANDON_DAYS: z.coerce.number().default(7),

  RATE_LIMIT_LOGIN_MAX: z.coerce.number().default(10),
  RATE_LIMIT_LLM_MAX: z.coerce.number().default(30),
  // Самостоятельная регистрация: попыток в час с одного IP (защита от массовых аккаунтов)
  RATE_LIMIT_REGISTER_MAX: z.coerce.number().int().positive().default(5),
  // Публичный каталог (без входа): запросов в минуту с одного IP
  RATE_LIMIT_PUBLIC_MAX: z.coerce.number().int().positive().default(120),

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

const publicAppUrl = resolvePublicAppUrl(parsed.data.PUBLIC_APP_URL, parsed.data.FRONTEND_ORIGIN);
if (parsed.data.NODE_ENV === 'production' && isLocalUrl(publicAppUrl)) {
  // Иначе все сертификаты уйдут с QR и ссылкой проверки на локальную машину.
  // eslint-disable-next-line no-console
  console.error(`❌ PUBLIC_APP_URL (или FRONTEND_ORIGIN) в проде указывает на локальный адрес: «${publicAppUrl}». Задайте публичный адрес сайта, например PUBLIC_APP_URL=https://eduopen.kz`);
  process.exit(1);
}

const provider = resolveProvider(parsed.data);
const defaultModel = DEFAULT_MODELS[provider];

export const env = {
  ...parsed.data,
  PUBLIC_APP_URL: publicAppUrl,
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
