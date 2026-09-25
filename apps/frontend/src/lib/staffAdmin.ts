import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import type { Language, PublicUser, Role } from '@edu/shared';
import { api } from './api';
import { formatDate } from './format';

/**
 * API-хуки раздела администратора (FE5b: пользователи, когорты, экспорт, аудит, обзор).
 * Ключи кеша: список пользователей — под корнем ['users'] (его инвалидирует и одобрение
 * заявок в lib/catalog), остальное — под ['admin', …]. Менеджерские хуки — в lib/staff.ts (FE5a).
 */

/* ── Типы ответов API ─────────────────────────────────────────────── */

/** Строка GET /admin/users (BE1: + согласие, активность, саморегистрация). */
export interface AdminUser extends PublicUser {
  isActive: boolean;
  /** Самостоятельная регистрация (email не подтверждён) */
  selfRegisteredAt: string | null;
  /** max(Enrollment.lastActivityAt) — последняя учебная активность */
  lastActivityAt: string | null;
}
export interface PageMeta {
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}
export interface UsersResponse {
  items: AdminUser[];
  meta: PageMeta;
}

/** Статус согласия на участие в исследовании (текущая версия текста — GET /admin/consent-info). */
export type ConsentState = 'given' | 'outdated' | 'missing';

export interface UsersFilter {
  q: string;
  role: '' | Role;
  cohortId: string;
  consent: '' | ConsentState;
  page: number;
}

export interface AdminCohort {
  id: string;
  name: string;
  condition: string;
  description: string | null;
  createdAt: string;
  _count: { users: number; teacherSessions: number };
}
export interface TeacherSession {
  id: string;
  date: string;
  topic: string;
  cohort: { name: string };
}

export interface CreateUserInput {
  email: string;
  name: string;
  role: Role;
  interfaceLanguage: Language;
  cohortId: string | null;
}
export interface UserPatch {
  role?: Role;
  cohortId?: string | null;
  interfaceLanguage?: Language;
  resetPassword?: boolean;
  /** Смена группы при STUDY_COHORTS_LOCKED — только с явным подтверждением */
  force?: boolean;
}

/* Импорт (FR-1.3, Приложение A) */
export interface ImportRowResult {
  rowNumber: number;
  email: string;
  name: string;
  status: 'ok' | 'error' | string;
  errors: string[];
  startPassword?: string;
}
export interface ImportReport {
  total: number;
  valid: number;
  invalid: number;
  results: ImportRowResult[];
}
export interface ImportResponse {
  applied: boolean;
  report: ImportReport;
}
/** Столбцы файла импорта — в порядке шаблона. */
export const IMPORT_COLUMNS = ['email', 'name', 'interface_language', 'cohort'] as const;

/* Аудит (NFR-2.9) */
export interface AuditEntry {
  id: string;
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: unknown;
  createdAt: string;
  actor: { name: string; email: string; role: Role };
}
export interface AuditFilter {
  action: string;
  actorId: string;
  targetType: string;
  from: string;
  to: string;
}
export interface AuditPageResponse {
  items: AuditEntry[];
  nextCursor: string | null;
}

/** Коды действий аудита, известные бэкенду (подписи — admin.actions.*). */
export const AUDIT_ACTIONS = [
  'USER_CREATED', 'USER_UPDATED', 'USER_COHORT_CHANGED', 'USERS_IMPORTED', 'USER_SELF_REGISTERED',
  'COHORT_CREATED', 'COHORT_UPDATED',
  'ENROLLMENT_REQUESTED', 'ENROLLMENT_APPROVED', 'ENROLLMENT_REJECTED', 'ENROLLMENT_REQUEST_CANCELLED', 'STUDENT_ENROLLED',
  'COURSE_CREATED', 'COURSE_PUBLISHED', 'COURSE_UNPUBLISHED', 'COURSE_ARCHIVED',
  'MODULE_UPDATED', 'LECTURE_CREATED', 'LECTURE_UPDATED', 'LECTURE_DELETED',
  'QUIZ_SETTINGS_UPDATED', 'QUIZ_QUESTION_CREATED', 'QUIZ_QUESTION_UPDATED', 'QUIZ_QUESTION_DELETED', 'QUIZ_QUESTION_REGENERATED',
  'PRACTICAL_TASK_UPDATED', 'PRACTICAL_TASK_REGENERATED', 'PRACTICAL_SESSION_EXCUSED',
  'CONTENT_ISSUE_STATUS_CHANGED', 'CONTENT_ISSUE_BULK_STATUS',
  'DATA_EXPORTED',
] as const;
/** Типы объектов аудита (подписи — admin.targets.*). */
export const AUDIT_TARGETS = [
  'User', 'Cohort', 'Enrollment', 'Course', 'CourseLanguageVersion', 'Module', 'Lecture',
  'Quiz', 'QuizQuestion', 'PracticalTask', 'PracticalSession', 'ContentIssue',
] as const;

/* Экспорт (FR-R.4) */
export const EXPORT_TYPES = ['events', 'sessions', 'rubric', 'quiz_attempts', 'item_responses', 'lecture_progress', 'cohort_summary'] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];
/** Имена файлов — как в Content-Disposition бэкенда (export.service filenameFor). */
export const EXPORT_FILENAMES: Record<ExportType, string> = {
  events: 'events.csv',
  sessions: 'practical_sessions.csv',
  rubric: 'rubric_assessments.csv',
  quiz_attempts: 'quiz_attempts.csv',
  item_responses: 'item_responses.csv',
  lecture_progress: 'lecture_progress.csv',
  cohort_summary: 'cohort_summary.csv',
};
export interface ExportFilter {
  courseId: string;
  cohortId: string;
  from: string;
  to: string;
}

/* Обзор и сравнение когорт (FR-10.5, FR-10.6) */
export interface RubricAverages {
  avg_methodicalness: number;
  avg_question_quality: number;
  avg_logical_progression: number;
  avg_self_correction: number;
}
export interface PracticalSummary {
  total: number;
  passed: number;
  failed: number;
  abandoned: number;
  /** Записи с хотя бы одной сессией практикума */
  n: number;
  studentsPassed: number;
  studentsFailed: number;
  studentsInProgress: number;
  /** Доля сдавших по записи (0..1) */
  passRate: number;
  avgTokens: number;
  avgMessages: number;
  totalTokens?: number;
  estCostUsd?: number;
  rubric: RubricAverages;
  /** Сессий с оценкой рубрики */
  rubricN?: number;
}
export interface AdminOverview {
  users: number;
  /** Студенты с допущенной записью (участники) */
  students: number;
  /** Все учётные записи студентов */
  registeredStudents?: number;
  courses: number;
  publishedVersions: number;
  enrollments: number;
  completedEnrollments: number;
  pendingRequests?: number;
  certificates: number;
  n?: number;
  practical: PracticalSummary;
}
export interface CohortCompareRow {
  cohortId: string;
  name: string;
  condition: string;
  /** Все студенты когорты */
  students: number;
  /** Студенты когорты с допущенной записью — база показателей */
  n?: number;
  enrollments: number;
  completionRate: number;
  teacherSessions: number;
  practical: PracticalSummary;
}

/** Порог «мало данных» (screen_specs: ниже n = 10 показатели не интерпретируются). */
export const LOW_N = 10;

/* ── Вспомогательные ─────────────────────────────────────────────── */

/** '?a=1&b=2' без пустых значений. */
export function buildQuery(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== '' && v !== null && v !== undefined) sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Статус согласия пользователя относительно текущей версии текста. */
export function consentState(u: Pick<PublicUser, 'researchConsentAt' | 'researchConsentVersion'>, currentVersion: string | undefined): ConsentState {
  if (!u.researchConsentAt) return 'missing';
  if (currentVersion && u.researchConsentVersion !== currentVersion) return 'outdated';
  return 'given';
}

/**
 * Относительное время («3 дня назад») на ключах admin.time.* — Intl.RelativeTimeFormat
 * в ICU Chrome не знает казахский; старше 30 дней — дата через formatDate.
 */
export function relativeTime(t: TFunction, iso: string | null | undefined, lng: string, now = Date.now()): string {
  if (!iso) return t('admin.time.never');
  const d = new Date(iso);
  const diff = Math.max(0, now - d.getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t('admin.time.justNow');
  if (min < 60) return t('admin.time.minutesAgo', { count: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('admin.time.hoursAgo', { count: h });
  const days = Math.floor(h / 24);
  if (days === 1) return t('admin.time.yesterday');
  if (days <= 30) return t('admin.time.daysAgo', { count: days });
  return formatDate(d, lng);
}

/**
 * Скачивание текста, собранного на клиенте (шаблон импорта, стартовые пароли):
 * Blob URL + временная ссылка. BOM — чтобы Excel открыл UTF-8 кириллицу/казахский.
 */
export function downloadText(text: string, filename: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob(['﻿' + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Экранирование значения CSV. */
export function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* ── Ключи кеша ───────────────────────────────────────────────────── */
export const adminKeys = {
  users: (f: Partial<UsersFilter> & { pageSize?: number }) => ['users', 'admin', f] as const,
  usersRoot: ['users'] as const,
  staff: ['users', 'admin-staff'] as const,
  cohorts: ['admin', 'cohorts'] as const,
  teacherSessions: (cohortId: string) => ['admin', 'teacher-sessions', cohortId] as const,
  consentInfo: ['admin', 'consent-info'] as const,
  audit: (f: AuditFilter) => ['admin', 'audit', f] as const,
  overview: ['admin', 'overview'] as const,
  cohortCompare: ['admin', 'cohort-compare'] as const,
  courses: ['admin', 'course-options'] as const,
};

/* ── Пользователи ─────────────────────────────────────────────────── */

export function useAdminUsers(f: UsersFilter, pageSize = 20) {
  return useQuery({
    queryKey: adminKeys.users({ ...f, pageSize }),
    queryFn: () =>
      api.get<UsersResponse>(
        `/admin/users${buildQuery({ page: f.page, pageSize, q: f.q.trim(), role: f.role, cohortId: f.cohortId, consent: f.consent })}`,
      ),
    placeholderData: keepPreviousData,
  });
}

/** Состав когорты (до 100 — лимит пагинации API). */
export function useCohortMembers(cohortId: string | null) {
  return useQuery({
    queryKey: adminKeys.users({ cohortId: cohortId ?? '', pageSize: 100 }),
    queryFn: () => api.get<UsersResponse>(`/admin/users${buildQuery({ cohortId, pageSize: 100 })}`),
    enabled: !!cohortId,
  });
}

/** Сотрудники (админы и менеджеры) — для фильтра «Кто» в аудите. */
export function useStaffUsers() {
  return useQuery({
    queryKey: adminKeys.staff,
    queryFn: async () => {
      const [admins, managers] = await Promise.all([
        api.get<UsersResponse>('/admin/users?role=ADMIN&pageSize=100'),
        api.get<UsersResponse>('/admin/users?role=COURSE_MANAGER&pageSize=100'),
      ]);
      return [...admins.items, ...managers.items];
    },
    staleTime: 5 * 60_000,
  });
}

/** Текущая версия текста согласия (для статуса «устарело»). */
export function useConsentVersion() {
  return useQuery({
    queryKey: adminKeys.consentInfo,
    queryFn: () => api.get<{ version: string }>('/admin/consent-info'),
    staleTime: 30 * 60_000,
  });
}

function useInvalidateUsers() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: adminKeys.usersRoot });
    // Смена группы меняет счётчики когорт и сравнение когорт
    void qc.invalidateQueries({ queryKey: ['admin'] });
  };
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (input: CreateUserInput) => api.post<{ user: PublicUser; startPassword: string }>('/admin/users', input),
    onSuccess: invalidate,
  });
}

export function useUpdateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UserPatch }) =>
      api.patch<{ user: PublicUser; startPassword?: string }>(`/admin/users/${id}`, patch),
    onSuccess: invalidate,
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (id: string) => api.patch<{ user: PublicUser; startPassword: string }>(`/admin/users/${id}`, { resetPassword: true }),
  });
}

/** Импорт CSV/Excel: apply=false — предпросмотр (ничего не создаёт), true — создание. */
export function useImportUsers() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ file, apply }: { file: File; apply: boolean }) => {
      const fd = new FormData();
      fd.append('file', file);
      if (apply) fd.append('apply', 'true');
      return api.postForm<ImportResponse>('/admin/users/import', fd);
    },
    onSuccess: (r) => {
      if (r.applied) invalidate();
    },
  });
}

/* ── Когорты ──────────────────────────────────────────────────────── */

export function useAdminCohorts() {
  return useQuery({
    queryKey: adminKeys.cohorts,
    queryFn: () => api.get<{ items: AdminCohort[] }>('/admin/cohorts'),
  });
}

function useInvalidateCohorts() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['admin'] });
    // Список когорт для одобрения заявок (lib/catalog useCohortsLite)
    void qc.invalidateQueries({ queryKey: ['cohorts-lite'] });
  };
}

export function useCreateCohort() {
  const invalidate = useInvalidateCohorts();
  return useMutation({
    mutationFn: (input: { name: string; condition: string; description: string }) => api.post<{ cohort: AdminCohort }>('/admin/cohorts', input),
    onSuccess: invalidate,
  });
}

export function useUpdateCohort() {
  const invalidate = useInvalidateCohorts();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; condition?: string; description?: string } }) =>
      api.patch<{ cohort: AdminCohort }>(`/admin/cohorts/${id}`, patch),
    onSuccess: invalidate,
  });
}

export function useTeacherSessions(cohortId: string | null) {
  return useQuery({
    queryKey: adminKeys.teacherSessions(cohortId ?? ''),
    queryFn: () => api.get<{ items: TeacherSession[] }>(`/admin/teacher-sessions${buildQuery({ cohortId })}`),
    enabled: !!cohortId,
  });
}

export function useLogTeacherSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { cohortId: string; topic: string; date: string }) =>
      api.post('/admin/teacher-sessions', { cohortId: input.cohortId, topic: input.topic, date: new Date(input.date).toISOString() }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin'] }),
  });
}

/* ── Аудит ────────────────────────────────────────────────────────── */

export function useAuditLog(f: AuditFilter, limit = 50) {
  return useInfiniteQuery({
    queryKey: adminKeys.audit(f),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<AuditPageResponse>(
        `/admin/audit${buildQuery({ limit, cursor: pageParam, action: f.action, actorId: f.actorId, targetType: f.targetType, from: f.from, to: f.to })}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

/* ── Обзор ────────────────────────────────────────────────────────── */

export function useAdminOverview() {
  return useQuery({ queryKey: adminKeys.overview, queryFn: () => api.get<AdminOverview>('/dashboards/overview') });
}

export function useCohortCompare() {
  return useQuery({ queryKey: adminKeys.cohortCompare, queryFn: () => api.get<{ cohorts: CohortCompareRow[] }>('/dashboards/cohorts') });
}

/* ── Курсы (фильтр экспорта) ──────────────────────────────────────── */
interface CourseListItem {
  id: string;
  languageVersions: { id: string; language: string; title: string; status: string }[];
}
export interface CourseOption {
  id: string;
  /** Название по языку интерфейса (иначе — первой версии) */
  titles: Record<string, string>;
  fallback: string;
}

export function useCourseOptions() {
  return useQuery({
    queryKey: adminKeys.courses,
    queryFn: async (): Promise<CourseOption[]> => {
      const r = await api.get<{ items: CourseListItem[] }>('/courses');
      return r.items.map((c) => ({
        id: c.id,
        titles: Object.fromEntries(c.languageVersions.map((v) => [v.language, v.title])),
        fallback: c.languageVersions[0]?.title ?? c.id,
      }));
    },
    staleTime: 5 * 60_000,
  });
}

export const courseTitle = (c: CourseOption, lng: string) => c.titles[lng] ?? c.titles.ru ?? c.fallback;

/** Скачать CSV выгрузки с фильтрами (курс, когорта, период). */
export function downloadExport(type: ExportType, f: ExportFilter): Promise<void> {
  return api.download(
    `/admin/export${buildQuery({ type, courseId: f.courseId, cohortId: f.cohortId, from: f.from, to: f.to })}`,
    EXPORT_FILENAMES[type],
  );
}
