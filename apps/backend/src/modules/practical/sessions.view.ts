/**
 * DTO практикума для студента — ЯВНЫЕ allowlist-построители (A1).
 *
 * Внутренние объекты (TurnResult, строки PracticalSession/ChatMessage) содержат вывод
 * судьи: баллы и notes, covered/missing/criterion_missing, integrityFlags, leakCheck,
 * turnAssessment, metrics, verdictReason. Ничего из этого студенту не уходит: каждое
 * поле ответа перечислено здесь поимённо, spread исходных объектов запрещён.
 * Модуль чистый (без БД/env) — покрыт тестами sessions.view.test.ts.
 */
import {
  isPracticalSessionCounted,
  practicalAttemptState,
  type ChatMessageView,
  type Language,
  type PracticalBrief,
  type PracticalLectureRef,
  type PracticalSessionInput,
  type PracticalSessionSummary,
  type PracticalSessionView,
  type PracticalSessionsView,
  type RubricCriterion,
  type SessionDetail,
  type SessionEvaluation,
  type SessionStatus,
  type TurnDone,
  type VerdictCode,
} from '@edu/shared';

const CRITERIA: readonly RubricCriterion[] = ['methodicalness', 'question_quality', 'logical_progression', 'self_correction'];
const VERDICT_CODES: readonly VerdictCode[] = ['PASSED', 'FAILED_LIMIT', 'FAILED_CEILING', 'ENDED_BY_STUDENT', 'ABANDONED'];
const SUMMARY_STATUSES = ['PENDING', 'READY', 'FAILED'] as const;

const iso = (d: Date | string | null | undefined): string | null => (d == null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString());

/** Строка сессии из БД — только поля, нужные построителям. */
export interface SessionRow {
  id: string;
  status: string;
  verdictCode: string | null;
  verdictReason?: string | null;
  aiMessageCount: number;
  maxAiMessages: number;
  startedAt: Date | string;
  endedAt: Date | string | null;
  summaryStatus: string | null;
  summary: unknown;
  evaluationResult: unknown;
  excusedAt: Date | string | null;
  /** Число реплик СТУДЕНТА (для засчёта попытки, A7) */
  userMessageCount: number;
}

/** Реплика чата: единственная форма сообщения, которую видит студент (A1). */
export function msgView(m: { id: string; role: string; content: string; createdAt: Date | string }): ChatMessageView {
  return { id: m.id, role: m.role as ChatMessageView['role'], content: m.content, createdAt: iso(m.createdAt)! };
}

/**
 * Код вердикта. Для старых сессий (до калибровки кода не было) — выводим из статуса;
 * сырой verdictReason студенту не показывается никогда (находка f).
 */
export function deriveVerdictCode(s: Pick<SessionRow, 'status' | 'verdictCode' | 'verdictReason'>): VerdictCode | null {
  if (s.verdictCode && (VERDICT_CODES as readonly string[]).includes(s.verdictCode)) return s.verdictCode as VerdictCode;
  switch (s.status) {
    case 'PASSED':
      return 'PASSED';
    case 'ABANDONED':
      return 'ABANDONED';
    case 'FAILED':
      return /потол|ceiling/i.test(s.verdictReason ?? '') ? 'FAILED_CEILING' : 'FAILED_LIMIT';
    default:
      return null;
  }
}

function summaryStatusOf(s: Pick<SessionRow, 'summaryStatus'>): PracticalSessionView['summaryStatus'] {
  return (SUMMARY_STATUSES as readonly string[]).includes(s.summaryStatus ?? '') ? (s.summaryStatus as PracticalSessionView['summaryStatus']) : null;
}

export function sessionView(s: SessionRow, final: boolean): PracticalSessionView {
  return {
    id: s.id,
    status: s.status as SessionStatus,
    verdictCode: deriveVerdictCode(s),
    aiMessageCount: s.aiMessageCount,
    maxAiMessages: s.maxAiMessages,
    remainingAiMessages: Math.max(0, s.maxAiMessages - s.aiMessageCount), // FR-6.7 (реплики, не токены)
    startedAt: iso(s.startedAt)!,
    endedAt: iso(s.endedAt),
    summaryStatus: summaryStatusOf(s),
    final,
  };
}

export function sessionSummaryItem(s: SessionRow): PracticalSessionSummary {
  return {
    id: s.id,
    status: s.status as SessionStatus,
    verdictCode: deriveVerdictCode(s),
    startedAt: iso(s.startedAt)!,
    endedAt: iso(s.endedAt),
    aiMessageCount: s.aiMessageCount,
    maxAiMessages: s.maxAiMessages,
    counted: isPracticalSessionCounted({ status: s.status as SessionStatus, userMessageCount: s.userMessageCount, excusedAt: s.excusedAt }),
  };
}

export function attemptInput(s: SessionRow): PracticalSessionInput {
  return {
    id: s.id,
    status: s.status as SessionStatus,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    userMessageCount: s.userMessageCount,
    excusedAt: s.excusedAt,
  };
}

/* ── Итоговая оценка (A6) ───────────────────────────────────────── */

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((x): x is string => x !== null) : []);

/**
 * Оценка завершённой сессии. null, пока сессия идёт (никакого вывода судьи в процессе).
 * Баллы критериев — серверный агрегат рубрики; строки/сильные стороны — из отзыва,
 * если он готов. «Что развивать» и отмеченные реплики — ТОЛЬКО когда попытки
 * исчерпаны или задание сдано (final): иначе отзыв натаскивает на вторую попытку (A6).
 */
export function buildEvaluation(
  s: Pick<SessionRow, 'status' | 'summary' | 'summaryStatus' | 'evaluationResult'>,
  final: boolean,
): SessionEvaluation | null {
  if (s.status === 'IN_PROGRESS') return null;
  const agg = (s.evaluationResult ?? {}) as Record<string, unknown>;
  const ready = s.summaryStatus === 'READY' && s.summary !== null && typeof s.summary === 'object';
  const stored = (ready ? s.summary : {}) as Record<string, unknown>;
  const storedCriteria = Array.isArray(stored.criteria) ? (stored.criteria as Record<string, unknown>[]) : [];

  const criteria = CRITERIA.map((key) => {
    const fromSummary = storedCriteria.find((c) => c?.key === key);
    const score = num(agg[`avg_${key}`]) ?? num(fromSummary?.score) ?? 0;
    return { key, score, line: ready ? str(fromSummary?.line) : null };
  });

  const highlights = Array.isArray(stored.highlights)
    ? (stored.highlights as Record<string, unknown>[])
        .filter((h) => str(h?.messageId) && CRITERIA.includes(h?.criterion as RubricCriterion) && (h?.polarity === 'plus' || h?.polarity === 'minus') && str(h?.note))
        .slice(0, 6)
        .map((h) => ({ messageId: h.messageId as string, criterion: h.criterion as RubricCriterion, polarity: h.polarity as 'plus' | 'minus', note: h.note as string }))
    : [];

  return {
    criteria,
    strengths: strList(stored.strengths).slice(0, 2),
    toDevelop: final ? strList(stored.toDevelop).slice(0, 2) : null,
    highlights: final ? highlights : null,
  };
}

/** Полная сессия для студента (GET /sessions/:id). */
export function buildSessionDetail(
  s: SessionRow,
  messages: { id: string; role: string; content: string; createdAt: Date | string }[],
  final: boolean,
): SessionDetail {
  return {
    session: sessionView(s, final),
    messages: messages.map(msgView),
    evaluation: buildEvaluation(s, final),
  };
}

/* ── SSE done (A1) ──────────────────────────────────────────────── */

/**
 * Единственная форма события SSE `done`: allowlist из шести полей. Вывод судьи,
 * integrityFlags, leakCheck, trace, verdictReason и прочее из TurnResult — отбрасываются.
 */
export function turnDone(r: {
  tutorMessage: string;
  tutorMessageId: string;
  userMessageId: string;
  remainingAiMessages: number;
  status: string;
  verdictCode: string | null;
}): TurnDone {
  return {
    tutorMessage: r.tutorMessage,
    tutorMessageId: r.tutorMessageId,
    userMessageId: r.userMessageId,
    remaining: r.remainingAiMessages,
    status: r.status as SessionStatus,
    verdictCode: r.verdictCode && (VERDICT_CODES as readonly string[]).includes(r.verdictCode) ? (r.verdictCode as VerdictCode) : null,
  };
}

/* ── Страница практикума (GET /practical-tasks/:id/sessions) ───── */

export interface BriefSource {
  id: string;
  title: string;
  scenarioPrompt: string;
  agenda: unknown;
  estimatedMinutes: number | null;
  maxAiMessages: number;
  maxSessions: number;
  language: Language;
  moduleTitles: string[];
  lectures: PracticalLectureRef[];
}

/** Бриф задания — без эталона и рубрики. */
export function buildBrief(t: BriefSource): PracticalBrief {
  return {
    id: t.id,
    title: t.title,
    scenario: t.scenarioPrompt,
    agenda: strList(t.agenda).slice(0, 3),
    estimatedMinutes: t.estimatedMinutes,
    maxAiMessages: t.maxAiMessages,
    maxSessions: t.maxSessions,
    language: t.language,
    moduleTitles: t.moduleTitles,
    lectures: t.lectures,
  };
}

/** Страница практикума: бриф, сессии, возможность начать. Без побочных эффектов. */
export function buildSessionsView(
  brief: PracticalBrief,
  sessions: SessionRow[],
  task: { maxSessions: number; availableFrom: Date | string | null; availableUntil: Date | string | null },
  now: Date = new Date(),
): PracticalSessionsView {
  const state = practicalAttemptState(sessions.map(attemptInput), task, now);
  const sorted = [...sessions].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  return {
    brief,
    items: sorted.map(sessionSummaryItem),
    status: state.status,
    sessionsUsed: state.sessionsUsed,
    maxSessions: task.maxSessions,
    canStart: state.canStart,
    final: state.final,
    activeSessionId: state.activeSessionId,
    latestFinishedSessionId: state.latestFinishedSessionId,
    lock: state.lock,
  };
}
