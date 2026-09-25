/**
 * Клиент учебного пути студента (FE1–FE4): типы контракта @edu/shared/learn, ключи
 * запросов, загрузка карты курса, инвалидация, построители маршрутов и плоская
 * последовательность элементов. Всё терпимо к СТАРОЙ форме ответа API (BE1 может выйти
 * позже): новые поля читаются через ?. и значения по умолчанию.
 */
import { useQuery, type QueryClient } from '@tanstack/react-query';
import type {
  ItemState, LearnItemKind, LearnLecture, LearnModule, LearnModuleQuiz, LearnPractical, LearnView, LectureNeighbor, NextItem,
} from '@edu/shared';
import { api } from './api';

export type {
  AttemptOption, AttemptQuestion, AttemptResult, AttemptStart, AttemptSummary, CertificateMissing, CertificateRule,
  CertificateStatus, ChatMessageView, ContentIssueInput, ItemState, LanguageLockReason, LanguageSwitchPreview,
  LearnItemKind, LearnLecture, LearnModule, LearnModuleQuiz, LearnPractical, LearnView, LectureNeighbor, LectureView,
  LockInfo, MyCourseSummary, NextItem, PracticalBrief, PracticalLectureRef, PracticalSessionSummary,
  PracticalSessionView, PracticalSessionsView, PracticeCheck, PracticeSet, PracticeSetItem, ProgressBreakdown,
  PublicQuestion, QuizLobby, ReviewItem, ReviewLevel, ReviewPolicy, ReviewSource, RubricCriterion, ScoringRule,
  SessionDetail, SessionEndInputReason, SessionEvaluation, TurnDone, VerifyResult,
} from '@edu/shared';
/** Чистые правила, общие с backend (порог зачёта, таймкоды). */
export { passCountFor, timecodeToSeconds } from '@edu/shared';

/* ── Ключи запросов (общий кэш страниц) ─────────────────────────────── */
export const learnKeys = {
  /** Карта курса (GET /courses/:id/learn) */
  learn: (courseId: string | undefined, enrollmentId: string | undefined) => ['learn', courseId, enrollmentId] as const,
  /** Лекция (GET /lectures/:id) */
  lecture: (lectureId: string | undefined, enrollmentId: string | undefined) => ['lecture', lectureId, enrollmentId] as const,
  /** Тест (лобби/данные) */
  quiz: (quizId: string | undefined, enrollmentId: string | undefined) => ['quiz', quizId, enrollmentId] as const,
  /** «Мои курсы» — ТОТ ЖЕ ключ, что у useMyCourses в lib/catalog.ts (второй хук не заводим) */
  myCourses: ['me-courses'] as const,
};

/** Карта курса студента. Ошибка 403 ENROLLMENT_NOT_APPROVED — в error (ContentError). */
export function useLearnView(courseId: string | undefined, enrollmentId: string | undefined) {
  return useQuery({
    queryKey: learnKeys.learn(courseId, enrollmentId),
    queryFn: () => api.get<LearnView>(`/courses/${courseId}/learn?enrollmentId=${enrollmentId}`),
    enabled: !!courseId && !!enrollmentId,
  });
}

/** После любого учебного действия (лекция пройдена, попытка отправлена, сессия завершена). */
export function invalidateLearning(qc: QueryClient): Promise<unknown> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['learn'] }),
    qc.invalidateQueries({ queryKey: ['lecture'] }),
    qc.invalidateQueries({ queryKey: learnKeys.myCourses }),
    qc.invalidateQueries({ queryKey: ['quiz'] }),
  ]);
}

/* ── Маршруты ───────────────────────────────────────────────────────── */
function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const routes = {
  home: () => '/',
  certificates: () => '/certificates',
  catalogCourse: (courseId: string) => `/catalog/${courseId}`,
  course: (courseId: string, enrollmentId: string, opts: { hash?: string } = {}) =>
    `/learn/${courseId}/${enrollmentId}${opts.hash ? `#${opts.hash}` : ''}`,
  /** t — старт видео с секунды (?t=); hash — якорь, например 'mini-quiz' */
  lecture: (courseId: string, enrollmentId: string, lectureId: string, opts: { t?: number; hash?: string } = {}) =>
    `/learn/${courseId}/${enrollmentId}/lecture/${lectureId}${qs({ t: opts.t !== undefined ? Math.max(0, Math.floor(opts.t)) : undefined })}${opts.hash ? `#${opts.hash}` : ''}`,
  /** mode='practice' — тренировка по модулю; attempt — открыть конкретную попытку (результат) */
  quiz: (courseId: string, enrollmentId: string, quizId: string, opts: { mode?: 'practice'; attempt?: string } = {}) =>
    `/learn/${courseId}/${enrollmentId}/quiz/${quizId}${qs({ mode: opts.mode, attempt: opts.attempt })}`,
  practical: (courseId: string, enrollmentId: string, taskId: string) => `/learn/${courseId}/${enrollmentId}/practical/${taskId}`,
};

/* ── Плоская последовательность ─────────────────────────────────────── */
/** Элемент плоского пути (для рельсов оглавления, «назад/далее», карты курса). */
export interface FlatItem {
  kind: LearnItemKind;
  id: string;
  title: string;
  moduleId: string | null;
  moduleOrderIndex: number | null;
  /** Сквозной номер лекции (у LECTURE/MINI_QUIZ) */
  lectureNumber?: number;
  /** Лекция, к которой относится мини-квиз */
  lectureId?: string;
  state: ItemState;
}

const byOrder = <T extends { orderIndex?: number }>(a: T, b: T) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0);

function lectureState(l: Partial<LearnLecture>): ItemState {
  if (l.completed) return 'DONE';
  if ((l.positionSec ?? 0) > 0 || (l.watchedPercent ?? 0) > 0) return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

function quizState(q: Partial<LearnModuleQuiz>): ItemState {
  if (q.passed) return 'PASSED';
  if (q.finalReached) return 'FAILED';
  if (q.inProgressAttemptId || (q.attemptsUsed ?? 0) > 0) return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

function practicalState(p: Partial<LearnPractical>): ItemState {
  if (p.status === 'PASSED') return 'PASSED';
  if (p.lock) return 'LOCKED';
  if (p.status === 'FAILED') return p.final ? 'FAILED' : 'IN_PROGRESS';
  if (p.status === 'IN_PROGRESS') return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

/**
 * Упорядоченный путь: лекция → её мини-квиз → … → тест модуля → практикум.
 * Мини-квизы включены для оглавления (includeMini=false — без них), но «далее» они НИКОГДА
 * не бывают (BE1: next не указывает на мини-квиз). includeFinal — итоговый мини-квиз и сертификат в конце.
 */
export function flattenSequence(
  view: Pick<LearnView, 'version'> & Partial<Pick<LearnView, 'certificate'>>,
  opts: { includeMini?: boolean; includeFinal?: boolean } = {},
): FlatItem[] {
  const includeMini = opts.includeMini ?? true;
  const out: FlatItem[] = [];
  const modules: Partial<LearnModule>[] = [...(view.version?.modules ?? [])].sort(byOrder);
  let running = 0;
  for (const m of modules) {
    const moduleId = m.id ?? null;
    const moduleOrderIndex = m.orderIndex ?? null;
    const lectures: Partial<LearnLecture>[] = [...(m.lectures ?? [])].sort(byOrder);
    for (const l of lectures) {
      running += 1;
      const lectureNumber = l.lectureNumber ?? running;
      out.push({ kind: 'LECTURE', id: l.id!, title: l.title ?? '', moduleId, moduleOrderIndex, lectureNumber, state: lectureState(l) });
      if (includeMini && l.miniQuizId) {
        out.push({
          kind: 'MINI_QUIZ', id: l.miniQuizId, title: l.title ?? '', moduleId, moduleOrderIndex, lectureNumber, lectureId: l.id, state: 'NOT_STARTED',
        });
      }
    }
    if (m.quiz) out.push({ kind: 'MODULE_QUIZ', id: m.quiz.id, title: m.quiz.title ?? '', moduleId, moduleOrderIndex, state: quizState(m.quiz) });
    if (m.practicalTask) {
      out.push({ kind: 'PRACTICAL', id: m.practicalTask.id, title: m.practicalTask.title ?? '', moduleId, moduleOrderIndex, state: practicalState(m.practicalTask) });
    }
  }
  if (opts.includeFinal) {
    const finalId = view.version?.finalMiniQuizId;
    if (finalId) out.push({ kind: 'FINAL_MINI_QUIZ', id: finalId, title: '', moduleId: null, moduleOrderIndex: null, state: 'NOT_STARTED' });
    const cert = view.certificate;
    out.push({
      kind: 'CERTIFICATE',
      id: cert?.serialNumber ?? 'certificate',
      title: '',
      moduleId: null,
      moduleOrderIndex: null,
      state: cert?.issued ? 'DONE' : cert?.eligible ? 'NOT_STARTED' : 'LOCKED',
    });
  }
  return out;
}

/** Ссылка на элемент пути (NextItem из learn, сосед из лекции или FlatItem). */
export function hrefForItem(courseId: string, enrollmentId: string, item: NextItem | LectureNeighbor | FlatItem): string {
  switch (item.kind) {
    case 'LECTURE':
      return routes.lecture(courseId, enrollmentId, item.id);
    case 'MINI_QUIZ': {
      const lectureId = 'lectureId' in item ? item.lectureId : undefined;
      return lectureId ? routes.lecture(courseId, enrollmentId, lectureId, { hash: 'mini-quiz' }) : routes.course(courseId, enrollmentId);
    }
    case 'MODULE_QUIZ':
      return routes.quiz(courseId, enrollmentId, item.id);
    case 'PRACTICAL':
      return routes.practical(courseId, enrollmentId, item.id);
    case 'FINAL_MINI_QUIZ':
      return routes.course(courseId, enrollmentId, { hash: 'final-mini-quiz' });
    case 'CERTIFICATE':
      return routes.certificates();
    default:
      return routes.course(courseId, enrollmentId);
  }
}

/** Ключ i18n подписи типа элемента: t(kindLabelKey(kind)) → «Лекция» / «Дәріс» / «Lecture». */
export function kindLabelKey(kind: LearnItemKind): `ui.kind.${LearnItemKind}` {
  return `ui.kind.${kind}`;
}
