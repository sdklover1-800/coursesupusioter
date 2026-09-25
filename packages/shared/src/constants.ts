import type { ContentIssueTarget, Language } from './enums.js';

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
 * Токен-потолки сессии практикума по языкам (§5.6). Кириллица токенизируется в
 * ~1.5–3× «дороже». В потолок входит и повторно отправляемая история диалога,
 * поэтому значения на порядок выше бюджета одной реплики. Совпадают с дефолтами
 * env TOKEN_CEILING_* (авторитетны на сервере); уточняются калибровкой пилота (§5.1).
 */
export const TOKEN_CEILING_BY_LANGUAGE: Record<Language, number> = {
  en: 120000,
  ru: 160000,
  kk: 190000,
};

/* ── Оцениваемые тесты (USER_DECISIONS §1, §5) ─────────────────────── */

/** Фиксированный бланк теста модуля: 8 вопросов × 4 варианта (USER_DECISIONS §5). */
export const MODULE_QUIZ_QUESTIONS = 8;
export const MODULE_QUIZ_OPTIONS = 4;

/** Итоговый мини-квиз курса: по одному вопросу на лекцию. */
export const COURSE_FINAL_QUESTIONS_PER_LECTURE = 1;

/**
 * Пауза между попытками теста, мин (24 ч, USER_DECISIONS §1). Только запасное
 * значение для отображения — авторитетна серверная env QUIZ_COOLDOWN_MINUTES.
 */
export const DEFAULT_QUIZ_COOLDOWN_MINUTES = 1440;

/* ── Практикум и лекции ────────────────────────────────────────────── */

/** Число зачётных сессий практикума по умолчанию (USER_DECISIONS §4). */
export const PRACTICAL_DEFAULT_MAX_SESSIONS = 2;

/** Предельная длина краткого содержания лекции (Lecture.summary), символов. */
export const LECTURE_SUMMARY_MAX_CHARS = 600;

/* ── Жалобы на контент ─────────────────────────────────────────────── */

/** Сколько жалоб студент может отправить за сутки (защита очереди от спама). */
export const CONTENT_ISSUE_DAILY_LIMIT = 30;

/** Допустимые причины жалобы студента — по типу объекта. */
export const CONTENT_ISSUE_REASONS = {
  QUIZ_QUESTION: ['NO_CORRECT', 'TWO_CORRECT', 'UNCLEAR', 'TRANSLATION', 'FACT_ERROR', 'OTHER'],
  CHAT_MESSAGE: ['FACT_ERROR', 'GIVES_ANSWER', 'OTHER'],
  LECTURE: ['TRANSCRIPT_ERROR', 'TRANSLATION', 'VIDEO', 'OTHER'],
  PRACTICAL_TASK: ['UNCLEAR', 'TRANSLATION', 'FACT_ERROR', 'OTHER'],
} as const satisfies Record<ContentIssueTarget, readonly string[]>;
export type ContentIssueReason = (typeof CONTENT_ISSUE_REASONS)[ContentIssueTarget][number];

/** Причины системных отметок (origin = SYSTEM) — ставят контент-скрипты. */
export const SYSTEM_REVIEW_REASONS = ['EXPERT_REVIEW', 'NATIVE_PROOFREAD', 'FACT_CHECK'] as const;
export type SystemReviewReason = (typeof SYSTEM_REVIEW_REASONS)[number];

/** Где возникла жалоба (ContentIssue.context). */
export const CONTENT_ISSUE_CONTEXTS = ['PRACTICE', 'REVIEW', 'OFFICIAL', 'PRACTICAL', 'LECTURE', 'CONTENT_PIPELINE'] as const;
export type ContentIssueContext = (typeof CONTENT_ISSUE_CONTEXTS)[number];

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

/**
 * Политика пароля (FR-1.7): одна для самостоятельной регистрации и смены пароля.
 * Верхняя граница защищает от DoS дорогим хешированием argon2 огромных строк.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Самостоятельная регистрация: длина ФИО (после trim). */
export const USER_NAME_MIN_LENGTH = 2;
export const USER_NAME_MAX_LENGTH = 100;

/** Заявки на курс: длина комментария при отклонении и размер пакетного одобрения. */
export const ENROLLMENT_REVIEW_NOTE_MAX = 500;
export const ENROLLMENT_BULK_APPROVE_MAX = 200;

/** Пагинация по умолчанию */
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;
