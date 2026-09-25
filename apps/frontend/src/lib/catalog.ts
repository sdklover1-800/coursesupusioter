/**
 * Публичный каталог курсов, заявки на запись и их модерация.
 * Типы ответов API описаны здесь (контракт enrollment-requests), хуки — TanStack Query.
 * Доступ к материалам курса — только при одобренной записи (ACTIVE/COMPLETED).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CatalogLecture as SharedCatalogLecture, CatalogModule as SharedCatalogModule, CatalogVersionDetail,
  CatalogVersionSummary as SharedCatalogVersionSummary, MyCourseSummary,
} from '@edu/shared';
import { api, ApiError } from './api';

/* ── Типы ──────────────────────────────────────────────── */
export type EnrollmentStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'REJECTED' | 'WITHDRAWN';
export type AssessmentType = 'QUIZ' | 'PRACTICAL';

/**
 * Карточка каталога и программа курса — типы контракта @edu/shared (catalog.ts):
 * необязательные поля BE1 (durationSec, moduleQuizCount, hasCertificate, quizQuestionCount,
 * hasMiniQuiz, hasPractical, hasFinalMiniQuiz) могут отсутствовать — UI скрывает такие ячейки.
 * Контента (видео, расшифровок, вопросов) в каталоге нет.
 */
export type CatalogVersionSummary = SharedCatalogVersionSummary;
export interface CatalogItem { id: string; versions: CatalogVersionSummary[] }
export type CatalogLecture = SharedCatalogLecture;
export type CatalogModule = SharedCatalogModule;
export type CatalogVersion = CatalogVersionDetail;
export interface CatalogCourse { id: string; versions: CatalogVersion[] }

/** Запись студента (GET /me/courses) — все статусы, включая заявки. */
export interface MyEnrollment {
  id: string;
  courseId: string;
  status: EnrollmentStatus;
  progressPercent: number;
  requestedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  /** status — статус публикации версии (снятую с публикации UI помечает «Временно недоступен») */
  languageVersion: { id: string; title: string; description: string | null; language: string; status?: string };
  certificate: { id: string; serialNumber: string } | null;
  /** Сводка прогресса для карточки «Мои курсы» (BE1; только ACTIVE/COMPLETED) */
  summary?: MyCourseSummary | null;
}

/** Заявка в очереди модерации (GET /enrollment-requests). */
export interface EnrollmentRequest {
  id: string;
  status: EnrollmentStatus;
  requestedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  /** selfRegisteredAt — аккаунт из самостоятельной регистрации (email не подтверждён) */
  user: { id: string; name: string; email: string; cohortId: string | null; selfRegisteredAt: string | null };
  courseId: string;
  languageVersion: { id: string; language: string; title: string };
}
/** Пакетное одобрение: skipped — не одобрены (когорту не сменить, аккаунт деактивирован). */
export interface BulkApproveResult { approved: number; skipped: { id: string; reason: string }[] }
export type RequestsFilter = 'PENDING' | 'REJECTED' | 'ALL';
export interface RequestsResponse { items: EnrollmentRequest[]; counts: { pending: number } }
export interface CohortLite { id: string; name: string; condition?: string }

/* ── Утилиты ───────────────────────────────────────────── */
/** Статусы с открытым доступом к материалам. */
export const isApproved = (s: EnrollmentStatus | string) => s === 'ACTIVE' || s === 'COMPLETED';

/**
 * Короткий код языка (запасной вариант, когда нет перевода): «KK», «RU», «EN».
 * В интерфейсе — родное письмо t('shell.langShort.<lng>') («Қаз · Рус · Eng»), никогда «KZ».
 */
export function langCode(lang: string): string {
  return lang.toUpperCase();
}

/** Версия на языке интерфейса, если опубликована, иначе — первая. */
export function pickVersion<T extends { language: string }>(versions: T[], lang: string): T | undefined {
  return versions.find((v) => v.language === lang) ?? versions[0];
}

/** Казахские названия месяцев: в ICU браузеров (Chrome) их нет — Intl даёт «2026 M09 25». */
const KK_MONTHS = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'];

/** Дата в языке интерфейса: «25 сент. 2026 г.» / «25 қыркүйек 2026 ж.» / «25 Sept 2026». */
export function formatDate(iso: string | null | undefined, lang: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  if (lang === 'kk') return `${d.getDate()} ${KK_MONTHS[d.getMonth()]} ${d.getFullYear()} ж.`;
  const locale = lang === 'en' ? 'en-GB' : 'ru-RU';
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

/**
 * Безопасный ?next: только относительный путь приложения
 * (защита от open redirect: «//evil», «/\evil», «https://…»).
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  return raw;
}

/** 403 ENROLLMENT_NOT_APPROVED — заявка не одобрена/отклонена/запись отменена. */
export function isNotApproved(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 403 && err.code === 'ENROLLMENT_NOT_APPROVED';
}

/** details ошибки ENROLLMENT_NOT_APPROVED: { status, courseId } (если сервер их прислал). */
export function notApprovedDetails(err: unknown): { status?: EnrollmentStatus; courseId?: string } {
  if (!isNotApproved(err) || !err.details || typeof err.details !== 'object') return {};
  const d = err.details as { status?: unknown; courseId?: unknown };
  return {
    status: typeof d.status === 'string' ? (d.status as EnrollmentStatus) : undefined,
    courseId: typeof d.courseId === 'string' ? d.courseId : undefined,
  };
}

/* ── Хуки: каталог (публичный) ─────────────────────────── */
export function useCatalog() {
  return useQuery({ queryKey: ['catalog'], queryFn: () => api.get<{ items: CatalogItem[] }>('/catalog') });
}

export function useCatalogCourse(courseId: string | undefined) {
  return useQuery({
    queryKey: ['catalog', courseId],
    queryFn: () => api.get<{ course: CatalogCourse }>(`/catalog/${courseId}`),
    enabled: !!courseId,
  });
}

/* ── Хуки: студент ─────────────────────────────────────── */
/** Ключ совпадает со StudentDashboard — общий кэш «Моих курсов». */
export function useMyCourses(enabled = true) {
  return useQuery({
    queryKey: ['me-courses'],
    queryFn: () => api.get<{ items: MyEnrollment[] }>('/me/courses'),
    enabled,
  });
}

export function useRequestEnrollment(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (languageVersionId: string) =>
      api.post<{ enrollment: MyEnrollment }>(`/catalog/${courseId}/requests`, { languageVersionId }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['me-courses'] }),
  });
}

export function useCancelRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enrollmentId: string) => api.del(`/me/requests/${enrollmentId}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['me-courses'] }),
  });
}

/* ── Хуки: менеджер/админ ──────────────────────────────── */
export function requestsKey(status: RequestsFilter, courseId = '') {
  return ['enrollment-requests', status, courseId] as const;
}

export function useEnrollmentRequests(status: RequestsFilter, courseId = '', opts: { enabled?: boolean; poll?: boolean } = {}) {
  return useQuery({
    queryKey: requestsKey(status, courseId),
    queryFn: () => {
      const qs = new URLSearchParams({ status });
      if (courseId) qs.set('courseId', courseId);
      return api.get<RequestsResponse>(`/enrollment-requests?${qs.toString()}`);
    },
    enabled: opts.enabled ?? true,
    refetchInterval: opts.poll ? 60_000 : false,
  });
}

/**
 * Счётчик ожидающих заявок для бейджа в навигации (обновление раз в 60 с).
 * limit=0 — только counts, без строк (сервер без этого параметра просто вернёт список).
 */
export function usePendingRequestsCount(enabled: boolean): number {
  const q = useQuery({
    queryKey: ['enrollment-requests', 'count'],
    queryFn: () => api.get<RequestsResponse>('/enrollment-requests?status=PENDING&limit=0'),
    enabled,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  return q.data?.counts.pending ?? 0;
}

/**
 * Список когорт для назначения при одобрении. Менеджеру — облегчённый
 * GET /cohorts; если его нет (или нет прав) — GET /admin/cohorts (ADMIN).
 */
export function useCohortsLite(enabled = true) {
  return useQuery({
    queryKey: ['cohorts-lite'],
    queryFn: async () => {
      try {
        return await api.get<{ items: CohortLite[] }>('/cohorts');
      } catch {
        return await api.get<{ items: CohortLite[] }>('/admin/cohorts');
      }
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

function useInvalidateRequests() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['enrollment-requests'] });
    // Одобрение с когортой меняет пользователя; запись влияет на счётчики дашбордов.
    void qc.invalidateQueries({ queryKey: ['users'] });
  };
}

export function useApproveRequest() {
  const invalidate = useInvalidateRequests();
  return useMutation({
    // confirmCohortAssign — повтор после 409 COHORT_CONFIRM_REQUIRED (смена группы у студента с данными)
    mutationFn: ({ id, cohortId, confirmCohortAssign }: { id: string; cohortId?: string; confirmCohortAssign?: boolean }) =>
      api.post<{ enrollment: unknown }>(`/enrollment-requests/${id}/approve`, {
        ...(cohortId ? { cohortId } : {}),
        ...(confirmCohortAssign ? { confirmCohortAssign: true } : {}),
      }),
    onSettled: invalidate,
  });
}

export function useRejectRequest() {
  const invalidate = useInvalidateRequests();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      api.post<{ enrollment: unknown }>(`/enrollment-requests/${id}/reject`, note ? { note } : {}),
    onSettled: invalidate,
  });
}

export function useBulkApprove() {
  const invalidate = useInvalidateRequests();
  return useMutation({
    mutationFn: ({ ids, cohortId, confirmCohortAssign }: { ids: string[]; cohortId?: string; confirmCohortAssign?: boolean }) =>
      api.post<BulkApproveResult>('/enrollment-requests/approve-bulk', {
        ids,
        ...(cohortId ? { cohortId } : {}),
        ...(confirmCohortAssign ? { confirmCohortAssign: true } : {}),
      }),
    onSettled: invalidate,
  });
}
