import { createHash } from 'node:crypto';
import {
  ApiErrorCode,
  QuestionType,
  timecodeToSeconds,
  type AttemptPresentation,
  type AttemptQuestion,
  type AttemptSummary,
  type ReviewItem,
  type ReviewLevel,
  type ReviewPolicy,
} from '@edu/shared';
import { Errors } from '../../lib/errors.js';
import { isAnswerCorrect } from './scoring.js';

/**
 * Чистая политика оценивания (USER_DECISIONS §1, §2): порядок показа попытки,
 * валидация ответов, уровень разбора, допуск к тренировке, заморозка вопросов.
 * Без Prisma и env — всё проверяется юнит-тестами (policy.test.ts).
 */

/* ── Вопрос теста в нормализованном виде ─────────────────────────────── */

/** Вопрос теста с ключом — вход политики (строка QuizQuestion после нормализации Json-полей). */
export interface PolicyQuestion {
  id: string;
  type: string;
  prompt: string;
  options: string[];
  correctOptionIds: number[];
  explanation: string | null;
  /** Индекс = канонический id варианта */
  optionRationales: (string | null)[] | null;
  sourceLectureId: string | null;
  sourceTimecode: string | null;
  orderIndex: number;
  archivedAt: Date | null;
}

/** Вопрос в том виде, в каком его увидел студент в конкретной попытке. */
export interface PresentedQuestion extends PolicyQuestion {
  /** Порядок показа в попытке, с 1 */
  position: number;
  /** Канонические id вариантов в порядке показа */
  optionOrder: number[];
}

/** Json-поле options/correctOptionIds/optionRationales → строгие типы (мусор отбрасывается). */
export function toPolicyQuestion(row: {
  id: string;
  type: string;
  prompt: string;
  options: unknown;
  correctOptionIds: unknown;
  explanation: string | null;
  optionRationales?: unknown;
  sourceLectureId?: string | null;
  sourceTimecode?: string | null;
  orderIndex: number;
  archivedAt?: Date | null;
}): PolicyQuestion {
  const options = Array.isArray(row.options) ? row.options.map((o) => String(o)) : [];
  const correct = Array.isArray(row.correctOptionIds)
    ? row.correctOptionIds.filter((v): v is number => Number.isInteger(v))
    : [];
  const rationales = Array.isArray(row.optionRationales)
    ? row.optionRationales.map((r) => (typeof r === 'string' && r.trim() ? r : null))
    : null;
  return {
    id: row.id,
    type: row.type,
    prompt: row.prompt,
    options,
    correctOptionIds: correct,
    explanation: row.explanation ?? null,
    optionRationales: rationales,
    sourceLectureId: row.sourceLectureId ?? null,
    sourceTimecode: row.sourceTimecode ?? null,
    orderIndex: row.orderIndex,
    archivedAt: row.archivedAt ?? null,
  };
}

/** Действующие (не архивные) вопросы по orderIndex — набор для новой попытки и списков. */
export function activeQuestions<T extends { orderIndex: number; archivedAt: Date | null }>(questions: readonly T[]): T[] {
  return questions.filter((q) => q.archivedAt === null).sort((a, b) => a.orderIndex - b.orderIndex);
}

/* ── Тренировка (USER_DECISIONS §2) ──────────────────────────────────── */

/**
 * Допуск к тренировке по вопросам теста: мини-квизы — всегда; оцениваемый тест —
 * только после финала (сдан или попытки исчерпаны), иначе тренировка раскрыла бы
 * ключ до официальной попытки.
 */
export function canPractice(quiz: { isGraded: boolean }, state: { finalReached: boolean } | null): boolean {
  if (!quiz.isGraded) return true;
  return state?.finalReached === true;
}

/* ── Порядок показа попытки (USER_DECISIONS §1) ──────────────────────── */

/** Генератор mulberry32: детерминированный и быстрый PRNG для перемешивания по seed. */
function mulberry32(a: number): () => number {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Первые 4 байта sha256(seed) → 32-битное зерно. */
export function seedToInt(seed: string): number {
  return createHash('sha256').update(seed).digest().readUInt32BE(0);
}

const isIdentity = (perm: readonly number[]): boolean => perm.every((v, i) => v === i);

/**
 * Перестановка 0..n-1 (Фишер–Йетс), гарантированно отличная от исходного порядка
 * при n ≥ 2: повторная попытка не должна совпасть с первой по позициям.
 */
function shuffledPermutation(n: number, rng: () => number): number[] {
  const perm = Array.from({ length: n }, (_, i) => i);
  if (n < 2) return perm;
  for (let attempt = 0; attempt < 4; attempt++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [perm[i], perm[j]] = [perm[j]!, perm[i]!];
    }
    if (!isIdentity(perm)) return perm;
  }
  // Крайне маловероятно (≤ (1/n!)^4): детерминированный сдвиг на одну позицию.
  return perm.map((_, i) => (i + 1) % n);
}

/**
 * Порядок показа официальной попытки. Попытка 1 — канонический порядок; попытка ≥ 2 —
 * вопросы и варианты перемешаны по seed (= id попытки), варианты TRUE_FALSE — никогда.
 * Ответы всегда хранятся по каноническим id вариантов.
 */
export function buildPresentation(
  questions: readonly { id: string; type: string; optionCount: number }[],
  attemptNumber: number,
  seed: string,
): AttemptPresentation {
  const identity = (n: number) => Array.from({ length: n }, (_, i) => i);
  if (attemptNumber < 2) {
    return {
      version: 1,
      questionIds: questions.map((q) => q.id),
      optionOrder: Object.fromEntries(questions.map((q) => [q.id, identity(q.optionCount)])),
      seed: null,
    };
  }
  const rng = mulberry32(seedToInt(seed));
  const qPerm = shuffledPermutation(questions.length, rng);
  const optionOrder: Record<string, number[]> = {};
  // Варианты перемешиваются в каноническом порядке вопросов — результат не зависит от qPerm.
  for (const q of questions) {
    optionOrder[q.id] = q.type === QuestionType.TRUE_FALSE ? identity(q.optionCount) : shuffledPermutation(q.optionCount, rng);
  }
  return { version: 1, questionIds: qPerm.map((i) => questions[i]!.id), optionOrder, seed };
}

/** Json-поле QuizAttempt.presentation → AttemptPresentation (или null для устаревших попыток). */
export function parsePresentation(raw: unknown): AttemptPresentation | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<AttemptPresentation>;
  if (!Array.isArray(p.questionIds) || !p.questionIds.every((id) => typeof id === 'string')) return null;
  const optionOrder = p.optionOrder && typeof p.optionOrder === 'object' ? p.optionOrder : {};
  return { version: 1, questionIds: p.questionIds, optionOrder, seed: typeof p.seed === 'string' ? p.seed : null };
}

/** Корректная перестановка 0..n-1? */
function isPermutation(order: unknown, n: number): order is number[] {
  if (!Array.isArray(order) || order.length !== n) return false;
  const seen = new Set<number>();
  for (const v of order) {
    if (!Number.isInteger(v) || v < 0 || v >= n || seen.has(v)) return false;
    seen.add(v);
  }
  return true;
}

/**
 * Вопросы попытки в порядке показа. Есть presentation — ровно её вопросы (включая
 * архивные: разбор старой попытки). Нет (устаревшие попытки) — действующие вопросы
 * по orderIndex в каноническом порядке вариантов.
 */
export function presentedQuestions(attempt: { presentation: unknown }, quizQuestions: readonly PolicyQuestion[]): PresentedQuestion[] {
  const pres = parsePresentation(attempt.presentation);
  const identity = (n: number) => Array.from({ length: n }, (_, i) => i);
  if (!pres) {
    return activeQuestions(quizQuestions).map((q, i) => ({ ...q, position: i + 1, optionOrder: identity(q.options.length) }));
  }
  const byId = new Map(quizQuestions.map((q) => [q.id, q]));
  const out: PresentedQuestion[] = [];
  for (const id of pres.questionIds) {
    const q = byId.get(id);
    if (!q) continue; // вопрос удалён физически — пропускаем (заморозка этого не допускает)
    const order = pres.optionOrder[id];
    out.push({ ...q, position: out.length + 1, optionOrder: isPermutation(order, q.options.length) ? order : identity(q.options.length) });
  }
  return out;
}

/** Вопросы официальной попытки для студента: без ключа, варианты в порядке показа. */
export function toAttemptQuestions(presented: readonly PresentedQuestion[]): AttemptQuestion[] {
  return presented.map((q) => ({
    id: q.id,
    type: q.type as AttemptQuestion['type'],
    prompt: q.prompt,
    options: q.optionOrder.map((id) => ({ id, text: q.options[id] ?? '' })),
    position: q.position,
  }));
}

/* ── Валидация ответов ───────────────────────────────────────────────── */

export type InvalidAnswerReason =
  | 'UNKNOWN_QUESTION'
  | 'NOT_AN_ARRAY'
  | 'INVALID_OPTION'
  | 'DUPLICATE_OPTION'
  | 'TOO_MANY_OPTIONS'
  | 'MISSING_ANSWER';

const invalid = (questionId: string, reason: InvalidAnswerReason) =>
  Errors.coded(422, ApiErrorCode.INVALID_ANSWERS, 'Ответы не соответствуют вопросам попытки', { questionId, reason });

/** Сколько вариантов допускает тип вопроса (SINGLE_CHOICE и TRUE_FALSE — один). */
const maxSelectable = (type: string, optionCount: number) =>
  type === QuestionType.SINGLE_CHOICE || type === QuestionType.TRUE_FALSE ? 1 : optionCount;

/**
 * Проверка ответов против показанного набора вопросов. Ключ — id показанного
 * вопроса, значение — канонические id вариантов (целые из [0, options.length)),
 * без повторов; для одиночного выбора — не больше одного.
 * partial: пропущенные вопросы допустимы (автосохранение, отправка с пропусками).
 * Пустой выбор = нет ответа (в normalized не попадает).
 * Ошибка → 422 INVALID_ANSWERS {questionId, reason}; попытка при этом не тратится.
 */
export function validateAnswers(
  presented: readonly { id: string; type: string; options: readonly unknown[] }[],
  answers: unknown,
  opts: { partial: boolean },
): { normalized: Record<string, number[]>; unansweredCount: number } {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw invalid('', 'NOT_AN_ARRAY');
  const byId = new Map(presented.map((q) => [q.id, q]));
  const normalized: Record<string, number[]> = {};
  for (const [questionId, value] of Object.entries(answers as Record<string, unknown>)) {
    const q = byId.get(questionId);
    if (!q) throw invalid(questionId, 'UNKNOWN_QUESTION');
    if (!Array.isArray(value)) throw invalid(questionId, 'NOT_AN_ARRAY');
    const seen = new Set<number>();
    for (const v of value) {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= q.options.length) throw invalid(questionId, 'INVALID_OPTION');
      if (seen.has(v)) throw invalid(questionId, 'DUPLICATE_OPTION');
      seen.add(v);
    }
    if (seen.size > maxSelectable(q.type, q.options.length)) throw invalid(questionId, 'TOO_MANY_OPTIONS');
    if (seen.size > 0) normalized[questionId] = [...seen].sort((a, b) => a - b);
  }
  const unanswered = presented.filter((q) => !normalized[q.id]);
  if (!opts.partial && unanswered.length > 0) throw invalid(unanswered[0]!.id, 'MISSING_ANSWER');
  return { normalized, unansweredCount: unanswered.length };
}

/** Отметки «вернуться позже»: только id показанных вопросов, без повторов. */
export function validateFlagged(presented: readonly { id: string }[], flagged: readonly string[]): string[] {
  const ids = new Set(presented.map((q) => q.id));
  const out: string[] = [];
  for (const id of flagged) {
    if (!ids.has(id)) throw invalid(id, 'UNKNOWN_QUESTION');
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Json-поле answers → {questionId: number[]} (мусор отбрасывается). */
export function parseStoredAnswers(raw: unknown): Record<string, number[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = v.filter((x): x is number => Number.isInteger(x));
  }
  return out;
}

/** Json-поле flagged → string[]. */
export function parseStoredFlagged(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

/* ── Разбор попытки ──────────────────────────────────────────────────── */

/**
 * Уровень разбора по политике и состоянию (USER_DECISIONS §1):
 *  FULL_AFTER_FINAL  — до финала «верно/неверно», после — полный разбор;
 *  SCORE_UNTIL_FINAL — до финала только балл, после — полный разбор;
 *  SCORE_ONLY        — только балл всегда.
 */
export function reviewLevelFor(policy: ReviewPolicy, finalReached: boolean): ReviewLevel {
  switch (policy) {
    case 'FULL_AFTER_FINAL':
      return finalReached ? 'FULL' : 'CORRECTNESS';
    case 'SCORE_UNTIL_FINAL':
      return finalReached ? 'FULL' : 'SCORE';
    case 'SCORE_ONLY':
    default:
      return 'SCORE';
  }
}

/** Лекция-источник для ссылки «пересмотреть фрагмент». */
export interface LectureSourceInfo {
  title: string;
  lectureNumber: number | null;
}

/**
 * Разбор попытки допустимого уровня. CORRECTNESS — СТРОГО {questionId, position,
 * prompt, type, isCorrect}: ни вариантов, ни выбранного, ни ключа, ни пояснений,
 * ни источников (иначе ключ утёк бы во вторую попытку). FULL — всё, варианты в
 * порядке показа попытки с каноническими id.
 */
export function buildReview(
  level: ReviewLevel,
  presented: readonly PresentedQuestion[],
  answers: Record<string, number[]>,
  sources: ReadonlyMap<string, LectureSourceInfo>,
): ReviewItem[] {
  if (level === 'SCORE') return [];
  return presented.map((q) => {
    const selected = answers[q.id] ?? [];
    const isCorrect = isAnswerCorrect(selected, q.correctOptionIds);
    const base: ReviewItem = { questionId: q.id, position: q.position, prompt: q.prompt, type: q.type as ReviewItem['type'], isCorrect };
    if (level !== 'FULL') return base;
    const src = q.sourceLectureId ? sources.get(q.sourceLectureId) : undefined;
    return {
      ...base,
      options: q.optionOrder.map((id) => ({ id, text: q.options[id] ?? '' })),
      selected,
      correctOptionIds: q.correctOptionIds,
      explanation: q.explanation,
      optionRationales: q.optionRationales,
      source:
        q.sourceLectureId && src
          ? {
              lectureId: q.sourceLectureId,
              title: src.title,
              lectureNumber: src.lectureNumber,
              timecode: q.sourceTimecode,
              seconds: timecodeToSeconds(q.sourceTimecode),
            }
          : null,
    };
  });
}

/* ── Длительность, зависшие попытки, сводка ─────────────────────────── */

/** Эффективная пауза между попытками: значение теста или env-дефолт (0 — без паузы). */
export function effectiveCooldownMinutes(quizValue: number | null | undefined, envDefault: number): number {
  return quizValue ?? envDefault;
}

/** Секунды между датами (не меньше 0). */
export function secondsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
}

/** Активное время попытки: от старта до конца, не больше QUIZ_ATTEMPT_MAX_HOURS. */
export function activeDurationSec(startedAt: Date, end: Date, maxHours: number): number {
  return Math.min(secondsBetween(startedAt, end), Math.round(maxHours * 3600));
}

/** Попытка зависла (A15): последнее сохранение (или старт) старше QUIZ_ATTEMPT_MAX_HOURS. */
export function isAttemptStale(a: { startedAt: Date; lastSavedAt: Date | null }, maxHours: number, now: Date): boolean {
  const last = (a.lastSavedAt ?? a.startedAt).getTime();
  return now.getTime() - last > maxHours * 3600_000;
}

/** Итоги отправленной попытки для истории/результата. correctCount — по показанным вопросам. */
export function summarizeAttempt(
  row: { id: string; startedAt: Date; submittedAt: Date | null; score: number; passed: boolean; autoSubmitted: boolean },
  numbered: { attemptNumber: number; counted: boolean } | undefined,
  presented: readonly PresentedQuestion[],
  answers: Record<string, number[]>,
): AttemptSummary {
  const correctCount = presented.filter((q) => isAnswerCorrect(answers[q.id] ?? [], q.correctOptionIds)).length;
  return {
    id: row.id,
    attemptNumber: numbered?.attemptNumber ?? 1,
    startedAt: row.startedAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    durationSec: row.submittedAt ? secondsBetween(row.startedAt, row.submittedAt) : null,
    score: row.score,
    passed: row.passed,
    correctCount,
    total: presented.length,
    autoSubmitted: row.autoSubmitted,
    counted: numbered?.counted ?? false,
  };
}

/* ── Заморозка вопросов (FR-7.3 + валидность исследования) ───────────── */

/**
 * Замороженные вопросы: их id есть в presentation.questionIds или в ключах answers
 * любой попытки (отправленной или идущей). У таких вопросов нельзя менять варианты,
 * ключ и тип — иначе баллы уже сданных попыток потеряли бы смысл.
 */
export function frozenQuestionIds(attempts: readonly { presentation: unknown; answers: unknown }[]): Set<string> {
  const out = new Set<string>();
  for (const a of attempts) {
    const pres = parsePresentation(a.presentation);
    if (pres) for (const id of pres.questionIds) out.add(id);
    if (a.answers && typeof a.answers === 'object' && !Array.isArray(a.answers)) {
      for (const id of Object.keys(a.answers as Record<string, unknown>)) out.add(id);
    }
  }
  return out;
}

/** Равенство множеств канонических id (порядок не важен). */
export function sameIdSet(a: readonly number[], b: readonly number[]): boolean {
  return isAnswerCorrect([...a], [...b]);
}

/** Равенство массивов строк (варианты ответа). */
export function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
