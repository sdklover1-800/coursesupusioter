import type { AssessmentType, EnrollmentStatus, PublishStatus } from './enums.js';
import type { MyCourseSummary } from './learn.js';

/**
 * Контракты публичного каталога курсов и заявок на запись (API ↔ frontend).
 * Каталог публичный: здесь НЕТ видео, расшифровок, тестов и скрытых частей
 * практического задания — только то, что можно показать анониму.
 * Даты приходят строками ISO (JSON).
 */

/** Языковая версия в карточке каталога (GET /catalog). */
export interface CatalogVersionSummary {
  id: string;
  language: string;
  title: string;
  description: string | null;
  moduleCount: number;
  lectureCount: number;
  /** В курсе есть итоговое практическое задание с ИИ-тьютором */
  hasPractical: boolean;
  /** Суммарная длительность видео, сек (null — длительности лекций не заданы) */
  durationSec?: number | null;
  /** Сколько оцениваемых тестов модулей в версии */
  moduleQuizCount?: number;
  /** По завершении выдаётся сертификат */
  hasCertificate?: boolean;
}

/** Курс в каталоге: только опубликованные версии; первая — базовый язык курса. */
export interface CatalogCourseSummary {
  id: string;
  versions: CatalogVersionSummary[];
}

export interface CatalogLecture {
  id: string;
  orderIndex: number;
  title: string;
  /** Длительность видео, сек */
  durationSec?: number | null;
  /** После лекции есть тренировочный мини-квиз */
  hasMiniQuiz?: boolean;
}

export interface CatalogModule {
  id: string;
  orderIndex: number;
  title: string;
  assessmentType: AssessmentType;
  lectures: CatalogLecture[];
  /** Число вопросов оцениваемого теста модуля (null — теста нет) */
  quizQuestionCount?: number | null;
  /** Модуль завершается практическим заданием с ИИ-тьютором */
  hasPractical?: boolean;
}

export interface CatalogVersionDetail {
  id: string;
  language: string;
  title: string;
  description: string | null;
  modules: CatalogModule[];
  /** Суммарная длительность видео, сек */
  durationSec?: number | null;
  /** В версии есть итоговый мини-квиз по курсу (тренировочный) */
  hasFinalMiniQuiz?: boolean;
}

/** Страница курса в каталоге (GET /catalog/:courseId) — программа без контента. */
export interface CatalogCourseDetail {
  id: string;
  versions: CatalogVersionDetail[];
}

/** Запись студента на курс, включая заявки (GET /me/courses, POST /catalog/:id/requests). */
export interface StudentEnrollment {
  id: string;
  courseId: string;
  languageVersionId: string;
  status: EnrollmentStatus;
  progressPercent: number;
  startedAt: string;
  completedAt: string | null;
  requestedAt: string | null;
  reviewedAt: string | null;
  /** Комментарий менеджера/админа при отклонении */
  reviewNote: string | null;
  /** status — статус публикации версии (снятую с публикации UI помечает) */
  languageVersion: { id: string; title: string; description: string | null; language: string; status?: PublishStatus };
  certificate: { id: string; serialNumber: string } | null;
  /** Сводка прогресса для карточки «Мои курсы» (только ACTIVE/COMPLETED) */
  summary?: MyCourseSummary | null;
}

/** Строка очереди заявок (GET /enrollment-requests, менеджер/админ). */
export interface EnrollmentRequestItem {
  id: string;
  status: EnrollmentStatus;
  requestedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  /**
   * selfRegisteredAt — аккаунт создан самостоятельной регистрацией (владение email
   * не проверялось); null — создан админом/импортом.
   */
  user: { id: string; name: string; email: string; cohortId: string | null; selfRegisteredAt: string | null };
  courseId: string;
  /** status — статус публикации версии: заявку на ARCHIVED-версию можно только отклонить */
  languageVersion: { id: string; language: string; title: string; status?: PublishStatus };
}

/** Ответ пакетного одобрения: skipped — заявки, которые не одобрены из-за когорты/деактивации. */
export interface BulkApproveResult {
  approved: number;
  skipped: Array<{ id: string; reason: string }>;
}

/**
 * «Здоровье» языковой версии в редакторе курса: блокеры публикации и предупреждения
 * в виде код + параметры — клиент переводит их сам (ru/kk/en). Приходят рядом с
 * русскими строками: GET /courses/:id → languageVersions[].problemItems/warningItems,
 * POST /language-versions/:id/publish → warningItems (422 — details.problemItems/warningItems),
 * GET /language-versions/:id/preview → warningItems.
 */
export const CourseHealthCode = {
  /* ── Блокеры публикации ── */
  /** В версии нет модулей */
  NO_MODULES: 'NO_MODULES',
  /** params: module */
  MODULE_NO_LECTURES: 'MODULE_NO_LECTURES',
  /** params: lecture */
  LECTURE_NO_VIDEO: 'LECTURE_NO_VIDEO',
  /** params: lecture */
  LECTURE_NO_TRANSCRIPT: 'LECTURE_NO_TRANSCRIPT',
  /** В названии лекции склеенные служебные метаданные («Course:», «Format:»…); params: lecture */
  LECTURE_TITLE_METADATA: 'LECTURE_TITLE_METADATA',
  /** params: lecture, max */
  LECTURE_TITLE_TOO_LONG: 'LECTURE_TITLE_TOO_LONG',
  /** Модуль с оцениванием-тестом без вопросов; params: module */
  MODULE_NO_QUIZ: 'MODULE_NO_QUIZ',
  /** params: module */
  MODULE_NO_PRACTICAL: 'MODULE_NO_PRACTICAL',
  /* ── Предупреждения (не блокируют публикацию) ── */
  /** Разное число вопросов теста модуля в параллельных версиях; params: module, count, otherLanguage, otherCount */
  QUESTION_COUNT_MISMATCH: 'QUESTION_COUNT_MISMATCH',
  /** Русский служебный префикс в названии kk/en-версии; params: kind (CourseHealthTitleKind), title, prefix, language */
  RU_TITLE_PREFIX: 'RU_TITLE_PREFIX',
  /** У лекций не задана длительность видео; params: count, total */
  NO_VIDEO_DURATION: 'NO_VIDEO_DURATION',
  /** Вопросы ждут экспертной проверки; params: count. В редакторе — отдельным счётчиком openReviewIssues */
  REVIEW_PENDING: 'REVIEW_PENDING',
} as const;
export type CourseHealthCode = (typeof CourseHealthCode)[keyof typeof CourseHealthCode];

/** Что названо с русским префиксом (RU_TITLE_PREFIX.params.kind). */
export type CourseHealthTitleKind = 'MODULE_QUIZ' | 'PRACTICAL' | 'MINI_QUIZ' | 'FINAL_MINI_QUIZ';

/**
 * Пункт «здоровья» версии. Названия в params (module, lecture, title) — укороченные
 * (≤ 70 символов + «…»); language/otherLanguage — код языка в нижнем регистре.
 */
export interface CourseHealthItem {
  code: CourseHealthCode;
  params: Record<string, string | number>;
}

/** Коды ошибок API, на которые клиент реагирует особым экраном. */
export const ApiErrorCode = {
  /** Не принято информированное согласие (FR-R.6) */
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  /** Заявка на курс не одобрена (PENDING/REJECTED/WITHDRAWN); details: { status, courseId } */
  ENROLLMENT_NOT_APPROVED: 'ENROLLMENT_NOT_APPROVED',
  /** Язык курса заблокирован после первой оцениваемой активности (USER_DECISIONS §3) */
  LANGUAGE_LOCKED: 'LANGUAGE_LOCKED',
  /** Идёт пауза между попытками теста; details: { cooldownUntil } (USER_DECISIONS §1) */
  COOLDOWN: 'COOLDOWN',
  /** Попытки теста исчерпаны */
  ATTEMPTS_EXHAUSTED: 'ATTEMPTS_EXHAUSTED',
  /** Тест уже сдан — новая попытка не допускается */
  QUIZ_ALREADY_PASSED: 'QUIZ_ALREADY_PASSED',
  /** Попытка уже отправлена — изменить ответы нельзя */
  ATTEMPT_SUBMITTED: 'ATTEMPT_SUBMITTED',
  /** Ответы не соответствуют вопросам/вариантам попытки */
  INVALID_ANSWERS: 'INVALID_ANSWERS',
  /** Не подтверждены правила честной сдачи */
  INTEGRITY_ACK_REQUIRED: 'INTEGRITY_ACK_REQUIRED',
  /** Тренировка по оцениваемым вопросам закрыта до завершения теста (USER_DECISIONS §2) */
  PRACTICE_LOCKED: 'PRACTICE_LOCKED',
  /** Тест заморожен: по нему уже есть попытки — правка вопросов запрещена */
  QUIZ_FROZEN: 'QUIZ_FROZEN',
  /** Практикум уже сдан — новая сессия не допускается */
  ALREADY_PASSED: 'ALREADY_PASSED',
  /** Зачётные сессии практикума исчерпаны */
  NO_SESSIONS_LEFT: 'NO_SESSIONS_LEFT',
  /** Недоступно (окно практикума закрыто или ещё не открыто) */
  NOT_AVAILABLE: 'NOT_AVAILABLE',
  /** Канонический межъязыковой контент — перегенерация заблокирована */
  CANONICAL_LOCKED: 'CANONICAL_LOCKED',
  /** Версия опубликована — операция требует снятия с публикации */
  VERSION_PUBLISHED: 'VERSION_PUBLISHED',
  /** Языковая версия в архиве — заявку на неё можно только отклонить */
  VERSION_ARCHIVED: 'VERSION_ARCHIVED',
  /** Смена группы у пользователя с данными требует явного подтверждения */
  COHORT_CONFIRM_REQUIRED: 'COHORT_CONFIRM_REQUIRED',
  /** Состав исследовательских групп зафиксирован (STUDY_COHORTS_LOCKED) */
  COHORTS_LOCKED: 'COHORTS_LOCKED',
  /** Требуется сменить стартовый пароль (FR-1.7) */
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];
