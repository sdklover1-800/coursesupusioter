import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  ADMITTED_ENROLLMENT_STATUSES,
  isPracticalSessionCounted,
  quizAttemptState,
  type PracticalSessionMetrics,
  type PracticalTaskSnapshot,
  type ScoringRule,
  type SessionStatus,
} from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { isAnswerCorrect } from '../quizzes/scoring.js';
import { effectiveCooldownMinutes, parsePresentation, parseStoredAnswers, presentedQuestions, secondsBetween, toPolicyQuestion, type PolicyQuestion } from '../quizzes/policy.js';

/**
 * Экспорт исследовательских данных в CSV (FR-R.4) с псевдонимизацией (DP-6).
 *
 * Аудит M4: выгрузка ПОТОКОВАЯ (курсор-пагинация по id, батчами) — вся таблица
 * НЕ грузится в память и НЕ склеивается в одну строку, поэтому нет OOM/DoS и нет
 * молчаливого усечения исследовательских данных.
 *
 * Новые столбцы ДОПИСЫВАЮТСЯ в конец строки — прежние скрипты анализа, читающие
 * столбцы по позиции, не ломаются. Попытки тестов — только отправленные.
 */

const BATCH = 1000;

/** Стабильный псевдо-ID пользователя (одинаков между экспортами, необратим). */
function pseudoId(userId: string | null | undefined): string {
  if (!userId) return '';
  return 'p_' + createHash('sha256').update(`pseudo:${userId}`).digest('hex').slice(0, 16);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(values: unknown[]): string {
  return values.map(csvEscape).join(',') + '\n';
}

export const EXPORT_TYPES = ['events', 'sessions', 'rubric', 'quiz_attempts', 'item_responses', 'lecture_progress', 'cohort_summary'] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

/** Фильтры выгрузки (для всех типов): курс, когорта, период. */
export interface ExportFilters {
  courseId?: string;
  cohortId?: string;
  from?: Date;
  to?: Date;
}

type Write = (chunk: string) => void;

/** Курсор-пагинация по возрастанию id. */
async function paginate<T extends { id: string }>(fetchBatch: (cursorId?: string) => Promise<T[]>, write: (rows: T[]) => Promise<void> | void): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const batch = await fetchBatch(cursor);
    if (batch.length === 0) break;
    await write(batch);
    if (batch.length < BATCH) break;
    cursor = batch[batch.length - 1]!.id;
  }
}

const page = (cursorId?: string) => ({
  take: BATCH,
  orderBy: { id: 'asc' as const },
  ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
});

export function filenameFor(type: ExportType): string {
  return {
    events: 'events.csv',
    sessions: 'practical_sessions.csv',
    rubric: 'rubric_assessments.csv',
    quiz_attempts: 'quiz_attempts.csv',
    item_responses: 'item_responses.csv',
    lecture_progress: 'lecture_progress.csv',
    cohort_summary: 'cohort_summary.csv',
  }[type];
}

/* ── Фильтры ─────────────────────────────────────────────────────────── */

/** Диапазон дат для поля (undefined — без ограничения). */
function range(f: ExportFilters): Prisma.DateTimeFilter | undefined {
  if (!f.from && !f.to) return undefined;
  return { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) };
}

/** Фильтр записи на курс: курс и ТЕКУЩАЯ когорта студента. */
function enrollmentWhere(f: ExportFilters): Prisma.EnrollmentWhereInput {
  return { ...(f.courseId ? { courseId: f.courseId } : {}), ...(f.cohortId ? { user: { cohortId: f.cohortId } } : {}) };
}

/**
 * События: курс — по записи события (или, для событий без записи — вход, смена
 * группы, — по пользователю, записанному на курс); когорта — зафиксированная в
 * событии на момент события; период — по времени события. Типы не фильтруются:
 * LANGUAGE_SWITCHED, COHORT_CHANGED, QUIZ_AUTO_SUBMITTED, CONTENT_ISSUE_REPORTED и др.
 * выгружаются вместе со всеми.
 */
async function eventsWhere(f: ExportFilters): Promise<Prisma.EventLogWhereInput> {
  const and: Prisma.EventLogWhereInput[] = [];
  if (f.courseId) {
    const enr = await prisma.enrollment.findMany({ where: { courseId: f.courseId }, select: { id: true, userId: true } });
    and.push({
      OR: [{ enrollmentId: { in: enr.map((e) => e.id) } }, { enrollmentId: null, userId: { in: [...new Set(enr.map((e) => e.userId))] } }],
    });
  }
  if (f.cohortId) and.push({ cohortId: f.cohortId });
  const r = range(f);
  if (r) and.push({ createdAt: r });
  return and.length ? { AND: and } : {};
}

/* ── Вспомогательные для попыток ─────────────────────────────────────── */

interface QuizMeta {
  language: string;
  courseId: string | null;
  rules: { maxAttempts: number; cooldownMinutes: number; scoringRule: ScoringRule };
}

/** Метаданные тестов (язык, курс, правила попыток) — с кешем на всю выгрузку. */
async function quizMetaFor(ids: string[], cache: Map<string, QuizMeta>): Promise<void> {
  const missing = ids.filter((id) => !cache.has(id));
  if (!missing.length) return;
  const rows = await prisma.quiz.findMany({
    where: { id: { in: missing } },
    select: {
      id: true,
      maxAttempts: true,
      cooldownMinutes: true,
      scoringRule: true,
      module: { select: { languageVersion: { select: { language: true, courseId: true } } } },
      lecture: { select: { module: { select: { languageVersion: { select: { language: true, courseId: true } } } } } },
      languageVersion: { select: { language: true, courseId: true } },
    },
  });
  for (const q of rows) {
    const v = q.module?.languageVersion ?? q.lecture?.module.languageVersion ?? q.languageVersion ?? null;
    cache.set(q.id, {
      language: v?.language ?? '',
      courseId: v?.courseId ?? null,
      rules: { maxAttempts: q.maxAttempts, cooldownMinutes: effectiveCooldownMinutes(q.cooldownMinutes, env.QUIZ_COOLDOWN_MINUTES), scoringRule: q.scoringRule as ScoringRule },
    });
  }
}

/** Номер попытки и зачётность — по ВСЕМ попыткам пары (запись, тест), как у студента. */
async function attemptNumbering(pairs: { enrollmentId: string; quizId: string }[], meta: Map<string, QuizMeta>): Promise<Map<string, { attemptNumber: number; counted: boolean }>> {
  const out = new Map<string, { attemptNumber: number; counted: boolean }>();
  const uniq = [...new Map(pairs.map((p) => [`${p.enrollmentId}:${p.quizId}`, p])).values()];
  if (!uniq.length) return out;
  const all = await prisma.quizAttempt.findMany({
    where: { OR: uniq.map((p) => ({ enrollmentId: p.enrollmentId, quizId: p.quizId })) },
    select: { id: true, enrollmentId: true, quizId: true, startedAt: true, submittedAt: true, score: true, passed: true },
  });
  const groups = new Map<string, typeof all>();
  for (const a of all) {
    const k = `${a.enrollmentId}:${a.quizId}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(a);
  }
  for (const list of groups.values()) {
    const rules = meta.get(list[0]!.quizId)?.rules;
    if (!rules) continue;
    for (const n of quizAttemptState(list, rules).numbered) out.set(n.id, { attemptNumber: n.attemptNumber, counted: n.counted });
  }
  return out;
}

/** Вопросы тестов (включая архивные) — с кешем на всю выгрузку. */
async function questionsFor(quizIds: string[], cache: Map<string, { questions: PolicyQuestion[]; canonical: Map<string, string | null> }>): Promise<void> {
  const missing = quizIds.filter((id) => !cache.has(id));
  if (!missing.length) return;
  const rows = await prisma.quizQuestion.findMany({ where: { quizId: { in: missing } } });
  for (const id of missing) cache.set(id, { questions: [], canonical: new Map() });
  for (const r of rows) {
    const c = cache.get(r.quizId)!;
    c.questions.push(toPolicyQuestion(r));
    c.canonical.set(r.id, r.canonicalKey);
  }
}

const attemptInclude = { enrollment: { select: { id: true, courseId: true, user: { select: { id: true, cohortId: true } } } } } satisfies Prisma.QuizAttemptInclude;

function attemptsWhere(f: ExportFilters): Prisma.QuizAttemptWhereInput {
  const r = range(f);
  return { submittedAt: r ?? { not: null }, enrollment: enrollmentWhere(f) };
}

/* ── Вспомогательные для практикума ──────────────────────────────────── */

async function studentMessageCounts(sessionIds: string[]): Promise<Map<string, number>> {
  if (!sessionIds.length) return new Map();
  const rows = await prisma.chatMessage.groupBy({ by: ['sessionId'], where: { role: 'STUDENT', sessionId: { in: sessionIds } }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.sessionId, r._count._all]));
}

const asMetrics = (raw: unknown): Partial<PracticalSessionMetrics> => (raw && typeof raw === 'object' ? (raw as Partial<PracticalSessionMetrics>) : {});
const asSnapshot = (raw: unknown): Partial<PracticalTaskSnapshot> => (raw && typeof raw === 'object' ? (raw as Partial<PracticalTaskSnapshot>) : {});
const asLeaks = (raw: unknown): boolean | '' => (raw && typeof raw === 'object' && typeof (raw as { leaks?: unknown }).leaks === 'boolean' ? (raw as { leaks: boolean }).leaks : '');

/* ── Выгрузка ────────────────────────────────────────────────────────── */

/** Потоково пишет CSV в `write`. Заголовок с BOM — первым чанком. */
export async function streamExportCsv(type: ExportType, write: Write, f: ExportFilters = {}): Promise<void> {
  switch (type) {
    case 'events': {
      write('﻿' + csvRow(['event_id', 'event_type', 'pseudo_user_id', 'enrollment_id', 'session_id', 'cohort_id', 'timestamp', 'payload']));
      const where = await eventsWhere(f);
      await paginate(
        (c) => prisma.eventLog.findMany({ where, ...page(c) }),
        (rows) => rows.forEach((e) => write(csvRow([e.id, e.eventType, pseudoId(e.userId), e.enrollmentId ?? '', e.sessionId ?? '', e.cohortId ?? '', e.createdAt.toISOString(), e.payload]))),
      );
      return;
    }
    case 'sessions': {
      write(
        '﻿' +
          csvRow([
            'session_id', 'pseudo_user_id', 'cohort_id', 'status', 'ai_messages', 'max_ai_messages', 'tokens_used', 'orchestration_mode', 'model', 'prompt_template', 'verdict_reason', 'started_at', 'ended_at', 'integrity_flags',
            // Дописано: итог, зачётность (A7), метрики воспроизводимости (FR-R.7), снимок задания
            'enrollment_id', 'course_id', 'practical_task_id', 'verdict_code', 'end_reason', 'counted', 'excused', 'student_messages',
            'confirm_calls', 'leak_prevented', 'leak_check_timeouts', 'near_ceiling',
            'aux_input_tokens', 'aux_cached_input_tokens', 'aux_output_tokens', 'aux_reasoning_tokens',
            'prompt_version', 'canonical_ref', 'scenario_sha256', 'reference_sha256',
          ]),
      );
      const r = range(f);
      const where: Prisma.PracticalSessionWhereInput = { enrollment: enrollmentWhere(f), ...(r ? { startedAt: r } : {}) };
      await paginate(
        (c) => prisma.practicalSession.findMany({ where, ...page(c), include: { enrollment: { select: { courseId: true, user: { select: { id: true, cohortId: true } } } } } }),
        async (rows) => {
          const counts = await studentMessageCounts(rows.map((s) => s.id));
          for (const s of rows) {
            const m = asMetrics(s.metrics);
            const snap = asSnapshot(s.taskSnapshot);
            const studentMessages = counts.get(s.id) ?? 0;
            const counted = isPracticalSessionCounted({ status: s.status as SessionStatus, userMessageCount: studentMessages, excusedAt: s.excusedAt });
            write(
              csvRow([
                s.id, pseudoId(s.enrollment.user.id), s.enrollment.user.cohortId ?? '', s.status, s.aiMessageCount, s.maxAiMessages, s.tokensUsed, s.orchestrationMode, s.modelUsed ?? '', s.promptTemplateId ?? '', s.verdictReason ?? '', s.startedAt.toISOString(), s.endedAt?.toISOString() ?? '', s.integrityFlags ?? '',
                s.enrollmentId, s.enrollment.courseId, s.practicalTaskId, s.verdictCode ?? '', s.endReason ?? '', counted, !!s.excusedAt, studentMessages,
                m.confirmCalls ?? '', m.leakPrevented ?? '', m.leakCheckTimeouts ?? '', m.nearCeiling ?? '',
                m.auxTokens?.input ?? '', m.auxTokens?.cachedInput ?? '', m.auxTokens?.output ?? '', m.auxTokens?.reasoning ?? '',
                m.promptVersion ?? '', snap.canonicalRef ?? '', typeof snap.scenarioPrompt === 'string' ? sha256(snap.scenarioPrompt) : '', snap.referenceSolutionSha256 ?? '',
              ]),
            );
          }
        },
      );
      return;
    }
    case 'rubric': {
      // Строка — оценённая реплика студента; reply_* — ответ тьютора на эту реплику
      // (токены и проверка утечки пишутся на реплику тьютора, BE3).
      write(
        '﻿' +
          csvRow([
            'session_id', 'pseudo_user_id', 'cohort_id', 'methodicalness', 'question_quality', 'logical_progression', 'self_correction', 'timestamp', 'notes',
            'message_id', 'reply_message_id', 'reply_tokens_in', 'reply_tokens_out', 'reply_cached_input_tokens', 'reply_reasoning_tokens', 'reply_leak_check_leaks',
          ]),
      );
      const r = range(f);
      const where: Prisma.ChatMessageWhereInput = {
        role: 'STUDENT',
        NOT: { turnAssessment: { equals: null as never } },
        session: { enrollment: enrollmentWhere(f) },
        ...(r ? { createdAt: r } : {}),
      };
      await paginate(
        (c) => prisma.chatMessage.findMany({ ...page(c), where, include: { session: { include: { enrollment: { include: { user: { select: { id: true, cohortId: true } } } } } } } }),
        async (rows) => {
          const replies = await prisma.chatMessage.findMany({
            where: { role: 'AI', sessionId: { in: [...new Set(rows.map((m) => m.sessionId))] } },
            orderBy: { createdAt: 'asc' },
            select: { id: true, sessionId: true, createdAt: true, tokensIn: true, tokensOut: true, cachedInputTokens: true, reasoningTokens: true, leakCheck: true },
          });
          const bySession = new Map<string, typeof replies>();
          for (const x of replies) (bySession.get(x.sessionId) ?? bySession.set(x.sessionId, []).get(x.sessionId)!).push(x);
          for (const m of rows) {
            const a = m.turnAssessment as { methodicalness: number; question_quality: number; logical_progression: number; self_correction: number; notes?: string };
            const reply = (bySession.get(m.sessionId) ?? []).find((x) => x.createdAt.getTime() >= m.createdAt.getTime() && x.id !== m.id);
            write(
              csvRow([
                m.sessionId, pseudoId(m.session.enrollment.user.id), m.session.enrollment.user.cohortId ?? '', a.methodicalness, a.question_quality, a.logical_progression, a.self_correction, m.createdAt.toISOString(), a.notes ?? '',
                m.id, reply?.id ?? '', reply?.tokensIn ?? '', reply?.tokensOut ?? '', reply?.cachedInputTokens ?? '', reply?.reasoningTokens ?? '', reply ? asLeaks(reply.leakCheck) : '',
              ]),
            );
          }
        },
      );
      return;
    }
    case 'quiz_attempts': {
      write(
        '﻿' +
          csvRow([
            'attempt_id', 'pseudo_user_id', 'cohort_id', 'quiz_id', 'score', 'passed', 'submitted_at',
            // Дописано: номер и зачётность попытки (A16), длительность, честная сдача, язык, seed порядка показа
            'enrollment_id', 'course_id', 'language', 'attempt_number', 'counted', 'started_at', 'duration_sec', 'active_duration_sec',
            'unanswered_count', 'integrity_ack', 'auto_submitted', 'legacy', 'presentation_seed',
          ]),
      );
      const meta = new Map<string, QuizMeta>();
      const where = attemptsWhere(f);
      await paginate(
        (c) => prisma.quizAttempt.findMany({ where, ...page(c), include: attemptInclude }),
        async (rows) => {
          await quizMetaFor([...new Set(rows.map((a) => a.quizId))], meta);
          const numbering = await attemptNumbering(rows, meta);
          for (const a of rows) {
            const n = numbering.get(a.id);
            write(
              csvRow([
                a.id, pseudoId(a.enrollment.user.id), a.enrollment.user.cohortId ?? '', a.quizId, a.score, a.passed, a.submittedAt?.toISOString() ?? '',
                a.enrollmentId, a.enrollment.courseId, meta.get(a.quizId)?.language ?? '', n?.attemptNumber ?? '', n?.counted ?? '', a.startedAt.toISOString(),
                a.submittedAt ? secondsBetween(a.startedAt, a.submittedAt) : '', a.activeDurationSec ?? '',
                a.unansweredCount, a.integrityAck, a.autoSubmitted, a.legacy, parsePresentation(a.presentation)?.seed ?? '',
              ]),
            );
          }
        },
      );
      return;
    }
    case 'item_responses': {
      // Строка — показанный вопрос отправленной попытки; selected — канонические id
      // вариантов через ';' (пусто — нет ответа), position — место в этой попытке.
      write('﻿' + csvRow(['attempt_id', 'pseudo_user_id', 'cohort_id', 'quiz_id', 'question_id', 'canonical_key', 'position', 'selected', 'is_correct', 'language', 'attempt_number']));
      const meta = new Map<string, QuizMeta>();
      const bank = new Map<string, { questions: PolicyQuestion[]; canonical: Map<string, string | null> }>();
      const where = attemptsWhere(f);
      await paginate(
        (c) => prisma.quizAttempt.findMany({ where, ...page(c), include: attemptInclude }),
        async (rows) => {
          const quizIds = [...new Set(rows.map((a) => a.quizId))];
          await quizMetaFor(quizIds, meta);
          await questionsFor(quizIds, bank);
          const numbering = await attemptNumbering(rows, meta);
          for (const a of rows) {
            const b = bank.get(a.quizId)!;
            const answers = parseStoredAnswers(a.answers);
            for (const q of presentedQuestions(a, b.questions)) {
              const selected = answers[q.id] ?? [];
              write(
                csvRow([
                  a.id, pseudoId(a.enrollment.user.id), a.enrollment.user.cohortId ?? '', a.quizId, q.id, b.canonical.get(q.id) ?? '', q.position,
                  selected.join(';'), isAnswerCorrect(selected, q.correctOptionIds), meta.get(a.quizId)?.language ?? '', numbering.get(a.id)?.attemptNumber ?? '',
                ]),
              );
            }
          }
        },
      );
      return;
    }
    case 'lecture_progress': {
      write(
        '﻿' +
          csvRow(['pseudo_user_id', 'cohort_id', 'enrollment_id', 'course_id', 'language', 'lecture_id', 'lecture_number', 'module_order_index', 'position_sec', 'watched_sec', 'is_completed', 'completed_at', 'last_viewed_at']),
      );
      const r = range(f);
      const where: Prisma.LectureProgressWhereInput = { enrollment: enrollmentWhere(f), ...(r ? { OR: [{ lastViewedAt: r }, { completedAt: r }] } : {}) };
      const numbers = new Map<string, { lectureNumber: number; moduleOrderIndex: number; language: string }>();
      await paginate(
        (c) =>
          prisma.lectureProgress.findMany({
            where,
            ...page(c),
            include: { enrollment: { select: { courseId: true, user: { select: { id: true, cohortId: true } } } }, lecture: { select: { module: { select: { courseLanguageVersionId: true } } } } },
          }),
        async (rows) => {
          // Сквозная нумерация лекций — для версий, ещё не встречавшихся в выгрузке.
          const versions = [...new Set(rows.filter((p) => !numbers.has(p.lectureId)).map((p) => p.lecture.module.courseLanguageVersionId))];
          if (versions.length) {
            const mods = await prisma.module.findMany({
              where: { courseLanguageVersionId: { in: versions } },
              orderBy: [{ courseLanguageVersionId: 'asc' }, { orderIndex: 'asc' }],
              select: { orderIndex: true, courseLanguageVersionId: true, languageVersion: { select: { language: true } }, lectures: { orderBy: { orderIndex: 'asc' }, select: { id: true } } },
            });
            const counter = new Map<string, number>();
            for (const m of mods) {
              for (const l of m.lectures) {
                const n = (counter.get(m.courseLanguageVersionId) ?? 0) + 1;
                counter.set(m.courseLanguageVersionId, n);
                numbers.set(l.id, { lectureNumber: n, moduleOrderIndex: m.orderIndex, language: m.languageVersion.language });
              }
            }
          }
          for (const p of rows) {
            const n = numbers.get(p.lectureId);
            write(
              csvRow([
                pseudoId(p.enrollment.user.id), p.enrollment.user.cohortId ?? '', p.enrollmentId, p.enrollment.courseId, n?.language ?? '', p.lectureId, n?.lectureNumber ?? '', n?.moduleOrderIndex ?? '',
                p.positionSec, p.watchedSec, p.isCompleted, p.completedAt?.toISOString() ?? '', p.lastViewedAt?.toISOString() ?? '',
              ]),
            );
          }
        },
      );
      return;
    }
    case 'cohort_summary': {
      write(
        '﻿' +
          csvRow(['cohort_id', 'name', 'condition', 'students', 'enrollments', 'completed', 'practical_passed', 'practical_failed', 'teacher_sessions', 'n_students', 'content_issues', 'content_issues_per_enrollment']),
      );
      const rows = await buildCohortSummary(f);
      rows.forEach((r) => write(csvRow(r)));
      return;
    }
  }
}

/**
 * Сводка по когортам без N+1 (аудит M4): все enrollments и сессии берутся ОДНИМ
 * запросом и группируются в памяти, а не по отдельному запросу на когорту.
 * practical_passed/failed — число сессий (как раньше); content_issues — жалобы
 * студентов когорты (из записей когорты), на запись — среднее.
 */
export async function buildCohortSummary(f: ExportFilters = {}): Promise<(string | number)[][]> {
  const cohorts = await prisma.cohort.findMany({
    where: f.cohortId ? { id: f.cohortId } : {},
    include: { users: { select: { id: true } }, _count: { select: { teacherSessions: true } } },
  });
  const userToCohort = new Map<string, string>();
  for (const c of cohorts) for (const u of c.users) userToCohort.set(u.id, c.id);

  // Только допущенные к курсу (ACTIVE/COMPLETED): заявки PENDING/REJECTED — не участники
  // эксперимента и не должны влиять на показатели завершаемости по когортам.
  const enrollments = await prisma.enrollment.findMany({
    where: { userId: { in: [...userToCohort.keys()] }, status: { in: [...ADMITTED_ENROLLMENT_STATUSES] }, ...(f.courseId ? { courseId: f.courseId } : {}) },
    select: { id: true, userId: true, status: true },
  });
  const r = range(f);
  const enrollmentIds = enrollments.map((e) => e.id);
  const sessions = await prisma.practicalSession.findMany({
    where: { enrollmentId: { in: enrollmentIds }, ...(r ? { startedAt: r } : {}) },
    select: { status: true, enrollmentId: true },
  });
  const issues = await prisma.contentIssue.groupBy({
    by: ['enrollmentId'],
    where: { origin: 'STUDENT', enrollmentId: { in: enrollmentIds }, ...(r ? { createdAt: r } : {}) },
    _count: { _all: true },
  });
  const enrUser = new Map(enrollments.map((e) => [e.id, e.userId]));

  const agg = new Map<string, { enr: number; completed: number; passed: number; failed: number; users: Set<string>; issues: number }>();
  for (const c of cohorts) agg.set(c.id, { enr: 0, completed: 0, passed: 0, failed: 0, users: new Set(), issues: 0 });
  for (const e of enrollments) {
    const cid = userToCohort.get(e.userId);
    if (!cid) continue;
    const a = agg.get(cid)!;
    a.enr++;
    a.users.add(e.userId);
    if (e.status === 'COMPLETED') a.completed++;
  }
  for (const s of sessions) {
    const uid = enrUser.get(s.enrollmentId);
    const cid = uid ? userToCohort.get(uid) : undefined;
    if (!cid) continue;
    const a = agg.get(cid)!;
    if (s.status === 'PASSED') a.passed++;
    else if (s.status === 'FAILED') a.failed++;
  }
  for (const i of issues) {
    const uid = i.enrollmentId ? enrUser.get(i.enrollmentId) : undefined;
    const cid = uid ? userToCohort.get(uid) : undefined;
    if (cid) agg.get(cid)!.issues += i._count._all;
  }

  return cohorts.map((c) => {
    const a = agg.get(c.id)!;
    return [c.id, c.name, c.condition, c.users.length, a.enr, a.completed, a.passed, a.failed, c._count.teacherSessions, a.users.size, a.issues, a.enr ? +(a.issues / a.enr).toFixed(3) : 0];
  });
}
