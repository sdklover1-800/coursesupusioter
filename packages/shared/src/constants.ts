import type { Language } from './enums.js';

/** Значения по умолчанию для структуры курса (§2, FR-2.1) */
export const DEFAULT_COURSE_STRUCTURE = {
  modules: 3,
  lecturesPerModule: 5,
} as const;

/** Пороги/лимиты по умолчанию (конфигурируемо, §5.6, FR-6.4, FR-6.10) */
export const DEFAULTS = {
  quizPassThreshold: 0.7,
  quizMaxAttempts: 2,
  maxAiMessages: 22,
  maxStudentMessageChars: 1500,
  sessionIdlePauseMinutes: 60,
  sessionAbandonDays: 7,
} as const;

/**
 * Токен-потолки по языкам (§5.6). Кириллица токенизируется в ~1.5–3× «дороже».
 * ВНИМАНИЕ: это консервативные значения по умолчанию. Финальная таблица —
 * обязательный выход пилота LLM (§5.1).
 */
export const TOKEN_CEILING_BY_LANGUAGE: Record<Language, number> = {
  en: 9000,
  ru: 18000,
  kk: 24000,
};

/** Пороги детекции сигналов целостности (FR-6.11) */
export const INTEGRITY_THRESHOLDS = {
  /** символов/сек, выше которого длинная вставка считается подозрительно быстрой */
  fastPasteCharsPerSecond: 60,
  /** минимальная длина текста для проверки «быстрой вставки» */
  longPasteMinChars: 300,
  /** доля от max длины, начиная с которой сообщение помечается NEAR_MAX_LENGTH */
  nearMaxLengthRatio: 0.95,
} as const;

/** Ограничение длины реплики ассистента (FR-6.6 — краткость) */
export const TUTOR_MESSAGE_MAX_CHARS = 600;

/**
 * Заглушка вместо реального YouTube-ID (FR-4.3): ровно 11 символов, поэтому
 * проходит валидацию формата и не блокирует публикацию, пока заказчик не
 * предоставил ссылки. UI показывает плашку «видео будет добавлено» вместо плеера.
 */
export const PLACEHOLDER_VIDEO_ID = 'PLACEHOLDER';

/** Макс. длина сообщения студента (FR-6.10) — дублируется в env на сервере. */
export const MAX_STUDENT_MESSAGE_CHARS = 1500;

/** Пагинация по умолчанию */
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;
