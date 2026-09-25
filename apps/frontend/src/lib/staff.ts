/**
 * Клиент поверхностей сотрудника (менеджер курса / администратор): типы ответов
 * API редакторов, очереди жалоб и аналитики + хуки TanStack Query (FE5, §4.2–4.4,
 * FR-7.*, FR-10.*). Экспорты НЕ переименовываются: FE5b (админка) может их импортировать.
 *
 * Правила безопасности (FE5): все дорогие/необратимые действия страницы вызывают
 * только после ConfirmDialog (генерация, снятие с публикации, удаление/перегенерация
 * вопроса, пакетное закрытие экспертной проверки).
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { api, ApiError } from './api';

/* ── Общие константы и утилиты ─────────────────────────────── */

/** Порог «мало данных»: при n < 10 метрики показываются с пометкой (A16, screen_specs «Admin and analytics»). */
export const LOW_N = 10;
export const isLowN = (n: number | null | undefined): boolean => (n ?? 0) < LOW_N;

/** Римские номера модулей (I, II, …) — как в карте курса и матрице (BE2 ROMAN). */
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const romanNumeral = (orderIndex: number): string => ROMAN[orderIndex] ?? String(orderIndex + 1);

/** Буква варианта ответа: 0 → A. */
export const optionLetter = (i: number): string => String.fromCharCode(65 + i);

/** Секунды → «мм:сс» (или «ч:мм:сс») для полей ввода длительности/таймкода; null → ''. */
export function secondsToClock(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '';
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * «мм:сс» / «ч:мм:сс» / целое число минут → секунды. Пусто → null; неверный ввод → undefined
 * (поле показывает ошибку и не сохраняется).
 */
export function clockToSeconds(raw: string): number | null | undefined {
  const v = raw.trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v) * 60;
  const parts = v.split(':').map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return undefined;
  const nums = parts.map(Number);
  if (nums.slice(1).some((n) => n > 59)) return undefined;
  return nums.length === 3 ? nums[0]! * 3600 + nums[1]! * 60 + nums[2]! : nums[0]! * 60 + nums[1]!;
}

/** Таймкод источника вопроса: допустим пустой или «мм:сс»/«ч:мм:сс» (сервер: timecodeToSeconds). */
export const isValidTimecode = (raw: string): boolean => !raw.trim() || /^\d{1,3}:[0-5]\d(:[0-5]\d)?$/.test(raw.trim());

/**
 * Текст ошибки API на языке интерфейса: известные коды → manager.errors.<CODE>,
 * иначе сообщение сервера (4xx) или общее «Что-то пошло не так».
 */
export function apiErrorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    const known = t(`manager.errors.${err.code}`, { defaultValue: '' });
    if (known) return known;
    if (err.status < 500 && err.message) return err.message;
  }
  return t('errors.generic');
}

/** Скачивание CSV, собранного в браузере (Blob URL; BOM — чтобы Excel открыл UTF-8). */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── Курсы (BE1: GET /courses, GET /courses/:id) ───────────── */

export interface StaffCourseListItem {
  id: string;
  defaultLanguage: string;
  status: string;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  languageVersions: { id: string; language: string; title: string; status: string }[];
  createdBy: { name: string } | null;
}

export interface StaffLecture {
  id: string;
  moduleId: string;
  orderIndex: number;
  title: string;
  youtubeVideoId: string | null;
  transcriptText: string;
  durationSec: number | null;
  summary: string | null;
  /** «Здоровье» лекции (BE1): мини-квиз, длина расшифровки, видео, краткое содержание */
  miniQuizId: string | null;
  miniQuestionCount: number;
  transcriptChars: number;
  hasVideo: boolean;
  hasSummary: boolean;
}

export interface StaffQuizLite {
  id: string;
  kind: string;
  isGraded: boolean;
  title: string;
  passThreshold: number;
  maxAttempts: number;
  reviewPolicy: string;
  scoringRule: string;
  cooldownMinutes: number | null;
  questions: { id: string }[];
}

export interface StaffPracticalLite {
  id: string;
  title: string;
  difficulty: string;
  canonicalRef: string | null;
  isAIGenerated: boolean;
  isEdited: boolean;
  maxSessions: number;
  maxAiMessages: number;
}

export interface StaffModule {
  id: string;
  orderIndex: number;
  title: string;
  assessmentType: string;
  coversWholeCourse: boolean;
  lectures: StaffLecture[];
  quiz: StaffQuizLite | null;
  practicalTask: StaffPracticalLite | null;
}

export interface StaffVersion {
  id: string;
  courseId: string;
  language: string;
  title: string;
  description: string | null;
  status: string;
  publishedAt: string | null;
  modules: StaffModule[];
  finalMiniQuizId: string | null;
  /** Блокеры публикации (FR-2.9) */
  problems: string[];
  /** Не блокирующие предупреждения */
  warnings: string[];
  /** Открытые SYSTEM-отметки экспертной проверки */
  openReviewIssues: number;
}

export interface StaffCourse {
  id: string;
  defaultLanguage: string;
  status: string;
  createdById: string | null;
  languageVersions: StaffVersion[];
}

export interface StaffEnrollment {
  id: string;
  userId: string;
  courseId: string;
  languageVersionId: string;
  status: string;
  progressPercent: number;
  user: { id: string; name: string; email: string; cohortId: string | null };
  languageVersion: { language: string; title: string };
}

export const staffKeys = {
  courses: ['courses'] as const,
  course: (id: string) => ['course', id] as const,
  enrollments: (courseId: string) => ['enrollments', courseId] as const,
  preview: (versionId: string) => ['preview', versionId] as const,
  job: (jobId: string) => ['genjob', jobId] as const,
  quizEdit: (quizId: string, archived: boolean) => ['quiz-edit', quizId, archived ? 'archived' : 'active'] as const,
  quizItems: (quizId: string) => ['quiz-items', quizId] as const,
  practical: (taskId: string) => ['ptask', taskId] as const,
  issues: ['content-issues'] as const,
  dashCourse: (courseId: string) => ['dash-course', courseId] as const,
  dashStudents: (courseId: string) => ['dash-students', courseId] as const,
  matrix: (courseId: string, versionId: string, cohortId: string) => ['dash-matrix', courseId, versionId, cohortId] as const,
};

/** Модули и лекции версии по порядку (сервер отдаёт без гарантии порядка). */
export function sortedModules(version: StaffVersion): StaffModule[] {
  return [...version.modules]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((m) => ({ ...m, lectures: [...m.lectures].sort((a, b) => a.orderIndex - b.orderIndex) }));
}

/** Сквозной номер лекции в версии (Л1…ЛN) — единая нумерация (FE5 §1). */
export function lectureNumbers(version: StaffVersion): Map<string, number> {
  const out = new Map<string, number>();
  let n = 0;
  for (const m of sortedModules(version)) for (const l of m.lectures) out.set(l.id, ++n);
  return out;
}

/** Где в курсе находится тест: модуль (тест модуля), лекция (мини-квиз) или версия (итоговый мини-квиз). */
export interface QuizPlace {
  course: StaffCourse;
  version: StaffVersion;
  module: StaffModule | null;
  lecture: StaffLecture | null;
  lectureNumber: number | null;
  kind: 'MODULE' | 'LECTURE' | 'FINAL';
}

export function findQuizPlace(course: StaffCourse | undefined, quizId: string): QuizPlace | null {
  if (!course) return null;
  for (const version of course.languageVersions) {
    if (version.finalMiniQuizId === quizId) return { course, version, module: null, lecture: null, lectureNumber: null, kind: 'FINAL' };
    const numbers = lectureNumbers(version);
    for (const m of version.modules) {
      if (m.quiz?.id === quizId) return { course, version, module: m, lecture: null, lectureNumber: null, kind: 'MODULE' };
      const l = m.lectures.find((x) => x.miniQuizId === quizId);
      if (l) return { course, version, module: m, lecture: l, lectureNumber: numbers.get(l.id) ?? null, kind: 'LECTURE' };
    }
  }
  return null;
}

/** Где в курсе находится практическое задание. */
export function findPracticalPlace(course: StaffCourse | undefined, taskId: string): { course: StaffCourse; version: StaffVersion; module: StaffModule } | null {
  if (!course) return null;
  for (const version of course.languageVersions) {
    const m = version.modules.find((x) => x.practicalTask?.id === taskId);
    if (m) return { course, version, module: m };
  }
  return null;
}

export function useManagedCourses(enabled = true) {
  return useQuery({
    queryKey: staffKeys.courses,
    queryFn: () => api.get<{ items: StaffCourseListItem[] }>('/courses'),
    enabled,
  });
}

/** Полный курс для редактора (с расшифровками — тяжёлый ответ, кэш общий с редакторами тестов/практикума). */
export function useCourseDetail(id: string | undefined | null) {
  return useQuery({
    queryKey: staffKeys.course(id ?? ''),
    queryFn: () => api.get<{ course: StaffCourse }>(`/courses/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  });
}

/** Записи на курс (все статусы, включая заявки) — счётчики карточек и подтверждение снятия с публикации. */
export function useCourseEnrollments(courseId: string | undefined | null, enabled = true) {
  return useQuery({
    queryKey: staffKeys.enrollments(courseId ?? ''),
    queryFn: () => api.get<{ items: StaffEnrollment[] }>(`/enrollments?courseId=${encodeURIComponent(courseId!)}`),
    enabled: !!courseId && enabled,
    staleTime: 60_000,
  });
}

/** Допущенные к курсу (ACTIVE/COMPLETED) — всего и по языковой версии. */
export function admittedCount(items: StaffEnrollment[] | undefined, versionId?: string): number {
  return (items ?? []).filter((e) => (e.status === 'ACTIVE' || e.status === 'COMPLETED') && (!versionId || e.languageVersionId === versionId)).length;
}

/* ── Мутации редактора курса ──────────────────────────────── */

function useInvalidateCourse(courseId: string | undefined) {
  const qc = useQueryClient();
  return () => {
    if (courseId) void qc.invalidateQueries({ queryKey: staffKeys.course(courseId) });
    void qc.invalidateQueries({ queryKey: staffKeys.courses });
  };
}

export interface LecturePatch {
  title?: string;
  youtubeUrl?: string;
  transcriptText?: string;
  durationSec?: number | null;
  summary?: string | null;
}

export function useUpdateLecture(courseId: string | undefined) {
  const invalidate = useInvalidateCourse(courseId);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: LecturePatch }) => api.patch<{ lecture: unknown }>(`/lectures/${id}`, patch),
    onSuccess: invalidate,
  });
}

export function useRenameModule(courseId: string | undefined) {
  const invalidate = useInvalidateCourse(courseId);
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api.patch<{ module: unknown }>(`/modules/${id}`, { title }),
    onSuccess: invalidate,
  });
}

export function useAddLecture(courseId: string | undefined) {
  const invalidate = useInvalidateCourse(courseId);
  return useMutation({
    mutationFn: ({ moduleId, title }: { moduleId: string; title?: string }) =>
      api.post<{ lecture: { id: string } }>(`/modules/${moduleId}/lectures`, title ? { title } : {}),
    onSuccess: invalidate,
  });
}

export function useDeleteLecture(courseId: string | undefined) {
  const invalidate = useInvalidateCourse(courseId);
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/lectures/${id}`),
    onSuccess: invalidate,
  });
}

export type GenerationKind = 'ALL' | 'QUIZ' | 'MINI' | 'PRACTICAL' | 'LECTURE_SUMMARY';
export type GenerationStrategy = 'KEEP' | 'OVERWRITE' | 'APPEND';

/** POST /language-versions/:id/generate — ТОЛЬКО после ConfirmDialog (платный ИИ-вызов). */
export function useGenerate() {
  return useMutation({
    mutationFn: ({ versionId, type, regenStrategy, moduleIds }: { versionId: string; type: GenerationKind; regenStrategy: GenerationStrategy; moduleIds?: string[] }) =>
      api.post<{ jobId: string; status: string }>(`/language-versions/${versionId}/generate`, {
        type,
        regenStrategy,
        ...(moduleIds?.length ? { moduleIds } : {}),
      }),
  });
}

export interface GenerationJob {
  id: string;
  status: string;
  type: string;
  result: unknown;
  error: string | null;
}

/** Опрос фоновой задачи генерации (FR-7.1): каждые 2 с, пока QUEUED/RUNNING. */
export function useGenerationJob(jobId: string | null) {
  return useQuery({
    queryKey: staffKeys.job(jobId ?? ''),
    queryFn: () => api.get<{ job: GenerationJob }>(`/generation-jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const s = q.state.data?.job.status;
      return s === 'QUEUED' || s === 'RUNNING' ? 2000 : false;
    },
  });
}

export function usePublishVersion(courseId: string | undefined) {
  const invalidate = useInvalidateCourse(courseId);
  return useMutation({
    mutationFn: (versionId: string) => api.post<{ version: unknown; warnings: string[] }>(`/language-versions/${versionId}/publish`),
    onSuccess: invalidate,
  });
}

/** Снятие с публикации — только после ConfirmDialog с числом записанных студентов. */
export function useUnpublishVersion(courseId: string | undefined) {
  const invalidate = useInvalidateCourse(courseId);
  return useMutation({
    mutationFn: (versionId: string) => api.post<{ version: unknown }>(`/language-versions/${versionId}/unpublish`),
    onSuccess: invalidate,
  });
}

export interface VersionPreview {
  version: {
    id: string;
    title: string;
    language: string;
    modules: {
      id: string;
      title: string;
      orderIndex: number;
      assessmentType: string;
      lectures: { id: string; title: string; youtubeVideoId: string; orderIndex: number }[];
      quiz: { id: string; title: string; questions: { id: string }[] } | null;
      practicalTask: { id: string; title: string; scenarioPrompt: string; difficulty: string; maxAiMessages: number } | null;
    }[];
  };
  warnings: string[];
}

export function useVersionPreview(versionId: string | null) {
  return useQuery({
    queryKey: staffKeys.preview(versionId ?? ''),
    queryFn: () => api.get<VersionPreview>(`/language-versions/${versionId}/preview`),
    enabled: !!versionId,
  });
}

/* ── Редактор теста (BE2: /quizzes/:id/edit) ──────────────── */

export interface EditQuestion {
  id: string;
  quizId: string;
  type: string;
  prompt: string;
  options: string[];
  correctOptionIds: number[];
  explanation: string | null;
  difficulty: string;
  orderIndex: number;
  isAIGenerated: boolean;
  isEdited: boolean;
  optionRationales: (string | null)[] | null;
  sourceLectureId: string | null;
  sourceTimecode: string | null;
  canonicalKey: string | null;
  archivedAt: string | null;
  /** Вопрос показан/отвечен в попытке — варианты, ключ и тип не меняются (409 QUIZ_FROZEN) */
  frozen: boolean;
  /** Открытые жалобы студентов */
  openIssueCount: number;
  /** Открытая SYSTEM-отметка экспертной проверки */
  reviewPending: boolean;
}

export interface QuizEdit {
  id: string;
  kind: string;
  isGraded: boolean;
  moduleId: string | null;
  lectureId: string | null;
  courseLanguageVersionId: string | null;
  title: string;
  passThreshold: number;
  maxAttempts: number;
  reviewPolicy: string;
  scoringRule: string;
  /** Сырое значение: null — по умолчанию (env), 0 — без паузы */
  cooldownMinutes: number | null;
  effectiveCooldownMinutes: number;
  frozen: boolean;
  attemptCount: number;
  lectures: { id: string; title: string; lectureNumber: number }[];
  questions: EditQuestion[];
}

export function useQuizEdit(quizId: string | undefined, includeArchived = false) {
  return useQuery({
    queryKey: staffKeys.quizEdit(quizId ?? '', includeArchived),
    queryFn: () => api.get<{ quiz: QuizEdit }>(`/quizzes/${quizId}/edit${includeArchived ? '?includeArchived=1' : ''}`),
    enabled: !!quizId,
    // Переключение «Показать архив» — без мигания скелетона: пока грузится, показываем прежние данные того же теста
    placeholderData: (prev) => (prev?.quiz.id === quizId ? prev : undefined),
  });
}

export interface QuizSettingsPatch {
  title?: string;
  passThreshold?: number;
  maxAttempts?: number;
  reviewPolicy?: string;
  scoringRule?: string;
  cooldownMinutes?: number | null;
}

export interface QuestionPatch {
  type?: string;
  prompt?: string;
  options?: string[];
  correctOptionIds?: number[];
  explanation?: string | null;
  difficulty?: string;
  optionRationales?: (string | null)[] | null;
  sourceLectureId?: string | null;
  sourceTimecode?: string | null;
}

function useInvalidateQuiz(quizId: string | undefined) {
  const qc = useQueryClient();
  return () => {
    if (!quizId) return;
    void qc.invalidateQueries({ queryKey: ['quiz-edit', quizId] });
    void qc.invalidateQueries({ queryKey: staffKeys.quizItems(quizId) });
  };
}

export function useQuizSettings(quizId: string | undefined) {
  return useMutation({
    mutationFn: (patch: QuizSettingsPatch) => api.patch<{ quiz: unknown }>(`/quizzes/${quizId}`, patch),
  });
}

export function useQuestionPatch() {
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: QuestionPatch }) => api.patch<{ question: unknown }>(`/quiz-questions/${id}`, patch),
  });
}

export function useAddQuestion(quizId: string | undefined) {
  const invalidate = useInvalidateQuiz(quizId);
  return useMutation({
    mutationFn: (q: { type: string; prompt: string; options: string[]; correctOptionIds: number[]; difficulty: string }) =>
      api.post<{ question: { id: string } }>(`/quizzes/${quizId}/questions`, q),
    onSuccess: invalidate,
  });
}

/** Удаление вопроса — только после ConfirmDialog. */
export function useDeleteQuestion(quizId: string | undefined) {
  const invalidate = useInvalidateQuiz(quizId);
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/quiz-questions/${id}`),
    onSuccess: invalidate,
  });
}

/** Перегенерация вопроса (платный ИИ-вызов) — только после ConfirmDialog. */
export function useRegenerateQuestion(quizId: string | undefined) {
  const invalidate = useInvalidateQuiz(quizId);
  return useMutation({
    mutationFn: (id: string) => api.post<{ question: unknown }>(`/quiz-questions/${id}/regenerate`),
    onSuccess: invalidate,
  });
}

/* ── Анализ заданий (BE2: /dashboards/quizzes/:id/items) ──── */

export interface ItemStatRow {
  questionId: string;
  canonicalKey: string | null;
  prompt: string;
  /** Сколько отправленных попыток показали вопрос */
  n: number;
  /** Доля верных (пропуск = неверно); null при n = 0 */
  pValue: number | null;
  /** Выборы по каноническим id вариантов */
  optionCounts: number[];
  unansweredCount: number;
  archived: boolean;
  openIssues: number;
  reviewPending: boolean;
}

export interface QuizItemsResponse {
  quizId: string;
  title: string;
  language: string;
  attempts: number;
  /** Студенты с отправленной попыткой */
  n: number;
  items: ItemStatRow[];
}

/** Анализ заданий; 403 (дашборд доступен только автору курса) → null без ошибки. */
export function useQuizItems(quizId: string | undefined | null, enabled = true) {
  return useQuery({
    queryKey: staffKeys.quizItems(quizId ?? ''),
    queryFn: async () => {
      try {
        return await api.get<QuizItemsResponse>(`/dashboards/quizzes/${quizId}/items`);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return null;
        throw e;
      }
    },
    enabled: !!quizId && enabled,
    retry: false,
  });
}

/* ── Практическое задание (BE3: /practical-tasks/:id) ─────── */

export interface PracticalRubricSpec {
  key_points: string[];
  answer_reached_criteria: string;
}

export interface PracticalTaskEdit {
  id: string;
  moduleId: string;
  title: string;
  scenarioPrompt: string;
  referenceSolution: string;
  rubricSpec: PracticalRubricSpec | null;
  difficulty: string;
  tokenBudget: number;
  maxAiMessages: number;
  maxSessions: number;
  agenda: string[] | null;
  estimatedMinutes: number | null;
  introMessage: string | null;
  /** Канонический межъязыковой сценарий (polisia-v1): перегенерация заблокирована */
  canonicalRef: string | null;
  isAIGenerated: boolean;
  isEdited: boolean;
  /** Сессий студентов по заданию */
  sessionCount?: number;
  updatedAt?: string;
}

export interface PracticalPatch {
  title?: string;
  scenarioPrompt?: string;
  referenceSolution?: string;
  rubricSpec?: PracticalRubricSpec;
  difficulty?: string;
  tokenBudget?: number;
  maxAiMessages?: number;
  maxSessions?: number;
  agenda?: string[];
  estimatedMinutes?: number | null;
  introMessage?: string | null;
}

export function usePracticalTask(taskId: string | undefined) {
  return useQuery({
    queryKey: staffKeys.practical(taskId ?? ''),
    queryFn: () => api.get<{ task: PracticalTaskEdit }>(`/practical-tasks/${taskId}`),
    enabled: !!taskId,
  });
}

export function usePracticalPatch(taskId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: PracticalPatch) => api.patch<{ task: PracticalTaskEdit }>(`/practical-tasks/${taskId}`, patch),
    onSuccess: () => {
      if (taskId) void qc.invalidateQueries({ queryKey: staffKeys.practical(taskId) });
    },
  });
}

/** Перегенерация задания (платный ИИ-вызов; у канонического — 409 CANONICAL_LOCKED) — только после ConfirmDialog. */
export function usePracticalRegenerate(taskId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ task: PracticalTaskEdit }>(`/practical-tasks/${taskId}/regenerate`),
    onSuccess: () => {
      if (taskId) void qc.invalidateQueries({ queryKey: staffKeys.practical(taskId) });
    },
  });
}

/* ── Жалобы на контент (BE2: /content-issues) ─────────────── */

export type IssueStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';
export type IssueTarget = 'QUIZ_QUESTION' | 'CHAT_MESSAGE' | 'LECTURE' | 'PRACTICAL_TASK';
export type IssueOrigin = 'STUDENT' | 'SYSTEM';

export type IssuePreview =
  | { kind: 'QUIZ_QUESTION'; prompt: string; options: string[]; correctOptionIds: number[]; quizId: string; quizTitle: string; canonicalKey: string | null; archived: boolean }
  | { kind: 'CHAT_MESSAGE'; excerpt: string; sessionId: string; role: string }
  | { kind: 'LECTURE'; title: string; lectureNumber: number | null }
  | { kind: 'PRACTICAL_TASK'; title: string }
  | null;

export interface IssueGroup {
  key: string;
  targetType: IssueTarget;
  targetId: string;
  status: IssueStatus;
  origin: IssueOrigin | 'MIXED';
  reporterCount: number;
  issueCount: number;
  latestAt: string;
  reasons: { reason: string; count: number }[];
  contexts: string[];
  comments: { text: string; reason: string; origin: IssueOrigin; createdAt: string }[];
  issueIds: string[];
  openIssueIds: string[];
  courseId: string | null;
  languageVersionId: string | null;
  language: string | null;
  preview: IssuePreview;
}

export interface IssueFilters {
  status: IssueStatus | 'ALL';
  origin?: IssueOrigin;
  courseId?: string;
  language?: string;
  targetType?: IssueTarget;
}

function issuesQs(f: IssueFilters, cursor?: string | null, limit = 20): string {
  const qs = new URLSearchParams({ status: f.status, limit: String(limit) });
  if (f.origin) qs.set('origin', f.origin);
  if (f.courseId) qs.set('courseId', f.courseId);
  if (f.language) qs.set('language', f.language);
  if (f.targetType) qs.set('targetType', f.targetType);
  if (cursor) qs.set('cursor', cursor);
  return qs.toString();
}

/** Очередь жалоб, сгруппированная по объекту; курсорная пагинация «Показать ещё». */
export function useIssues(filters: IssueFilters) {
  return useInfiniteQuery({
    queryKey: [...staffKeys.issues, 'list', filters] as const,
    queryFn: ({ pageParam }) => api.get<{ items: IssueGroup[]; nextCursor: string | null }>(`/content-issues?${issuesQs(filters, pageParam)}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/**
 * Открытые SYSTEM-отметки экспертной проверки по вопросам: targetId → id отметок.
 * Нужны редактору теста для «Проверено экспертом» (в /edit есть только флаг reviewPending).
 */
export function useReviewIssueMap(enabled: boolean, courseId?: string | null) {
  return useQuery({
    queryKey: [...staffKeys.issues, 'review-map', courseId ?? 'all'] as const,
    queryFn: async () => {
      const map: Record<string, string[]> = {};
      let cursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        const res: { items: IssueGroup[]; nextCursor: string | null } = await api.get(
          `/content-issues?${issuesQs({ status: 'OPEN', origin: 'SYSTEM', targetType: 'QUIZ_QUESTION', courseId: courseId ?? undefined }, cursor, 100)}`,
        );
        for (const g of res.items) map[g.targetId] = [...(map[g.targetId] ?? []), ...g.openIssueIds];
        cursor = res.nextCursor;
        if (!cursor) break;
      }
      return map;
    },
    enabled,
  });
}

export function useIssueSummary(courseId?: string | null) {
  return useQuery({
    queryKey: [...staffKeys.issues, 'summary', courseId ?? ''] as const,
    queryFn: () => api.get<{ open: number; openSystem: number }>(`/content-issues/summary${courseId ? `?courseId=${encodeURIComponent(courseId)}` : ''}`),
  });
}

/** Смена статуса отдельных жалоб (PATCH по одной; аудит CONTENT_ISSUE_STATUS_CHANGED на каждую). */
export function useSetIssueStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, status, note }: { ids: string[]; status: IssueStatus; note?: string }) => {
      for (const id of ids) await api.patch(`/content-issues/${id}`, { status, ...(note?.trim() ? { note: note.trim() } : {}) });
      return { updated: ids.length };
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: staffKeys.issues });
      void qc.invalidateQueries({ queryKey: ['quiz-edit'] });
    },
  });
}

/** Пакетное закрытие (партии экспертной проверки) — только после ConfirmDialog. */
export function useBulkIssueStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, status, note }: { ids: string[]; status: IssueStatus; note?: string }) =>
      api.post<{ updated: number }>('/content-issues/bulk-status', { ids, status, ...(note?.trim() ? { note: note.trim() } : {}) }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: staffKeys.issues });
      void qc.invalidateQueries({ queryKey: ['quiz-edit'] });
    },
  });
}

/* ── Аналитика (BE2: /dashboards/*) ───────────────────────── */

export interface DashCourse {
  course: { id: string; status: string };
  enrollment: { total: number; n: number; completed: number; completionRate: number; avgProgress: number };
  quizzes: {
    attempts: number;
    avgScore: number;
    n: number;
    byQuiz: { quizId: string; title: string; language: string; moduleOrderIndex: number; n: number; avgCountedScore: number | null; passRate: number | null; attempts: number }[];
    hardQuestions: { questionId: string; prompt: string; errorRate: number; attempts: number }[];
  };
  practical: {
    total: number;
    passed: number;
    failed: number;
    abandoned: number;
    n: number;
    studentsPassed: number;
    studentsFailed: number;
    studentsInProgress: number;
    passRate: number;
    avgTokens: number;
    avgMessages: number;
    totalTokens: number;
    estCostUsd: number;
    rubric: { avg_methodicalness: number; avg_question_quality: number; avg_logical_progression: number; avg_self_correction: number };
    rubricN: number;
  };
}

export interface DashStudent {
  studentId: string;
  enrollmentId: string;
  name: string;
  cohortId: string | null;
  language: string;
  progressPercent: number;
  status: string;
  avgQuizScore: number | null;
  quizAttempts: number;
  practicalPassed: number;
  practicalOutcome: { outcome: string; verdict: string | null; sessionsUsed: number } | null;
  durationDays: number | null;
}

export type MatrixCellState = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'PASSED' | 'FAILED';
export interface MatrixColumn {
  key: string;
  kind: 'LECTURE' | 'MODULE_QUIZ' | 'PRACTICAL';
  moduleOrderIndex: number;
  label: string;
  title: string;
}
export interface MatrixRow {
  studentId: string;
  enrollmentId: string;
  name: string;
  cohort: { id: string; name: string; condition: string } | null;
  cells: { state: MatrixCellState; score?: number }[];
}
export interface MatrixResponse {
  languageVersionId: string;
  versions: { id: string; language: string; title: string }[];
  columns: MatrixColumn[];
  rows: MatrixRow[];
  averages: { key: string; value: number | null; n: number }[];
  n: number;
}

export function useDashCourse(courseId: string | null) {
  return useQuery({
    queryKey: staffKeys.dashCourse(courseId ?? ''),
    queryFn: () => api.get<DashCourse>(`/dashboards/courses/${courseId}`),
    enabled: !!courseId,
  });
}

export function useDashStudents(courseId: string | null) {
  return useQuery({
    queryKey: staffKeys.dashStudents(courseId ?? ''),
    queryFn: () => api.get<{ students: DashStudent[]; n: number }>(`/dashboards/courses/${courseId}/students`),
    enabled: !!courseId,
  });
}

export function useCourseMatrix(courseId: string | null, versionId: string, cohortId: string) {
  return useQuery({
    queryKey: staffKeys.matrix(courseId ?? '', versionId, cohortId),
    queryFn: () => {
      const qs = new URLSearchParams();
      if (versionId) qs.set('languageVersionId', versionId);
      if (cohortId) qs.set('cohortId', cohortId);
      const s = qs.toString();
      return api.get<MatrixResponse>(`/dashboards/courses/${courseId}/matrix${s ? `?${s}` : ''}`);
    },
    enabled: !!courseId,
  });
}
