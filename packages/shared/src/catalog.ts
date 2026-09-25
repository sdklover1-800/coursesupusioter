import type { AssessmentType, EnrollmentStatus } from './enums.js';

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
}

export interface CatalogModule {
  id: string;
  orderIndex: number;
  title: string;
  assessmentType: AssessmentType;
  lectures: CatalogLecture[];
}

export interface CatalogVersionDetail {
  id: string;
  language: string;
  title: string;
  description: string | null;
  modules: CatalogModule[];
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
  languageVersion: { id: string; title: string; description: string | null; language: string };
  certificate: { id: string; serialNumber: string } | null;
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
  languageVersion: { id: string; language: string; title: string };
}

/** Ответ пакетного одобрения: skipped — заявки, которые не одобрены из-за когорты/деактивации. */
export interface BulkApproveResult {
  approved: number;
  skipped: Array<{ id: string; reason: string }>;
}

/** Коды ошибок API, на которые клиент реагирует особым экраном. */
export const ApiErrorCode = {
  /** Не принято информированное согласие (FR-R.6) */
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  /** Заявка на курс не одобрена (PENDING/REJECTED/WITHDRAWN); details: { status, courseId } */
  ENROLLMENT_NOT_APPROVED: 'ENROLLMENT_NOT_APPROVED',
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];
