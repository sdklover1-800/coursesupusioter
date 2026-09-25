/**
 * Клиент тестов студента (FE3): лобби, официальная попытка (старт → автосохранение →
 * отправка → результат), тренировка (набор модуля, проверка вопроса), мини-квизы.
 * Контракт — @edu/shared learn.ts (BE2). Ответы официальной попытки всегда передаются
 * по КАНОНИЧЕСКИМ id вариантов (AttemptOption.id), порядок показа — из AttemptStart.
 *
 * Валидность исследования (USER_DECISIONS §1–§2): тренировочные вызовы не пишут
 * попыток и оценочной телеметрии; официальная попытка не получает правильности до отправки.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiErrorCode, type PublicQuestion, type QuestionType, type QuizKind } from '@edu/shared';
import type {
  AttemptResult, AttemptStart, AttemptSummary, PracticeCheck, PracticeSet, QuizLobby,
} from '@edu/shared';
import { api, ApiError } from './api';
import { learnKeys, routes } from './learn';

export type {
  AttemptOption, AttemptQuestion, AttemptResult, AttemptStart, AttemptSummary, PracticeCheck, PracticeSet,
  PracticeSetItem, PublicQuestion, QuizLobby, ReviewItem, ReviewLevel, ReviewPolicy, ReviewSource, ScoringRule,
} from '@edu/shared';

/* ── Ключи запросов ─────────────────────────────────────────────────── */
export const quizKeys = {
  /** Лобби — тот же ключ, что learnKeys.quiz (invalidateLearning сбрасывает префикс ['quiz']) */
  lobby: (quizId: string | undefined, enrollmentId: string | undefined) => learnKeys.quiz(quizId, enrollmentId),
  /**
   * Идущая попытка. Префикс НЕ 'quiz': invalidateLearning после отправки не должен
   * перезапрашивать /state уже отправленной попытки (409 ATTEMPT_SUBMITTED).
   */
  attemptState: (attemptId: string | undefined) => ['quiz-attempt', 'state', attemptId] as const,
  /** Результат попытки: уровень разбора зависит от ТЕКУЩЕГО состояния — сбрасываем после каждой отправки */
  attemptResult: (attemptId: string | undefined) => ['quiz-attempt', 'result', attemptId] as const,
  practiceSet: (moduleId: string | undefined | null, enrollmentId: string | undefined) => ['quiz-practice-set', moduleId, enrollmentId] as const,
  /** Мини-квиз лекции / итоговый мини-квиз курса (прежний ключ MiniQuiz) */
  mini: (url: string, enrollmentId: string) => ['mini-quiz', url, enrollmentId] as const,
};

/* ── Маршруты страницы теста ────────────────────────────────────────── */
export const quizRoutes = {
  lobby: (courseId: string, enrollmentId: string, quizId: string) => routes.quiz(courseId, enrollmentId, quizId),
  /** Результат отправленной попытки (?attempt=) */
  result: (courseId: string, enrollmentId: string, quizId: string, attemptId: string) =>
    routes.quiz(courseId, enrollmentId, quizId, { attempt: attemptId }),
  /** Идущая попытка (?run=): обновление страницы возвращает в раннер через GET /quiz-attempts/:id/state */
  run: (courseId: string, enrollmentId: string, quizId: string, attemptId: string) =>
    `${routes.quiz(courseId, enrollmentId, quizId)}?run=${encodeURIComponent(attemptId)}`,
  /** Тренировка по модулю (?mode=practice); graded — только вопросы теста (после финала) */
  practice: (courseId: string, enrollmentId: string, quizId: string, opts: { graded?: boolean } = {}) =>
    `${routes.quiz(courseId, enrollmentId, quizId, { mode: 'practice' })}${opts.graded ? '&only=graded' : ''}`,
};

/* ── Запросы ────────────────────────────────────────────────────────── */

/** Лобби теста (GET /quizzes/:id). У оцениваемого — без вопросов; у тренировочного — questions. */
export function useQuizLobby(quizId: string | undefined, enrollmentId: string | undefined) {
  return useQuery({
    queryKey: quizKeys.lobby(quizId, enrollmentId),
    queryFn: () => api.get<QuizLobby>(`/quizzes/${quizId}?enrollmentId=${enrollmentId}`),
    enabled: !!quizId && !!enrollmentId,
  });
}

/**
 * Идущая попытка (GET /quiz-attempts/:id/state). Без повторов и перезапросов по фокусу:
 * локальные ответы раннера инициализируются один раз и не должны перетираться.
 * Страница удаляет запись кэша при уходе из раннера — повторный вход всегда берёт
 * свежие ответы с сервера (иначе устаревший снимок затёр бы автосохранение).
 */
export function useAttemptState(attemptId: string | undefined) {
  return useQuery({
    queryKey: quizKeys.attemptState(attemptId),
    queryFn: () => api.get<AttemptStart>(`/quiz-attempts/${attemptId}/state`),
    enabled: !!attemptId,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/** Результат отправленной попытки (GET /quiz-attempts/:id). */
export function useAttemptResult(attemptId: string | undefined) {
  return useQuery({
    queryKey: quizKeys.attemptResult(attemptId),
    queryFn: () => api.get<AttemptResult>(`/quiz-attempts/${attemptId}`),
    enabled: !!attemptId,
    retry: false,
  });
}

/** Набор «Тренировка по модулю» (GET /modules/:id/practice-set). */
export function usePracticeSet(moduleId: string | null | undefined, enrollmentId: string | undefined) {
  return useQuery({
    queryKey: quizKeys.practiceSet(moduleId, enrollmentId),
    queryFn: () => api.get<PracticeSet>(`/modules/${moduleId}/practice-set?enrollmentId=${enrollmentId}`),
    enabled: !!moduleId && !!enrollmentId,
    refetchOnWindowFocus: false,
  });
}

/** Мини-квиз (прежняя форма ответа: {quiz: {id,title,kind,isGraded,questions} | null}). */
export interface MiniQuizData {
  id: string;
  title: string;
  kind: QuizKind | string;
  isGraded: boolean;
  questions: { id: string; type: QuestionType | string; prompt: string; options: string[] }[];
}
export function useMiniQuiz(url: string, enrollmentId: string) {
  return useQuery({
    queryKey: quizKeys.mini(url, enrollmentId),
    queryFn: () => api.get<{ quiz: MiniQuizData | null }>(`${url}?enrollmentId=${enrollmentId}`),
    enabled: !!url && !!enrollmentId,
    refetchOnWindowFocus: false,
  });
}

/* ── Действия ───────────────────────────────────────────────────────── */

/** Старт (или возобновление) официальной попытки. 409 COOLDOWN / ATTEMPTS_EXHAUSTED / QUIZ_ALREADY_PASSED, 422 INTEGRITY_ACK_REQUIRED. */
export function startAttempt(quizId: string, enrollmentId: string, integrityAck: boolean) {
  return api.post<AttemptStart>(`/quizzes/${quizId}/attempts/start`, { enrollmentId, integrityAck });
}

/** Автосохранение ответов и отметок. keepalive — при уходе со страницы. */
export function saveAttemptAnswers(
  attemptId: string,
  body: { answers: Record<string, number[]>; flagged: string[] },
  opts?: { keepalive?: boolean },
) {
  return api.patch<{ savedAt: string }>(`/quiz-attempts/${attemptId}/answers`, body, opts);
}

/** Окончательная отправка: пропуски засчитываются как неверные. */
export function submitAttempt(attemptId: string, answers: Record<string, number[]>) {
  return api.post<AttemptResult>(`/quiz-attempts/${attemptId}/submit`, { answers });
}

/** Тренировочная проверка одного вопроса (без попыток и телеметрии). 403 PRACTICE_LOCKED. */
export function checkPractice(quizId: string, body: { enrollmentId: string; questionId: string; selectedOptionIds: number[] }) {
  return api.post<PracticeCheck>(`/quizzes/${quizId}/practice`, body);
}

/* ── Ошибки ─────────────────────────────────────────────────────────── */
export const QuizErrorCode = {
  COOLDOWN: ApiErrorCode.COOLDOWN,
  ATTEMPTS_EXHAUSTED: ApiErrorCode.ATTEMPTS_EXHAUSTED,
  QUIZ_ALREADY_PASSED: ApiErrorCode.QUIZ_ALREADY_PASSED,
  ATTEMPT_SUBMITTED: ApiErrorCode.ATTEMPT_SUBMITTED,
  INVALID_ANSWERS: ApiErrorCode.INVALID_ANSWERS,
  INTEGRITY_ACK_REQUIRED: ApiErrorCode.INTEGRITY_ACK_REQUIRED,
  PRACTICE_LOCKED: ApiErrorCode.PRACTICE_LOCKED,
} as const;

/** Код ошибки API (или null). */
export function errorCode(err: unknown): string | null {
  return err instanceof ApiError ? err.code : null;
}

/* ── Чистые помощники ───────────────────────────────────────────────── */

/** Буква варианта по ПОЗИЦИИ ПОКАЗА: A–D (латиница во всех языках). */
export function optionLetter(displayIndex: number): string {
  return String.fromCharCode(65 + displayIndex);
}

/** Римская цифра модуля: 0 → I, 1 → II … (orderIndex с нуля). */
export function romanNumeral(n: number): string {
  const map: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let v = Math.max(1, Math.floor(n));
  let out = '';
  for (const [k, s] of map) while (v >= k) {
    out += s;
    v -= k;
  }
  return out;
}

/** «≈ N мин» на прохождение: 1,5 минуты на вопрос (FE3 §5). */
export function estimatedMinutes(questionCount: number): number {
  return Math.max(1, Math.ceil(questionCount * 1.5));
}

/** Засчитанная попытка из истории (counted), иначе последняя. */
export function countedAttempt(history: readonly AttemptSummary[]): AttemptSummary | null {
  return history.find((h) => h.counted) ?? history[history.length - 1] ?? null;
}

/** Вопрос тренировки: вопрос без ключа + тест, через который он проверяется. */
export interface PracticeItem {
  quizId: string;
  question: PublicQuestion | (MiniQuizData['questions'][number] & { orderIndex?: number });
  source?: 'MINI' | 'GRADED';
  lectureId?: string | null;
}

/**
 * Текущее время с шагом intervalMs (обратный отсчёт паузы). active=false — не тикать.
 */
export function useNow(intervalMs = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, active]);
  return now;
}
