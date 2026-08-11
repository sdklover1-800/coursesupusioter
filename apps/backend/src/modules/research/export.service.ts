import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';

/**
 * Экспорт исследовательских данных в CSV (FR-R.4) с псевдонимизацией (DP-6).
 *
 * Аудит M4: выгрузка ПОТОКОВАЯ (курсор-пагинация по id, батчами) — вся таблица
 * НЕ грузится в память и НЕ склеивается в одну строку, поэтому нет OOM/DoS и нет
 * молчаливого усечения исследовательских данных.
 */

const BATCH = 1000;

/** Стабильный псевдо-ID пользователя (одинаков между экспортами, необратим). */
function pseudoId(userId: string | null | undefined): string {
  if (!userId) return '';
  return 'p_' + createHash('sha256').update(`pseudo:${userId}`).digest('hex').slice(0, 16);
}

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(values: unknown[]): string {
  return values.map(csvEscape).join(',') + '\n';
}

export type ExportType = 'events' | 'sessions' | 'rubric' | 'quiz_attempts' | 'cohort_summary';

type Write = (chunk: string) => void;

/** Курсор-пагинация по возрастанию id. */
async function paginate<T extends { id: string }>(fetchBatch: (cursorId?: string) => Promise<T[]>, write: (rows: T[]) => void): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const batch = await fetchBatch(cursor);
    if (batch.length === 0) break;
    write(batch);
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
    cohort_summary: 'cohort_summary.csv',
  }[type];
}

/** Потоково пишет CSV в `write`. Заголовок с BOM — первым чанком. */
export async function streamExportCsv(type: ExportType, write: Write): Promise<void> {
  switch (type) {
    case 'events': {
      write('﻿' + csvRow(['event_id', 'event_type', 'pseudo_user_id', 'enrollment_id', 'session_id', 'cohort_id', 'timestamp', 'payload']));
      await paginate(
        (c) => prisma.eventLog.findMany(page(c)),
        (rows) => rows.forEach((e) => write(csvRow([e.id, e.eventType, pseudoId(e.userId), e.enrollmentId ?? '', e.sessionId ?? '', e.cohortId ?? '', e.createdAt.toISOString(), e.payload]))),
      );
      return;
    }
    case 'sessions': {
      write('﻿' + csvRow(['session_id', 'pseudo_user_id', 'cohort_id', 'status', 'ai_messages', 'max_ai_messages', 'tokens_used', 'orchestration_mode', 'model', 'prompt_template', 'verdict_reason', 'started_at', 'ended_at', 'integrity_flags']));
      await paginate(
        (c) => prisma.practicalSession.findMany({ ...page(c), include: { enrollment: { include: { user: { select: { id: true, cohortId: true } } } } } }),
        (rows) => rows.forEach((s) => write(csvRow([s.id, pseudoId(s.enrollment.user.id), s.enrollment.user.cohortId ?? '', s.status, s.aiMessageCount, s.maxAiMessages, s.tokensUsed, s.orchestrationMode, s.modelUsed ?? '', s.promptTemplateId ?? '', s.verdictReason ?? '', s.startedAt.toISOString(), s.endedAt?.toISOString() ?? '', s.integrityFlags ?? '']))),
      );
      return;
    }
    case 'rubric': {
      write('﻿' + csvRow(['session_id', 'pseudo_user_id', 'cohort_id', 'methodicalness', 'question_quality', 'logical_progression', 'self_correction', 'timestamp', 'notes']));
      await paginate(
        (c) => prisma.chatMessage.findMany({ ...page(c), where: { role: 'STUDENT', NOT: { turnAssessment: { equals: null as never } } }, include: { session: { include: { enrollment: { include: { user: { select: { id: true, cohortId: true } } } } } } } }),
        (rows) =>
          rows.forEach((m) => {
            const a = m.turnAssessment as { methodicalness: number; question_quality: number; logical_progression: number; self_correction: number; notes?: string };
            write(csvRow([m.sessionId, pseudoId(m.session.enrollment.user.id), m.session.enrollment.user.cohortId ?? '', a.methodicalness, a.question_quality, a.logical_progression, a.self_correction, m.createdAt.toISOString(), a.notes ?? '']));
          }),
      );
      return;
    }
    case 'quiz_attempts': {
      write('﻿' + csvRow(['attempt_id', 'pseudo_user_id', 'cohort_id', 'quiz_id', 'score', 'passed', 'submitted_at']));
      await paginate(
        (c) => prisma.quizAttempt.findMany({ ...page(c), include: { enrollment: { include: { user: { select: { id: true, cohortId: true } } } } } }),
        (rows) => rows.forEach((a) => write(csvRow([a.id, pseudoId(a.enrollment.user.id), a.enrollment.user.cohortId ?? '', a.quizId, a.score, a.passed, a.submittedAt?.toISOString() ?? '']))),
      );
      return;
    }
    case 'cohort_summary': {
      write('﻿' + csvRow(['cohort_id', 'name', 'condition', 'students', 'enrollments', 'completed', 'practical_passed', 'practical_failed', 'teacher_sessions']));
      const rows = await buildCohortSummary();
      rows.forEach((r) => write(csvRow(r)));
      return;
    }
  }
}

/**
 * Сводка по когортам без N+1 (аудит M4): все enrollments и сессии берутся ОДНИМ
 * запросом и группируются в памяти, а не по отдельному запросу на когорту.
 */
export async function buildCohortSummary(): Promise<(string | number)[][]> {
  const cohorts = await prisma.cohort.findMany({ include: { users: { select: { id: true } }, _count: { select: { teacherSessions: true } } } });
  const userToCohort = new Map<string, string>();
  for (const c of cohorts) for (const u of c.users) userToCohort.set(u.id, c.id);

  const enrollments = await prisma.enrollment.findMany({ where: { userId: { in: [...userToCohort.keys()] } }, select: { userId: true, status: true } });
  const sessions = await prisma.practicalSession.findMany({ where: { enrollment: { userId: { in: [...userToCohort.keys()] } } }, select: { status: true, enrollment: { select: { userId: true } } } });

  const agg = new Map<string, { enr: number; completed: number; passed: number; failed: number }>();
  for (const c of cohorts) agg.set(c.id, { enr: 0, completed: 0, passed: 0, failed: 0 });
  for (const e of enrollments) {
    const cid = userToCohort.get(e.userId);
    if (!cid) continue;
    const a = agg.get(cid)!;
    a.enr++;
    if (e.status === 'COMPLETED') a.completed++;
  }
  for (const s of sessions) {
    const cid = userToCohort.get(s.enrollment.userId);
    if (!cid) continue;
    const a = agg.get(cid)!;
    if (s.status === 'PASSED') a.passed++;
    else if (s.status === 'FAILED') a.failed++;
  }

  return cohorts.map((c) => {
    const a = agg.get(c.id)!;
    return [c.id, c.name, c.condition, c.users.length, a.enr, a.completed, a.passed, a.failed, c._count.teacherSessions];
  });
}
