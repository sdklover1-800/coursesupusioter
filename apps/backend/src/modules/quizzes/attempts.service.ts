import type { Prisma } from '@prisma/client';
import {
  ApiErrorCode,
  EventType,
  passCountFor,
  quizAttemptState,
  type AttemptPresentation,
  type AttemptResult,
  type AttemptStart,
  type AttemptSummary,
  type PracticeCheck,
  type PracticeSet,
  type PracticeSetItem,
  type PublicQuestion,
  type QuizAttemptState,
  type QuizLobby,
  type QuizRulesInput,
  type ReviewPolicy,
  type ScoringRule,
} from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { Errors } from '../../lib/errors.js';
import { withLock } from '../../lib/lock.js';
import { logger } from '../../lib/logger.js';
import { logEvent } from '../../telemetry/events.js';
import { recomputeProgress } from '../learn/progress.service.js';
import { assertQuizInEnrollment, loadOwnedEnrollment, type OwnedEnrollment } from '../learn/access.js';
import { scoreQuiz } from './scoring.js';
import {
  activeDurationSec,
  activeQuestions,
  buildPresentation,
  buildReview,
  canPractice,
  effectiveCooldownMinutes,
  isAttemptStale,
  parseStoredAnswers,
  parseStoredFlagged,
  presentedQuestions,
  reviewLevelFor,
  secondsBetween,
  summarizeAttempt,
  toAttemptQuestions,
  toPolicyQuestion,
  validateAnswers,
  validateFlagged,
  type LectureSourceInfo,
  type PolicyQuestion,
  type PresentedQuestion,
} from './policy.js';

/**
 * Жизненный цикл официальной попытки теста (USER_DECISIONS §1):
 * старт (с подтверждением честной сдачи) → автосохранение → отправка → разбор по
 * политике. 2 попытки, в зачёт лучшая, пауза между попытками, во 2-й попытке
 * вопросы и варианты перемешаны. Незавершённая попытка (submittedAt = null)
 * занимает слот; зависшие отправляются системой (A15).
 * Все агрегаты score/passed — только по отправленным попыткам.
 */

/* ── Загрузка теста ──────────────────────────────────────────────────── */

const quizInclude = {
  questions: true,
  module: { select: { id: true, orderIndex: true, courseLanguageVersionId: true } },
  lecture: { select: { id: true, module: { select: { courseLanguageVersionId: true } } } },
} satisfies Prisma.QuizInclude;

type QuizRow = Prisma.QuizGetPayload<{ include: typeof quizInclude }>;

/** Тест с нормализованными вопросами (все, включая архивные) и эффективными правилами попыток. */
export interface LoadedQuiz {
  row: QuizRow;
  /** Все вопросы, включая архивные (разбор старых попыток) */
  questions: PolicyQuestion[];
  /** Действующие вопросы по orderIndex */
  active: PolicyQuestion[];
  rules: QuizRulesInput;
  reviewPolicy: ReviewPolicy;
  versionId: string | null;
}

export async function loadQuiz(quizId: string): Promise<LoadedQuiz> {
  const row = await prisma.quiz.findUnique({ where: { id: quizId }, include: quizInclude });
  if (!row) throw Errors.notFound('Тест не найден');
  const questions = row.questions.map(toPolicyQuestion);
  return {
    row,
    questions,
    active: activeQuestions(questions),
    rules: rulesOf(row),
    reviewPolicy: row.reviewPolicy as ReviewPolicy,
    versionId: row.module?.courseLanguageVersionId ?? row.lecture?.module.courseLanguageVersionId ?? row.courseLanguageVersionId ?? null,
  };
}

/** Правила попыток теста: пауза — Quiz.cooldownMinutes ?? env.QUIZ_COOLDOWN_MINUTES. */
export function rulesOf(q: { maxAttempts: number; cooldownMinutes: number | null; scoringRule: string }): QuizRulesInput {
  return {
    maxAttempts: q.maxAttempts,
    cooldownMinutes: effectiveCooldownMinutes(q.cooldownMinutes, env.QUIZ_COOLDOWN_MINUTES),
    scoringRule: q.scoringRule as ScoringRule,
  };
}

const attemptSelect = {
  id: true,
  enrollmentId: true,
  quizId: true,
  answers: true,
  flagged: true,
  score: true,
  passed: true,
  startedAt: true,
  submittedAt: true,
  lastSavedAt: true,
  presentation: true,
  autoSubmitted: true,
  integrityAck: true,
  legacy: true,
} satisfies Prisma.QuizAttemptSelect;

type AttemptRow = Prisma.QuizAttemptGetPayload<{ select: typeof attemptSelect }>;

async function attemptsOf(enrollmentId: string, quizId: string): Promise<AttemptRow[]> {
  return prisma.quizAttempt.findMany({ where: { enrollmentId, quizId }, select: attemptSelect, orderBy: { startedAt: 'asc' } });
}

function stateOf(rows: readonly AttemptRow[], rules: QuizRulesInput, now = new Date()): QuizAttemptState {
  return quizAttemptState(
    rows.map((r) => ({ id: r.id, startedAt: r.startedAt, submittedAt: r.submittedAt, score: r.score, passed: r.passed })),
    rules,
    now,
  );
}

/** Номер попытки по порядку начала (с 1). */
function attemptNumberOf(rows: readonly AttemptRow[], attemptId: string, rules: QuizRulesInput): number {
  return stateOf(rows, rules).numbered.find((n) => n.id === attemptId)?.attemptNumber ?? rows.length;
}

/* ── Лекции-источники (ссылка «пересмотреть фрагмент») ─────────────── */

/**
 * Лекции языковой версии со сквозной нумерацией (модуль, затем лекция) — для
 * источников в разборе и выбора источника в редакторе.
 */
export async function versionLectures(versionId: string | null): Promise<{ id: string; title: string; lectureNumber: number; moduleOrderIndex: number }[]> {
  if (!versionId) return [];
  const modules = await prisma.module.findMany({
    where: { courseLanguageVersionId: versionId },
    orderBy: { orderIndex: 'asc' },
    select: { orderIndex: true, lectures: { orderBy: { orderIndex: 'asc' }, select: { id: true, title: true } } },
  });
  let n = 0;
  return modules.flatMap((m) => m.lectures.map((l) => ({ id: l.id, title: l.title, lectureNumber: ++n, moduleOrderIndex: m.orderIndex })));
}

async function sourcesFor(quiz: LoadedQuiz, presented: readonly PresentedQuestion[]): Promise<Map<string, LectureSourceInfo>> {
  const map = new Map<string, LectureSourceInfo>();
  if (!presented.some((q) => q.sourceLectureId)) return map;
  const lectures = await versionLectures(quiz.versionId);
  for (const l of lectures) map.set(l.id, { title: l.title, lectureNumber: l.lectureNumber });
  // Источник из другой версии (не должно случаться) — хотя бы название.
  const missing = presented.map((q) => q.sourceLectureId).filter((id): id is string => !!id && !map.has(id));
  if (missing.length) {
    const rows = await prisma.lecture.findMany({ where: { id: { in: missing } }, select: { id: true, title: true } });
    for (const r of rows) map.set(r.id, { title: r.title, lectureNumber: null });
  }
  return map;
}

/* ── Отправка (общая для студента, устаревшего эндпоинта и автоотправки) ── */

interface FinalizeInput {
  quiz: LoadedQuiz;
  attempt: AttemptRow;
  userId: string;
  answers: Record<string, number[]>;
  unansweredCount: number;
  now: Date;
  /** Отправлено системой по истечении срока (A15) */
  auto: boolean;
}

/**
 * Оценивает попытку по ПОКАЗАННЫМ вопросам (канонические id) и отправляет её одним
 * updateMany с условием submittedAt = null — повторная/параллельная отправка
 * ничего не меняет. false — попытка уже была отправлена.
 */
async function finalizeAttempt(p: FinalizeInput): Promise<boolean> {
  const presented = presentedQuestions(p.attempt, p.quiz.questions);
  const scored = scoreQuiz(
    presented.map((q) => ({ id: q.id, correctOptionIds: q.correctOptionIds })),
    p.answers,
    p.quiz.row.passThreshold,
  );
  // Активное время: ручная отправка — до момента отправки; автоотправка — до
  // последнего автосохранения (дальше студент не работал). Не больше лимита попытки.
  const activeEnd = p.auto ? (p.attempt.lastSavedAt ?? p.attempt.startedAt) : p.now;
  const activeSec = activeDurationSec(p.attempt.startedAt, activeEnd, env.QUIZ_ATTEMPT_MAX_HOURS);
  const res = await prisma.quizAttempt.updateMany({
    where: { id: p.attempt.id, submittedAt: null },
    data: {
      answers: p.answers,
      score: scored.score,
      passed: scored.passed,
      submittedAt: p.now,
      unansweredCount: p.unansweredCount,
      activeDurationSec: activeSec,
      autoSubmitted: p.auto,
    },
  });
  if (res.count === 0) return false;

  const rows = await attemptsOf(p.attempt.enrollmentId, p.quiz.row.id);
  await logEvent({
    eventType: p.auto ? EventType.QUIZ_AUTO_SUBMITTED : EventType.QUIZ_SUBMITTED,
    userId: p.userId,
    enrollmentId: p.attempt.enrollmentId,
    payload: {
      quizId: p.quiz.row.id,
      attemptId: p.attempt.id,
      attemptNumber: attemptNumberOf(rows, p.attempt.id, p.quiz.rules),
      score: scored.score,
      passed: scored.passed,
      durationSec: secondsBetween(p.attempt.startedAt, p.now),
      activeDurationSec: activeSec,
      unansweredCount: p.unansweredCount,
      ...(p.attempt.legacy ? { legacy: true } : {}),
    },
  });
  await recomputeProgress(p.attempt.enrollmentId);
  return true;
}

/** Автоотправка зависшей попытки с её сохранёнными ответами (A15). */
async function autoSubmit(quiz: LoadedQuiz, attempt: AttemptRow, userId: string, now: Date): Promise<boolean> {
  const presented = presentedQuestions(attempt, quiz.questions);
  // Сохранённые ответы уже проверены при автосохранении; чужие ключи отбрасываем.
  const saved = parseStoredAnswers(attempt.answers);
  const ids = new Set(presented.map((q) => q.id));
  const clean: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(saved)) if (ids.has(k) && v.length) clean[k] = v;
  let normalized = clean;
  let unansweredCount = presented.filter((q) => !clean[q.id]).length;
  try {
    ({ normalized, unansweredCount } = validateAnswers(presented, clean, { partial: true }));
  } catch {
    // Повреждённые данные не должны блокировать отправку: оцениваем как есть.
  }
  return finalizeAttempt({ quiz, attempt, userId, answers: normalized, unansweredCount, now, auto: true });
}

/** Лениво отправляет зависшие попытки записи по тесту (до hourly-sweep). */
async function autoSubmitStaleFor(enrollmentId: string, userId: string, quiz: LoadedQuiz, now = new Date()): Promise<void> {
  const stale = await prisma.quizAttempt.findMany({ where: { enrollmentId, quizId: quiz.row.id, submittedAt: null }, select: attemptSelect });
  for (const a of stale) if (isAttemptStale(a, env.QUIZ_ATTEMPT_MAX_HOURS, now)) await autoSubmit(quiz, a, userId, now);
}

/**
 * Периодическая автоотправка зависших попыток (A15): последнее сохранение (или
 * старт) старше QUIZ_ATTEMPT_MAX_HOURS. Возвращает число отправленных.
 */
export async function autoSubmitStaleAttempts(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - env.QUIZ_ATTEMPT_MAX_HOURS * 3600_000);
  const stale = await prisma.quizAttempt.findMany({
    where: {
      submittedAt: null,
      OR: [{ lastSavedAt: { lt: cutoff } }, { lastSavedAt: null, startedAt: { lt: cutoff } }],
    },
    select: { ...attemptSelect, enrollment: { select: { userId: true } } },
    take: 500,
  });
  const quizzes = new Map<string, LoadedQuiz>();
  let count = 0;
  for (const a of stale) {
    try {
      let quiz = quizzes.get(a.quizId);
      if (!quiz) {
        quiz = await loadQuiz(a.quizId);
        quizzes.set(a.quizId, quiz);
      }
      if (await autoSubmit(quiz, a, a.enrollment.userId, now)) count++;
    } catch (err) {
      logger.error({ err, attemptId: a.id }, 'Не удалось автоотправить попытку теста');
    }
  }
  return count;
}

/* ── Доступ к попытке ────────────────────────────────────────────────── */

/** Попытка студента + гейт доступа к курсу (владение, согласие, одобрение, публикация). */
async function loadOwnedAttempt(userId: string, attemptId: string): Promise<{ attempt: AttemptRow; enr: OwnedEnrollment; quiz: LoadedQuiz }> {
  const attempt = await prisma.quizAttempt.findUnique({ where: { id: attemptId }, select: { ...attemptSelect, enrollment: { select: { userId: true } } } });
  if (!attempt) throw Errors.notFound('Попытка не найдена');
  if (attempt.enrollment.userId !== userId) throw Errors.forbidden('Попытка не принадлежит пользователю');
  const enr = await loadOwnedEnrollment(userId, attempt.enrollmentId);
  const quiz = await loadQuiz(attempt.quizId);
  return { attempt, enr, quiz };
}

const submittedError = () => Errors.coded(409, ApiErrorCode.ATTEMPT_SUBMITTED, 'Попытка уже отправлена — изменить ответы нельзя');

/** Идущая попытка; отправленная или зависшая (её отправляем) → 409 ATTEMPT_SUBMITTED. */
async function requireInProgress(userId: string, attempt: AttemptRow, quiz: LoadedQuiz): Promise<void> {
  if (attempt.submittedAt) throw submittedError();
  const now = new Date();
  if (isAttemptStale(attempt, env.QUIZ_ATTEMPT_MAX_HOURS, now)) {
    await autoSubmit(quiz, attempt, userId, now);
    throw submittedError();
  }
}

function toAttemptStart(quiz: LoadedQuiz, attempt: AttemptRow, attemptNumber: number, resumed: boolean): AttemptStart {
  const presented = presentedQuestions(attempt, quiz.questions);
  return {
    attemptId: attempt.id,
    attemptNumber,
    startedAt: attempt.startedAt.toISOString(),
    questions: toAttemptQuestions(presented),
    answers: parseStoredAnswers(attempt.answers),
    flagged: parseStoredFlagged(attempt.flagged),
    lastSavedAt: attempt.lastSavedAt?.toISOString() ?? null,
    resumed,
  };
}

/* ── Лобби ───────────────────────────────────────────────────────────── */

/** Публичный вид вопроса (без ключа): id варианта = индекс в options. */
export function toPublicQuestion(q: PolicyQuestion): PublicQuestion {
  return { id: q.id, type: q.type as PublicQuestion['type'], prompt: q.prompt, options: q.options, orderIndex: q.orderIndex };
}

function summariesOf(quiz: LoadedQuiz, rows: readonly AttemptRow[], state: QuizAttemptState): AttemptSummary[] {
  const numbered = new Map(state.numbered.map((n) => [n.id, n]));
  return rows
    .filter((r) => r.submittedAt !== null)
    .map((r) => summarizeAttempt(r, numbered.get(r.id), presentedQuestions(r, quiz.questions), parseStoredAnswers(r.answers)));
}

/**
 * Лобби теста (GET /quizzes/:id): правила, попытки, пауза, история. У оцениваемого
 * теста вопросов в лобби НЕТ — они приходят только в начатой попытке.
 */
export async function buildLobby(userId: string, enr: OwnedEnrollment, quizId: string): Promise<QuizLobby> {
  await assertQuizInEnrollment(quizId, enr);
  const quiz = await loadQuiz(quizId);
  const graded = quiz.row.isGraded;
  if (graded) await autoSubmitStaleFor(enr.id, userId, quiz);
  const rows = graded ? await attemptsOf(enr.id, quizId) : [];
  const state = stateOf(rows, quiz.rules);
  const inProgress = rows.find((r) => r.id === state.inProgressId) ?? null;
  let inProgressAttempt: QuizLobby['inProgressAttempt'] = null;
  if (inProgress) {
    const presentedIds = new Set(presentedQuestions(inProgress, quiz.questions).map((q) => q.id));
    const answers = parseStoredAnswers(inProgress.answers);
    inProgressAttempt = {
      id: inProgress.id,
      startedAt: inProgress.startedAt.toISOString(),
      answeredCount: Object.entries(answers).filter(([k, v]) => presentedIds.has(k) && v.length > 0).length,
      flaggedCount: parseStoredFlagged(inProgress.flagged).filter((id) => presentedIds.has(id)).length,
    };
  }
  const questionCount = quiz.active.length;
  return {
    id: quiz.row.id,
    title: quiz.row.title,
    kind: quiz.row.kind,
    isGraded: graded,
    moduleId: quiz.row.module?.id ?? null,
    moduleOrderIndex: quiz.row.module?.orderIndex ?? null,
    questionCount,
    passThreshold: quiz.row.passThreshold,
    passCount: passCountFor(quiz.row.passThreshold, questionCount),
    maxAttempts: quiz.rules.maxAttempts,
    attemptsUsed: state.attemptsUsed,
    attemptsLeft: state.attemptsLeft,
    canStart: graded && state.canStart && questionCount > 0,
    scoringRule: quiz.rules.scoringRule,
    reviewPolicy: quiz.reviewPolicy,
    cooldownMinutes: quiz.rules.cooldownMinutes,
    cooldownUntil: state.cooldownUntil,
    bestScore: state.bestScore,
    countedScore: state.countedScore,
    passed: state.passed,
    finalReached: graded && state.finalReached,
    practiceAllowed: canPractice(quiz.row, state),
    inProgressAttempt,
    history: summariesOf(quiz, rows, state),
    ...(graded ? {} : { questions: quiz.active.map(toPublicQuestion) }),
  };
}

/* ── Старт / состояние / автосохранение / отправка ──────────────────── */

const lockKey = (enrollmentId: string, quizId: string) => `quiz-attempt:${enrollmentId}:${quizId}`;

/** Проверка права на новую попытку (под локом). */
function assertCanStartNew(state: QuizAttemptState): void {
  if (state.passed) throw Errors.coded(409, ApiErrorCode.QUIZ_ALREADY_PASSED, 'Тест уже сдан — новая попытка не допускается');
  if (state.attemptsLeft <= 0) throw Errors.coded(409, ApiErrorCode.ATTEMPTS_EXHAUSTED, 'Попытки прохождения теста исчерпаны');
  if (state.cooldownUntil) {
    throw Errors.coded(409, ApiErrorCode.COOLDOWN, 'Следующая попытка станет доступна после паузы', { cooldownUntil: state.cooldownUntil });
  }
}

function assertGraded(quiz: LoadedQuiz): void {
  // Мини-квизы тренировочные: попытки не создаются, балл не идёт в прогресс и в
  // оценочную телеметрию — так сохраняется валидность исследования.
  if (!quiz.row.isGraded) throw Errors.badRequest('Мини-квиз тренировочный и не оценивается');
  if (quiz.active.length === 0) throw Errors.conflict('В тесте пока нет вопросов');
}

/**
 * POST /quizzes/:id/attempts/start. Под локом: идущая попытка → её же (resumed);
 * иначе проверки «сдан / исчерпаны / пауза» и новая попытка с порядком показа
 * (попытка ≥ 2 — перемешанный по seed = id попытки).
 */
export async function startAttempt(userId: string, enr: OwnedEnrollment, quizId: string, integrityAck: boolean): Promise<AttemptStart> {
  await assertQuizInEnrollment(quizId, enr);
  const quiz = await loadQuiz(quizId);
  assertGraded(quiz);
  if (integrityAck !== true) {
    throw Errors.coded(422, ApiErrorCode.INTEGRITY_ACK_REQUIRED, 'Подтвердите правила честной сдачи, чтобы начать попытку');
  }
  const outcome = await withLock(lockKey(enr.id, quizId), 15_000, async () => {
    await autoSubmitStaleFor(enr.id, userId, quiz);
    const rows = await attemptsOf(enr.id, quizId);
    const state = stateOf(rows, quiz.rules);
    const inProgress = rows.find((r) => r.id === state.inProgressId);
    if (inProgress) return { attempt: inProgress, attemptNumber: attemptNumberOf(rows, inProgress.id, quiz.rules), resumed: true };
    assertCanStartNew(state);
    const attemptNumber = rows.length + 1;
    const attempt = await prisma.$transaction(async (tx) => {
      const created = await tx.quizAttempt.create({
        data: { enrollmentId: enr.id, quizId, answers: {}, flagged: [], integrityAck: true, score: 0, passed: false, submittedAt: null },
        select: { id: true },
      });
      // seed = id попытки: порядок воспроизводим и хранится в самой попытке.
      const presentation = buildPresentation(
        quiz.active.map((q) => ({ id: q.id, type: q.type, optionCount: q.options.length })),
        attemptNumber,
        created.id,
      );
      return tx.quizAttempt.update({ where: { id: created.id }, data: { presentation: presentation as unknown as Prisma.InputJsonValue }, select: attemptSelect });
    });
    return { attempt, attemptNumber, resumed: false };
  });
  if (!outcome.resumed) {
    await logEvent({
      eventType: EventType.QUIZ_STARTED,
      userId,
      enrollmentId: enr.id,
      payload: { quizId, attemptId: outcome.attempt.id, attemptNumber: outcome.attemptNumber },
    });
  }
  return toAttemptStart(quiz, outcome.attempt, outcome.attemptNumber, outcome.resumed);
}

/** GET /quiz-attempts/:id/state — идущая попытка для продолжения после обновления страницы. */
export async function attemptState(userId: string, attemptId: string): Promise<AttemptStart> {
  const { attempt, quiz } = await loadOwnedAttempt(userId, attemptId);
  await requireInProgress(userId, attempt, quiz);
  const rows = await attemptsOf(attempt.enrollmentId, attempt.quizId);
  return toAttemptStart(quiz, attempt, attemptNumberOf(rows, attempt.id, quiz.rules), true);
}

/** PATCH /quiz-attempts/:id/answers — автосохранение (без телеметрии). */
export async function saveAnswers(userId: string, attemptId: string, answers: unknown, flagged: readonly string[]): Promise<{ savedAt: string }> {
  const { attempt, quiz } = await loadOwnedAttempt(userId, attemptId);
  await requireInProgress(userId, attempt, quiz);
  const presented = presentedQuestions(attempt, quiz.questions);
  const { normalized } = validateAnswers(presented, answers, { partial: true });
  const flags = validateFlagged(presented, flagged);
  const savedAt = new Date();
  const res = await prisma.quizAttempt.updateMany({
    where: { id: attempt.id, submittedAt: null },
    data: { answers: normalized, flagged: flags, lastSavedAt: savedAt },
  });
  if (res.count === 0) throw submittedError();
  return { savedAt: savedAt.toISOString() };
}

/** Результат попытки с разбором допустимого уровня — по ТЕКУЩЕМУ состоянию попыток. */
async function buildResult(quiz: LoadedQuiz, attemptId: string, enrollmentId: string): Promise<AttemptResult> {
  const rows = await attemptsOf(enrollmentId, quiz.row.id);
  const attempt = rows.find((r) => r.id === attemptId);
  if (!attempt || !attempt.submittedAt) throw Errors.conflict('Попытка ещё не отправлена');
  const state = stateOf(rows, quiz.rules);
  const presented = presentedQuestions(attempt, quiz.questions);
  const answers = parseStoredAnswers(attempt.answers);
  const level = reviewLevelFor(quiz.reviewPolicy, state.finalReached);
  const sources = level === 'FULL' ? await sourcesFor(quiz, presented) : new Map<string, LectureSourceInfo>();
  return {
    attempt: summarizeAttempt(attempt, state.numbered.find((n) => n.id === attempt.id), presented, answers),
    reviewLevel: level,
    reviewPolicy: quiz.reviewPolicy,
    review: buildReview(level, presented, answers, sources),
    attemptsLeft: state.attemptsLeft,
    canStart: state.canStart,
    cooldownUntil: state.cooldownUntil,
    passed: state.passed,
    finalReached: state.finalReached,
  };
}

/**
 * POST /quiz-attempts/:id/submit. Ответы проверяются против показанного набора
 * (пропуски допустимы и засчитываются как неверные); без ответов в теле —
 * отправляются сохранённые.
 */
export async function submitAttempt(userId: string, attemptId: string, answers: unknown | undefined): Promise<AttemptResult> {
  const { attempt, quiz } = await loadOwnedAttempt(userId, attemptId);
  await requireInProgress(userId, attempt, quiz);
  const presented = presentedQuestions(attempt, quiz.questions);
  const { normalized, unansweredCount } = validateAnswers(presented, answers ?? parseStoredAnswers(attempt.answers), { partial: true });
  const ok = await finalizeAttempt({ quiz, attempt, userId, answers: normalized, unansweredCount, now: new Date(), auto: false });
  if (!ok) throw submittedError();
  return buildResult(quiz, attempt.id, attempt.enrollmentId);
}

/** GET /quiz-attempts/:id — результат отправленной попытки; ключ открывается по финалу. */
export async function attemptResult(userId: string, attemptId: string): Promise<AttemptResult> {
  const { attempt, quiz } = await loadOwnedAttempt(userId, attemptId);
  if (!attempt.submittedAt) throw Errors.conflict('Попытка ещё не отправлена');
  return buildResult(quiz, attempt.id, attempt.enrollmentId);
}

/** GET /quizzes/:id/attempts — история отправленных попыток. */
export async function attemptHistory(enr: OwnedEnrollment, quizId: string): Promise<AttemptSummary[]> {
  await assertQuizInEnrollment(quizId, enr);
  const quiz = await loadQuiz(quizId);
  const rows = await attemptsOf(enr.id, quizId);
  return summariesOf(quiz, rows, stateOf(rows, quiz.rules));
}

/**
 * @deprecated — удалить после FE3. Одношаговая попытка старого QuizPage: старт +
 * отправка атомарно через тот же сервис (legacy = true, integrityAck = false).
 * Действуют те же правила паузы и сдачи; разбор — по той же политике (ключа до
 * финала нет). Порядок показа — канонический: так его видел старый интерфейс.
 */
export async function legacySubmit(userId: string, enr: OwnedEnrollment, quizId: string, answers: unknown): Promise<AttemptResult> {
  await assertQuizInEnrollment(quizId, enr);
  const quiz = await loadQuiz(quizId);
  assertGraded(quiz);
  const presentation: AttemptPresentation = buildPresentation(
    quiz.active.map((q) => ({ id: q.id, type: q.type, optionCount: q.options.length })),
    1,
    'legacy',
  );
  // Невалидные ответы → 422 ДО создания попытки: слот не тратится.
  const presented = presentedQuestions({ presentation }, quiz.questions);
  const { normalized, unansweredCount } = validateAnswers(presented, answers, { partial: true });

  const attempt = await withLock(lockKey(enr.id, quizId), 15_000, async () => {
    await autoSubmitStaleFor(enr.id, userId, quiz);
    const rows = await attemptsOf(enr.id, quizId);
    const state = stateOf(rows, quiz.rules);
    if (state.inProgressId) throw Errors.conflict('Есть незавершённая попытка — продолжите её');
    assertCanStartNew(state);
    const created = await prisma.quizAttempt.create({
      data: {
        enrollmentId: enr.id,
        quizId,
        answers: {},
        flagged: [],
        integrityAck: false,
        legacy: true,
        score: 0,
        passed: false,
        submittedAt: null,
        presentation: presentation as unknown as Prisma.InputJsonValue,
      },
      select: attemptSelect,
    });
    await logEvent({
      eventType: EventType.QUIZ_STARTED,
      userId,
      enrollmentId: enr.id,
      payload: { quizId, attemptId: created.id, attemptNumber: rows.length + 1, legacy: true },
    });
    const ok = await finalizeAttempt({ quiz, attempt: created, userId, answers: normalized, unansweredCount, now: new Date(), auto: false });
    if (!ok) throw submittedError();
    return created;
  });
  return buildResult(quiz, attempt.id, enr.id);
}

/* ── Тренировка (USER_DECISIONS §2) ──────────────────────────────────── */

/** Состояние попыток записи по оцениваемому тесту (для допуска к тренировке). */
async function gradedStateFor(enrollmentId: string, quiz: LoadedQuiz): Promise<QuizAttemptState | null> {
  if (!quiz.row.isGraded) return null;
  return stateOf(await attemptsOf(enrollmentId, quiz.row.id), quiz.rules);
}

const practiceLocked = () =>
  Errors.coded(403, ApiErrorCode.PRACTICE_LOCKED, 'Вопросы теста откроются для тренировки после его завершения');

/**
 * POST /quizzes/:id/practice — проверка одного вопроса в тренировке. Попыток и
 * оценочной телеметрии НЕ пишет. Вопросы оцениваемого теста — только после финала.
 */
export async function practiceCheck(enr: OwnedEnrollment, quizId: string, questionId: string, selected: readonly number[]): Promise<PracticeCheck> {
  await assertQuizInEnrollment(quizId, enr);
  const quiz = await loadQuiz(quizId);
  if (!canPractice(quiz.row, await gradedStateFor(enr.id, quiz))) throw practiceLocked();
  const q = quiz.active.find((x) => x.id === questionId);
  if (!q) throw Errors.notFound('Вопрос не найден');
  const { normalized } = validateAnswers([q], { [q.id]: [...selected] }, { partial: true });
  const given = normalized[q.id] ?? [];
  const isCorrect = given.length === q.correctOptionIds.length && given.every((v) => q.correctOptionIds.includes(v));
  return { isCorrect, correctOptionIds: q.correctOptionIds, explanation: q.explanation, optionRationales: q.optionRationales };
}

/**
 * GET /modules/:id/practice-set — «Тренировка по модулю»: вопросы мини-квизов
 * лекций модуля (порядок лекций, затем вопросов); вопросы теста модуля — только
 * после его финала (includesGraded).
 */
export async function practiceSet(enr: OwnedEnrollment, moduleId: string): Promise<PracticeSet> {
  const mod = await prisma.module.findUnique({
    where: { id: moduleId },
    select: {
      id: true,
      courseLanguageVersionId: true,
      quiz: { select: { id: true } },
      lectures: {
        orderBy: { orderIndex: 'asc' },
        select: { id: true, miniQuiz: { select: { id: true, isGraded: true, questions: { where: { archivedAt: null }, orderBy: { orderIndex: 'asc' } } } } },
      },
    },
  });
  if (!mod || mod.courseLanguageVersionId !== enr.languageVersionId) throw Errors.forbidden('Модуль не относится к вашему курсу');
  const items: PracticeSetItem[] = [];
  for (const l of mod.lectures) {
    if (!l.miniQuiz || l.miniQuiz.isGraded) continue;
    for (const q of l.miniQuiz.questions) {
      items.push({ quizId: l.miniQuiz.id, source: 'MINI', lectureId: l.id, question: toPublicQuestion(toPolicyQuestion(q)) });
    }
  }
  let includesGraded = false;
  if (mod.quiz) {
    const quiz = await loadQuiz(mod.quiz.id);
    const state = await gradedStateFor(enr.id, quiz);
    if (quiz.row.isGraded && state?.finalReached) {
      includesGraded = true;
      for (const q of quiz.active) {
        items.push({ quizId: quiz.row.id, source: 'GRADED', lectureId: q.sourceLectureId, question: toPublicQuestion(q) });
      }
    }
  }
  return { moduleId: mod.id, includesGraded, items };
}
