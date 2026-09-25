import {
  practicalAttemptState,
  quizAttemptState,
  type QuizRulesInput,
  type SessionStatus,
} from '@edu/shared';

/**
 * Исследовательские показатели ПО ЗАПИСИ НА КУРС (A16): при 2 попытках теста и 2
 * сессиях практикума усреднение по попыткам/сессиям искажает картину.
 *  - тест: зачётный балл (countedScore) по правилу зачёта (BEST/FIRST);
 *  - практикум: PASSED, если хоть одна сессия сдана, иначе итог последней завершённой;
 *  - n — число студентов (записей), а не попыток.
 * Чистые функции без БД — покрыты analytics.test.ts.
 */

/* ── Тест ────────────────────────────────────────────────────────────── */

/** Попытка теста — вход аналитики (в процессе: submittedAt = null). */
export interface AttemptLite {
  id: string;
  startedAt: Date;
  submittedAt: Date | null;
  score: number;
  passed: boolean;
}

/** Итог записи по тесту. countedScore — только по отправленным попыткам. */
export interface QuizOutcome {
  countedScore: number | null;
  passed: boolean;
  finalReached: boolean;
  submittedCount: number;
  inProgress: boolean;
}

export function quizOutcome(attempts: readonly AttemptLite[], rules: QuizRulesInput, now = new Date()): QuizOutcome {
  const s = quizAttemptState(attempts, rules, now);
  return {
    countedScore: s.countedScore,
    passed: s.passed,
    finalReached: s.finalReached,
    submittedCount: attempts.filter((a) => a.submittedAt !== null).length,
    inProgress: s.inProgressId !== null,
  };
}

/** Простое среднее по отправленным попыткам — прежняя (ошибочная) метрика «bestByQuiz». */
export function meanSubmittedScore(attempts: readonly AttemptLite[]): number | null {
  const sub = attempts.filter((a) => a.submittedAt !== null);
  return sub.length ? sub.reduce((s, a) => s + a.score, 0) / sub.length : null;
}

/** Среднее и n по значениям (null — нет данных, не участвует). */
export function meanOf(values: readonly (number | null | undefined)[]): { mean: number | null; n: number } {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return { mean: v.length ? v.reduce((s, x) => s + x, 0) / v.length : null, n: v.length };
}

/* ── Практикум ───────────────────────────────────────────────────────── */

/** Сессия практикума — вход аналитики. userMessageCount — реплики СТУДЕНТА. */
export interface SessionLite {
  id: string;
  status: SessionStatus;
  startedAt: Date;
  endedAt: Date | null;
  userMessageCount: number;
  excusedAt: Date | null;
  verdictCode: string | null;
}

export type PracticalOutcomeCode = 'PASSED' | 'FAILED' | 'IN_PROGRESS' | 'NOT_STARTED';

/** Итог записи по практикуму. */
export interface PracticalOutcome {
  outcome: PracticalOutcomeCode;
  /** PASSED или итог последней завершённой сессии (verdictCode, иначе статус) */
  verdict: string | null;
  /** Сдан или зачётные сессии исчерпаны */
  final: boolean;
  sessionsUsed: number;
}

export function practicalOutcome(sessions: readonly SessionLite[], maxSessions: number, now = new Date()): PracticalOutcome {
  if (sessions.length === 0) return { outcome: 'NOT_STARTED', verdict: null, final: false, sessionsUsed: 0 };
  const st = practicalAttemptState(sessions, { maxSessions, availableFrom: null, availableUntil: null }, now);
  const sorted = [...sessions].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const finished = sorted.filter((s) => s.status !== 'IN_PROGRESS');
  const latest = finished[finished.length - 1] ?? null;
  const verdict = st.passed ? 'PASSED' : latest ? (latest.verdictCode ?? latest.status) : null;
  const outcome: PracticalOutcomeCode = st.passed ? 'PASSED' : st.final ? 'FAILED' : 'IN_PROGRESS';
  return { outcome, verdict, final: st.final, sessionsUsed: st.sessionsUsed };
}

/** Доля сдавших среди записей с окончательным итогом (сдан или попытки исчерпаны). */
export function practicalPassRate(outcomes: readonly PracticalOutcome[]): { n: number; passed: number; failed: number; inProgress: number; passRate: number } {
  const passed = outcomes.filter((o) => o.outcome === 'PASSED').length;
  const failed = outcomes.filter((o) => o.outcome === 'FAILED').length;
  const inProgress = outcomes.filter((o) => o.outcome === 'IN_PROGRESS').length;
  return { n: outcomes.filter((o) => o.outcome !== 'NOT_STARTED').length, passed, failed, inProgress, passRate: passed + failed ? +(passed / (passed + failed)).toFixed(3) : 0 };
}

/* ── Матрица «студенты × элементы курса» ────────────────────────────── */

export type MatrixCellState = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'PASSED' | 'FAILED';
export interface MatrixCell {
  state: MatrixCellState;
  /** Зачётный балл теста (0..1) */
  score?: number;
}
export type MatrixColumnKind = 'LECTURE' | 'MODULE_QUIZ' | 'PRACTICAL';
export interface MatrixColumn {
  key: string;
  kind: MatrixColumnKind;
  moduleOrderIndex: number;
  label: string;
  title: string;
}

/** Лекция: DONE — отмечена просмотренной; IN_PROGRESS — открывалась/смотрелась. */
export function lectureCell(p: { isCompleted: boolean; positionSec: number; watchedSec: number; lastViewedAt: Date | null } | undefined): MatrixCell {
  if (!p) return { state: 'NOT_STARTED' };
  if (p.isCompleted) return { state: 'DONE' };
  if (p.watchedSec > 0 || p.positionSec > 0 || p.lastViewedAt) return { state: 'IN_PROGRESS' };
  return { state: 'NOT_STARTED' };
}

/** Тест модуля: PASSED / FAILED (финал без сдачи) / IN_PROGRESS; балл — зачётный. */
export function quizCell(attempts: readonly AttemptLite[], rules: QuizRulesInput, now = new Date()): MatrixCell {
  if (attempts.length === 0) return { state: 'NOT_STARTED' };
  const o = quizOutcome(attempts, rules, now);
  const state: MatrixCellState = o.passed ? 'PASSED' : o.finalReached ? 'FAILED' : 'IN_PROGRESS';
  return o.countedScore === null ? { state } : { state, score: o.countedScore };
}

/** Практикум: PASSED / FAILED (сессии исчерпаны) / IN_PROGRESS. */
export function practicalCell(sessions: readonly SessionLite[], maxSessions: number, now = new Date()): MatrixCell {
  const o = practicalOutcome(sessions, maxSessions, now);
  return { state: o.outcome === 'NOT_STARTED' ? 'NOT_STARTED' : o.outcome };
}

/**
 * Итоговая строка матрицы по столбцам: лекция — доля просмотревших (n = все
 * студенты); тест — средний зачётный балл (n — у кого он есть); практикум — доля
 * сдавших среди окончательных итогов (n — у кого итог окончательный).
 */
export function columnAverages(columns: readonly MatrixColumn[], rows: readonly { cells: readonly MatrixCell[] }[]): { key: string; value: number | null; n: number }[] {
  return columns.map((c, i) => {
    const cells = rows.map((r) => r.cells[i]).filter((x): x is MatrixCell => !!x);
    if (c.kind === 'LECTURE') {
      return { key: c.key, value: cells.length ? +(cells.filter((x) => x.state === 'DONE').length / cells.length).toFixed(3) : null, n: cells.length };
    }
    if (c.kind === 'MODULE_QUIZ') {
      const m = meanOf(cells.map((x) => x.score));
      return { key: c.key, value: m.mean === null ? null : +m.mean.toFixed(3), n: m.n };
    }
    const decided = cells.filter((x) => x.state === 'PASSED' || x.state === 'FAILED');
    return { key: c.key, value: decided.length ? +(decided.filter((x) => x.state === 'PASSED').length / decided.length).toFixed(3) : null, n: decided.length };
  });
}

/* ── Анализ заданий теста ────────────────────────────────────────────── */

export interface ItemQuestion {
  id: string;
  canonicalKey: string | null;
  prompt: string;
  options: readonly string[];
  correctOptionIds: readonly number[];
}
/** Отправленная попытка: какие вопросы были показаны и что выбрано (канонические id). */
export interface ItemAttempt {
  presentedIds: readonly string[];
  answers: Readonly<Record<string, readonly number[]>>;
}
export interface ItemStat {
  questionId: string;
  canonicalKey: string | null;
  prompt: string;
  /** Сколько попыток показали вопрос */
  n: number;
  /** Доля верных среди показов (пропуск = неверно); null при n = 0 */
  pValue: number | null;
  /** Выборы по каноническому id варианта */
  optionCounts: number[];
  unansweredCount: number;
}

/** Классический анализ заданий: трудность (p) и распределение выборов по вариантам. */
export function itemStats(questions: readonly ItemQuestion[], attempts: readonly ItemAttempt[]): ItemStat[] {
  return questions.map((q) => {
    let n = 0;
    let correct = 0;
    let unanswered = 0;
    const optionCounts = q.options.map(() => 0);
    const key = [...q.correctOptionIds].sort((a, b) => a - b);
    for (const a of attempts) {
      if (!a.presentedIds.includes(q.id)) continue;
      n++;
      const given = a.answers[q.id] ?? [];
      if (given.length === 0) {
        unanswered++;
        continue;
      }
      for (const id of given) if (id >= 0 && id < optionCounts.length) optionCounts[id]!++;
      const g = [...given].sort((x, y) => x - y);
      if (g.length === key.length && g.every((v, i) => v === key[i])) correct++;
    }
    return {
      questionId: q.id,
      canonicalKey: q.canonicalKey,
      prompt: q.prompt,
      n,
      pValue: n ? +(correct / n).toFixed(3) : null,
      optionCounts,
      unansweredCount: unanswered,
    };
  });
}
