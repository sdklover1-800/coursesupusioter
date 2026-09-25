/**
 * Единый перечень доменных перечислений (enums).
 * Значения совпадают с enum'ами Prisma (apps/backend/prisma/schema.prisma) —
 * это контракт между backend и frontend.
 */

/** Роли пользователей (§3.1) */
export const Role = {
  STUDENT: 'STUDENT',
  COURSE_MANAGER: 'COURSE_MANAGER',
  ADMIN: 'ADMIN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/**
 * Поддерживаемые языки (§6.1).
 * Список конфигурируемый — не «зашит» за пределами этого единого перечня.
 * Добавление нового языка: расширить массив + добавить ресурсный файл (§6.4).
 */
export const LANGUAGES = ['kk', 'ru', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  kk: 'Қазақша',
  ru: 'Русский',
  en: 'English',
};

/** Статусы курса / языковой версии (FR-2.5) */
export const PublishStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type PublishStatus = (typeof PublishStatus)[keyof typeof PublishStatus];

/** Тип итогового оценивания модуля (FR-2.2) */
export const AssessmentType = {
  QUIZ: 'QUIZ',
  PRACTICAL: 'PRACTICAL',
} as const;
export type AssessmentType = (typeof AssessmentType)[keyof typeof AssessmentType];

/** Типы вопросов теста (FR-5.1). Архитектурно расширяемо (MULTI_CHOICE/OPEN — позже). */
export const QuestionType = {
  SINGLE_CHOICE: 'SINGLE_CHOICE',
  TRUE_FALSE: 'TRUE_FALSE',
} as const;
export type QuestionType = (typeof QuestionType)[keyof typeof QuestionType];

/** Вид теста (§4.5 + мини-квизы): итоговый модуля / после лекции / итоговый курса. */
export const QuizKind = {
  MODULE_FINAL: 'MODULE_FINAL',
  LECTURE_MINI: 'LECTURE_MINI',
  COURSE_FINAL: 'COURSE_FINAL',
} as const;
export type QuizKind = (typeof QuizKind)[keyof typeof QuizKind];

/** Уровни сложности (FR-6.2, §5.3) */
export const Difficulty = {
  VERY_EASY: 'VERY_EASY',
  EASY: 'EASY',
  MEDIUM: 'MEDIUM',
  HARD: 'HARD',
} as const;
export type Difficulty = (typeof Difficulty)[keyof typeof Difficulty];

/**
 * Статус записи на курс (§10.1 Enrollment).
 * PENDING/REJECTED — самостоятельная заявка студента из каталога, ожидающая
 * решения менеджера/админа или отклонённая. Прямая запись менеджером — ACTIVE.
 */
export const EnrollmentStatus = {
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  WITHDRAWN: 'WITHDRAWN',
  PENDING: 'PENDING',
  REJECTED: 'REJECTED',
} as const;
export type EnrollmentStatus = (typeof EnrollmentStatus)[keyof typeof EnrollmentStatus];

/**
 * Статусы, дающие доступ к учебному контенту (лекции, тесты, практическое,
 * сертификат) и учитываемые в дашбордах/исследовательской статистике.
 */
export const ADMITTED_ENROLLMENT_STATUSES = [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] as const;

/** Статус сократической сессии (§5.4, §5.7) */
export const SessionStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  ABANDONED: 'ABANDONED',
} as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

/** Режим оркестрации диалога (§5.4) */
export const OrchestrationMode = {
  /** Двухвызовный «тьютор + судья» — по умолчанию (валидность важнее экономии) */
  TUTOR_JUDGE: 'TUTOR_JUDGE',
  /** Однокальный — опция оптимизации стоимости, только по результатам пилота */
  SINGLE_CALL: 'SINGLE_CALL',
} as const;
export type OrchestrationMode = (typeof OrchestrationMode)[keyof typeof OrchestrationMode];

/** Роль автора реплики в чате (§10.1 ChatMessage) */
export const ChatRole = {
  AI: 'AI',
  STUDENT: 'STUDENT',
  SYSTEM: 'SYSTEM',
} as const;
export type ChatRole = (typeof ChatRole)[keyof typeof ChatRole];

/** Тип фоновой задачи генерации (§10.1 GenerationJob) */
export const GenerationType = {
  QUIZ: 'QUIZ',
  PRACTICAL: 'PRACTICAL',
  /** Мини-квизы: после каждой лекции + итоговый по курсу (тренировочные) */
  MINI: 'MINI',
  ALL: 'ALL',
  /** Краткое содержание лекций (Lecture.summary) */
  LECTURE_SUMMARY: 'LECTURE_SUMMARY',
} as const;
export type GenerationType = (typeof GenerationType)[keyof typeof GenerationType];

/** Статус фоновой задачи генерации (FR-7.1) */
export const JobStatus = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  DONE: 'DONE',
  ERROR: 'ERROR',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

/** Стратегия повторной генерации (FR-7.5) — не затирать правки без выбора */
export const RegenStrategy = {
  OVERWRITE: 'OVERWRITE',
  APPEND: 'APPEND',
  KEEP: 'KEEP',
} as const;
export type RegenStrategy = (typeof RegenStrategy)[keyof typeof RegenStrategy];

/** Вид промпт-шаблона (§10.1 PromptTemplate, воспроизводимость FR-R.7) */
export const PromptKind = {
  QUIZ_GEN: 'QUIZ_GEN',
  PRACTICAL_GEN: 'PRACTICAL_GEN',
  SOCRATIC_TUTOR: 'SOCRATIC_TUTOR',
  JUDGE: 'JUDGE',
} as const;
export type PromptKind = (typeof PromptKind)[keyof typeof PromptKind];

/** Условие эксперимента для когорты (§10.1 Cohort) — список расширяем */
export const CohortCondition = {
  AI_ASSISTED: 'AI_ASSISTED',
  WITH_TEACHER: 'WITH_TEACHER',
  CONTROL: 'CONTROL',
} as const;
export type CohortCondition = (typeof CohortCondition)[keyof typeof CohortCondition];

/**
 * Что студент видит после попытки оцениваемого теста (USER_DECISIONS §1):
 *  - FULL_AFTER_FINAL (по умолчанию) — до сдачи или последней попытки только
 *    «верно/неверно» по каждому вопросу; после — полный ключ и объяснения;
 *  - SCORE_UNTIL_FINAL — до финала только балл, после — полный разбор;
 *  - SCORE_ONLY — ключ не показывается никогда.
 * Значения «полный разбор после каждой попытки» нет намеренно: он раскрыл бы ключ
 * для второй попытки.
 */
export const QuizReviewPolicy = {
  FULL_AFTER_FINAL: 'FULL_AFTER_FINAL',
  SCORE_UNTIL_FINAL: 'SCORE_UNTIL_FINAL',
  SCORE_ONLY: 'SCORE_ONLY',
} as const;
export type QuizReviewPolicy = (typeof QuizReviewPolicy)[keyof typeof QuizReviewPolicy];

/** Какая попытка идёт в зачёт: лучшая (по умолчанию, USER_DECISIONS §1) или первая. */
export const QuizScoringRule = {
  BEST: 'BEST',
  FIRST: 'FIRST',
} as const;
export type QuizScoringRule = (typeof QuizScoringRule)[keyof typeof QuizScoringRule];

/** Объект жалобы на контент (ContentIssue.targetType). */
export const ContentIssueTarget = {
  QUIZ_QUESTION: 'QUIZ_QUESTION',
  CHAT_MESSAGE: 'CHAT_MESSAGE',
  LECTURE: 'LECTURE',
  PRACTICAL_TASK: 'PRACTICAL_TASK',
} as const;
export type ContentIssueTarget = (typeof ContentIssueTarget)[keyof typeof ContentIssueTarget];

/** Состояние разбора жалобы. */
export const ContentIssueStatus = {
  OPEN: 'OPEN',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
} as const;
export type ContentIssueStatus = (typeof ContentIssueStatus)[keyof typeof ContentIssueStatus];

/**
 * Источник жалобы: студент или система (SYSTEM — отметки контент-скриптов:
 * экспертная проверка, вычитка носителем языка, проверка фактов).
 */
export const ContentIssueOrigin = {
  STUDENT: 'STUDENT',
  SYSTEM: 'SYSTEM',
} as const;
export type ContentIssueOrigin = (typeof ContentIssueOrigin)[keyof typeof ContentIssueOrigin];

/** Итог сессии практикума (PracticalSession.verdictCode). */
export const VerdictCode = {
  PASSED: 'PASSED',
  /** Исчерпан лимит реплик ИИ (FR-6.4) */
  FAILED_LIMIT: 'FAILED_LIMIT',
  /** Исчерпан токен-потолок сессии (§5.6) */
  FAILED_CEILING: 'FAILED_CEILING',
  /** Студент завершил сессию сам */
  ENDED_BY_STUDENT: 'ENDED_BY_STUDENT',
  /** Сессия брошена и закрыта по неактивности (§5.7) */
  ABANDONED: 'ABANDONED',
} as const;
export type VerdictCode = (typeof VerdictCode)[keyof typeof VerdictCode];

/**
 * Причина завершения сессии практикума (PracticalSession.endReason).
 * TECH_ISSUE — только входная причина от студента: сессия ставится на паузу,
 * как итоговая причина она НИКОГДА не сохраняется.
 */
export const SessionEndReason = {
  DONE: 'DONE',
  OTHER: 'OTHER',
  TECH_ISSUE: 'TECH_ISSUE',
  LIMIT: 'LIMIT',
  CEILING: 'CEILING',
  PASSED: 'PASSED',
  IDLE: 'IDLE',
  IDLE_AFTER_PAUSE: 'IDLE_AFTER_PAUSE',
} as const;
export type SessionEndReason = (typeof SessionEndReason)[keyof typeof SessionEndReason];
