import type { Prisma } from '@prisma/client';
import {
  ADMITTED_ENROLLMENT_STATUSES,
  CONTENT_ISSUE_CONTEXTS,
  CONTENT_ISSUE_DAILY_LIMIT,
  CONTENT_ISSUE_REASONS,
  ContentIssueTarget,
  EventType,
  Role,
  type ContentIssueInput,
  type ContentIssueOrigin,
  type ContentIssueStatus,
} from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { Errors } from '../../lib/errors.js';
import { logEvent } from '../../telemetry/events.js';
import { loadOwnedEnrollment } from '../learn/access.js';
import { frozenQuestionIds } from '../quizzes/policy.js';

/**
 * Жалобы на контент (ContentIssue): подача студентом/сотрудником, очередь и разбор
 * сотрудниками, системные отметки на экспертную проверку (USER_DECISIONS §5).
 * Ответ на подачу — ТОЛЬКО {ok: true}: никакой информации о верности ответа
 * (жалоба возможна и во время официальной попытки).
 */

/* ── Подача жалобы ───────────────────────────────────────────────────── */

/** Кто подаёт жалобу. */
export interface Reporter {
  id: string;
  role: Role;
}

/** Контексты, доступные через API (CONTENT_PIPELINE — только контент-скрипты). */
export const API_ISSUE_CONTEXTS = CONTENT_ISSUE_CONTEXTS.filter((c) => c !== 'CONTENT_PIPELINE');

/** Максимальная длина комментария к жалобе. */
export const ISSUE_COMMENT_MAX = 2000;

/**
 * Причина допустима для типа объекта (CONTENT_ISSUE_REASONS), контекст — из
 * API_ISSUE_CONTEXTS. Системные причины (EXPERT_REVIEW и др.) через API не создаются.
 */
export function validateIssueInput(input: ContentIssueInput): void {
  const reasons = CONTENT_ISSUE_REASONS[input.targetType] as readonly string[] | undefined;
  if (!reasons) throw Errors.validation('Неизвестный тип объекта жалобы', { field: 'targetType' });
  if (!reasons.includes(input.reason)) throw Errors.validation('Причина не подходит для этого объекта', { field: 'reason', allowed: reasons });
  if (!(API_ISSUE_CONTEXTS as readonly string[]).includes(input.context)) {
    throw Errors.validation('Недопустимый контекст жалобы', { field: 'context', allowed: API_ISSUE_CONTEXTS });
  }
  if (input.comment !== undefined && input.comment.length > ISSUE_COMMENT_MAX) {
    throw Errors.validation('Комментарий слишком длинный', { field: 'comment', max: ISSUE_COMMENT_MAX });
  }
}

/** Превышен суточный лимит жалоб? */
export function isOverDailyLimit(countLast24h: number, limit = CONTENT_ISSUE_DAILY_LIMIT): boolean {
  return countLast24h >= limit;
}

/** Единственная форма ответа на подачу жалобы. */
export function issueAccepted(): { ok: true } {
  return { ok: true };
}

/** Куда относится объект жалобы. */
interface ResolvedTarget {
  languageVersionId: string;
  courseId: string;
  enrollmentId: string | null;
}

const isStaff = (r: Reporter) => r.role === Role.ADMIN || r.role === Role.COURSE_MANAGER;
const targetNotFound = () => Errors.notFound('Объект жалобы не найден');
const notYours = () => Errors.forbidden('Объект жалобы не относится к вашему курсу');

/** Языковая версия вопроса — по любой из трёх привязок теста (модуль / лекция / версия). */
async function questionTarget(id: string) {
  const q = await prisma.quizQuestion.findUnique({
    where: { id },
    select: {
      id: true,
      archivedAt: true,
      quizId: true,
      quiz: {
        select: {
          courseLanguageVersionId: true,
          module: { select: { courseLanguageVersionId: true } },
          lecture: { select: { module: { select: { courseLanguageVersionId: true } } } },
        },
      },
    },
  });
  if (!q) return null;
  const versionId = q.quiz.module?.courseLanguageVersionId ?? q.quiz.lecture?.module.courseLanguageVersionId ?? q.quiz.courseLanguageVersionId ?? null;
  return versionId ? { versionId, archived: q.archivedAt !== null, quizId: q.quizId } : null;
}

/** Запись студента на версию: присланная (с проверкой владения) или найденная допущенная. */
async function studentEnrollmentFor(reporter: Reporter, versionId: string, enrollmentId: string | undefined): Promise<string> {
  if (enrollmentId) {
    const enr = await loadOwnedEnrollment(reporter.id, enrollmentId);
    if (enr.languageVersionId !== versionId) throw notYours();
    return enr.id;
  }
  const enr = await prisma.enrollment.findFirst({
    where: { userId: reporter.id, languageVersionId: versionId, status: { in: [...ADMITTED_ENROLLMENT_STATUSES] } },
    select: { id: true },
  });
  if (!enr) throw notYours();
  return enr.id;
}

/**
 * Проверяет, что объект существует и принадлежит автору жалобы:
 *  - QUIZ_QUESTION — в версии записи (архивный — только если студент на него отвечал);
 *  - CHAT_MESSAGE — в собственной сессии автора;
 *  - LECTURE / PRACTICAL_TASK — в версии записи.
 * Сотрудник может пожаловаться на любой существующий объект.
 */
export async function resolveIssueTarget(reporter: Reporter, input: ContentIssueInput): Promise<ResolvedTarget> {
  const staff = isStaff(reporter);
  let versionId: string;
  let enrollmentId: string | null = null;

  switch (input.targetType) {
    case ContentIssueTarget.QUIZ_QUESTION: {
      const t = await questionTarget(input.targetId);
      if (!t) throw targetNotFound();
      versionId = t.versionId;
      if (!staff) {
        enrollmentId = await studentEnrollmentFor(reporter, versionId, input.enrollmentId);
        if (t.archived) {
          const attempts = await prisma.quizAttempt.findMany({ where: { enrollmentId, quizId: t.quizId }, select: { presentation: true, answers: true } });
          if (!frozenQuestionIds(attempts).has(input.targetId)) throw targetNotFound();
        }
      }
      break;
    }
    case ContentIssueTarget.CHAT_MESSAGE: {
      const m = await prisma.chatMessage.findUnique({
        where: { id: input.targetId },
        select: {
          session: {
            select: {
              enrollmentId: true,
              enrollment: { select: { userId: true } },
              practicalTask: { select: { module: { select: { courseLanguageVersionId: true } } } },
            },
          },
        },
      });
      if (!m) throw targetNotFound();
      versionId = m.session.practicalTask.module.courseLanguageVersionId;
      if (!staff) {
        if (m.session.enrollment.userId !== reporter.id) throw notYours();
        if (input.enrollmentId && input.enrollmentId !== m.session.enrollmentId) throw notYours();
        enrollmentId = (await loadOwnedEnrollment(reporter.id, m.session.enrollmentId)).id;
      }
      break;
    }
    case ContentIssueTarget.LECTURE: {
      const l = await prisma.lecture.findUnique({ where: { id: input.targetId }, select: { module: { select: { courseLanguageVersionId: true } } } });
      if (!l) throw targetNotFound();
      versionId = l.module.courseLanguageVersionId;
      if (!staff) enrollmentId = await studentEnrollmentFor(reporter, versionId, input.enrollmentId);
      break;
    }
    case ContentIssueTarget.PRACTICAL_TASK: {
      const p = await prisma.practicalTask.findUnique({ where: { id: input.targetId }, select: { module: { select: { courseLanguageVersionId: true } } } });
      if (!p) throw targetNotFound();
      versionId = p.module.courseLanguageVersionId;
      if (!staff) enrollmentId = await studentEnrollmentFor(reporter, versionId, input.enrollmentId);
      break;
    }
    default:
      throw Errors.validation('Неизвестный тип объекта жалобы');
  }

  const version = await prisma.courseLanguageVersion.findUnique({ where: { id: versionId }, select: { courseId: true } });
  if (!version) throw targetNotFound();
  return { languageVersionId: versionId, courseId: version.courseId, enrollmentId };
}

/**
 * POST /content-issues. Порядок: входные данные → суточный лимит → принадлежность
 * объекта → запись (повтор той же жалобы тем же автором не дублируется) →
 * CONTENT_ISSUE_REPORTED. Ответ — только {ok: true}.
 */
export async function reportIssue(reporter: Reporter, input: ContentIssueInput, now = new Date()): Promise<{ ok: true }> {
  validateIssueInput(input);
  const recent = await prisma.contentIssue.count({ where: { reporterId: reporter.id, createdAt: { gte: new Date(now.getTime() - 24 * 3600_000) } } });
  if (isOverDailyLimit(recent)) throw Errors.tooManyRequests('Слишком много сообщений за сутки — попробуйте завтра');
  const target = await resolveIssueTarget(reporter, input);

  const duplicate = await prisma.contentIssue.findFirst({
    where: { reporterId: reporter.id, targetType: input.targetType, targetId: input.targetId, reason: input.reason, status: 'OPEN' },
    select: { id: true },
  });
  if (duplicate) return issueAccepted();

  await prisma.contentIssue.create({
    data: {
      origin: 'STUDENT',
      reporterId: reporter.id,
      enrollmentId: target.enrollmentId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      comment: input.comment?.trim() || null,
      context: input.context,
      courseId: target.courseId,
      languageVersionId: target.languageVersionId,
    },
  });
  await logEvent({
    eventType: EventType.CONTENT_ISSUE_REPORTED,
    userId: reporter.id,
    enrollmentId: target.enrollmentId,
    payload: { targetType: input.targetType, reason: input.reason, context: input.context },
  });
  return issueAccepted();
}

/* ── Очередь сотрудника ──────────────────────────────────────────────── */

export interface IssueListFilters {
  courseId?: string;
  status?: ContentIssueStatus | 'ALL';
  targetType?: ContentIssueTarget;
  language?: string;
  origin?: ContentIssueOrigin;
  cursor?: string;
  limit: number;
}

/** Превью объекта жалобы (для сотрудника: у вопроса — с ключом). */
export type IssuePreview =
  | { kind: 'QUIZ_QUESTION'; prompt: string; options: string[]; correctOptionIds: number[]; quizId: string; quizTitle: string; canonicalKey: string | null; archived: boolean }
  | { kind: 'CHAT_MESSAGE'; excerpt: string; sessionId: string; role: string }
  | { kind: 'LECTURE'; title: string; lectureNumber: number | null }
  | { kind: 'PRACTICAL_TASK'; title: string }
  | null;

/** Группа жалоб на один объект. */
export interface IssueGroup {
  key: string;
  targetType: ContentIssueTarget;
  targetId: string;
  /** OPEN, если есть открытая; иначе — статус последней */
  status: ContentIssueStatus;
  /** STUDENT | SYSTEM | MIXED */
  origin: ContentIssueOrigin | 'MIXED';
  reporterCount: number;
  issueCount: number;
  latestAt: string;
  reasons: { reason: string; count: number }[];
  contexts: string[];
  comments: { text: string; reason: string; origin: ContentIssueOrigin; createdAt: string }[];
  issueIds: string[];
  openIssueIds: string[];
  courseId: string | null;
  languageVersionId: string | null;
  language: string | null;
  preview: IssuePreview;
}

type IssueRow = { id: string; origin: ContentIssueOrigin; reporterId: string | null; reason: string; comment: string | null; context: string; status: ContentIssueStatus; createdAt: Date; courseId: string | null; languageVersionId: string | null; targetType: ContentIssueTarget; targetId: string };

/** Сворачивает жалобы одного объекта в группу (чистая функция; rows — по убыванию даты). */
export function groupIssueRows(rows: readonly IssueRow[]): Omit<IssueGroup, 'preview' | 'language'> {
  const first = rows[0]!;
  const reasonCounts = new Map<string, number>();
  for (const r of rows) reasonCounts.set(r.reason, (reasonCounts.get(r.reason) ?? 0) + 1);
  const origins = new Set(rows.map((r) => r.origin));
  const open = rows.filter((r) => r.status === 'OPEN');
  return {
    key: `${first.targetType}:${first.targetId}`,
    targetType: first.targetType,
    targetId: first.targetId,
    status: open.length ? 'OPEN' : first.status,
    origin: origins.size === 1 ? first.origin : 'MIXED',
    reporterCount: new Set(rows.map((r) => r.reporterId).filter(Boolean)).size,
    issueCount: rows.length,
    latestAt: first.createdAt.toISOString(),
    reasons: [...reasonCounts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    contexts: [...new Set(rows.map((r) => r.context))],
    comments: rows
      .filter((r) => r.comment)
      .slice(0, 5)
      .map((r) => ({ text: r.comment!, reason: r.reason, origin: r.origin, createdAt: r.createdAt.toISOString() })),
    issueIds: rows.map((r) => r.id),
    openIssueIds: open.map((r) => r.id),
    courseId: first.courseId,
    languageVersionId: first.languageVersionId,
  };
}

/** Курсор очереди — смещение по группам (группы сортируются по последней жалобе). */
const encodeCursor = (offset: number) => Buffer.from(String(offset)).toString('base64url');
function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const n = Number(Buffer.from(cursor, 'base64url').toString());
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

async function whereFor(f: IssueListFilters): Promise<Prisma.ContentIssueWhereInput> {
  const where: Prisma.ContentIssueWhereInput = {};
  if (f.courseId) where.courseId = f.courseId;
  if (f.status && f.status !== 'ALL') where.status = f.status;
  if (f.targetType) where.targetType = f.targetType;
  if (f.origin) where.origin = f.origin;
  if (f.language) {
    const versions = await prisma.courseLanguageVersion.findMany({
      where: { language: f.language, ...(f.courseId ? { courseId: f.courseId } : {}) },
      select: { id: true },
    });
    where.languageVersionId = { in: versions.map((v) => v.id) };
  }
  return where;
}

/** Сквозные номера лекций версий (модуль, затем лекция). */
async function lectureNumbers(versionIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!versionIds.length) return out;
  const modules = await prisma.module.findMany({
    where: { courseLanguageVersionId: { in: versionIds } },
    orderBy: [{ courseLanguageVersionId: 'asc' }, { orderIndex: 'asc' }],
    select: { courseLanguageVersionId: true, lectures: { orderBy: { orderIndex: 'asc' }, select: { id: true } } },
  });
  const counters = new Map<string, number>();
  for (const m of modules) {
    for (const l of m.lectures) {
      const n = (counters.get(m.courseLanguageVersionId) ?? 0) + 1;
      counters.set(m.courseLanguageVersionId, n);
      out.set(l.id, n);
    }
  }
  return out;
}

/** Превью объектов группами по типу (без N+1). */
async function previewsFor(groups: readonly { targetType: ContentIssueTarget; targetId: string }[]): Promise<Map<string, IssuePreview>> {
  const ids = (t: ContentIssueTarget) => groups.filter((g) => g.targetType === t).map((g) => g.targetId);
  const out = new Map<string, IssuePreview>();
  const key = (t: string, id: string) => `${t}:${id}`;

  const qIds = ids('QUIZ_QUESTION');
  if (qIds.length) {
    const rows = await prisma.quizQuestion.findMany({
      where: { id: { in: qIds } },
      select: { id: true, prompt: true, options: true, correctOptionIds: true, canonicalKey: true, archivedAt: true, quizId: true, quiz: { select: { title: true } } },
    });
    for (const q of rows) {
      out.set(key('QUIZ_QUESTION', q.id), {
        kind: 'QUIZ_QUESTION',
        prompt: q.prompt,
        options: (q.options as string[]) ?? [],
        correctOptionIds: (q.correctOptionIds as number[]) ?? [],
        quizId: q.quizId,
        quizTitle: q.quiz.title,
        canonicalKey: q.canonicalKey,
        archived: q.archivedAt !== null,
      });
    }
  }
  const mIds = ids('CHAT_MESSAGE');
  if (mIds.length) {
    const rows = await prisma.chatMessage.findMany({ where: { id: { in: mIds } }, select: { id: true, content: true, role: true, sessionId: true } });
    for (const m of rows) {
      const excerpt = m.content.length > 300 ? `${m.content.slice(0, 299)}…` : m.content;
      out.set(key('CHAT_MESSAGE', m.id), { kind: 'CHAT_MESSAGE', excerpt, sessionId: m.sessionId, role: m.role });
    }
  }
  const lIds = ids('LECTURE');
  if (lIds.length) {
    const rows = await prisma.lecture.findMany({ where: { id: { in: lIds } }, select: { id: true, title: true, module: { select: { courseLanguageVersionId: true } } } });
    const numbers = await lectureNumbers([...new Set(rows.map((r) => r.module.courseLanguageVersionId))]);
    for (const l of rows) out.set(key('LECTURE', l.id), { kind: 'LECTURE', title: l.title, lectureNumber: numbers.get(l.id) ?? null });
  }
  const pIds = ids('PRACTICAL_TASK');
  if (pIds.length) {
    const rows = await prisma.practicalTask.findMany({ where: { id: { in: pIds } }, select: { id: true, title: true } });
    for (const p of rows) out.set(key('PRACTICAL_TASK', p.id), { kind: 'PRACTICAL_TASK', title: p.title });
  }
  return out;
}

/**
 * GET /content-issues — очередь, сгруппированная по объекту (targetType, targetId),
 * группы — по последней жалобе (сначала свежие), курсор — по группам.
 */
export async function listIssues(f: IssueListFilters): Promise<{ items: IssueGroup[]; nextCursor: string | null }> {
  const where = await whereFor(f);
  const offset = decodeCursor(f.cursor);
  const groups = await prisma.contentIssue.groupBy({
    by: ['targetType', 'targetId'],
    where,
    _max: { createdAt: true },
    orderBy: [{ _max: { createdAt: 'desc' } }, { targetId: 'asc' }],
    skip: offset,
    take: f.limit + 1,
  });
  const page = groups.slice(0, f.limit);
  if (!page.length) return { items: [], nextCursor: null };

  const rows = (await prisma.contentIssue.findMany({
    where: { AND: [where, { OR: page.map((g) => ({ targetType: g.targetType, targetId: g.targetId })) }] },
    orderBy: { createdAt: 'desc' },
    select: { id: true, origin: true, reporterId: true, reason: true, comment: true, context: true, status: true, createdAt: true, courseId: true, languageVersionId: true, targetType: true, targetId: true },
  })) as IssueRow[];
  const byKey = new Map<string, IssueRow[]>();
  for (const r of rows) {
    const k = `${r.targetType}:${r.targetId}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(r);
  }
  const previews = await previewsFor(page);
  const versionIds = [...new Set(rows.map((r) => r.languageVersionId).filter((v): v is string => !!v))];
  const versions = versionIds.length
    ? await prisma.courseLanguageVersion.findMany({ where: { id: { in: versionIds } }, select: { id: true, language: true } })
    : [];
  const langOf = new Map(versions.map((v) => [v.id, v.language]));

  const items: IssueGroup[] = [];
  for (const g of page) {
    const k = `${g.targetType}:${g.targetId}`;
    const groupRows = byKey.get(k);
    if (!groupRows?.length) continue;
    const base = groupIssueRows(groupRows);
    items.push({ ...base, language: base.languageVersionId ? (langOf.get(base.languageVersionId) ?? null) : null, preview: previews.get(k) ?? null });
  }
  return { items, nextCursor: groups.length > f.limit ? encodeCursor(offset + f.limit) : null };
}

/** Поля закрытия жалобы: закрытая — кто и когда; переоткрытая — сброс. */
export function statusPatch(status: ContentIssueStatus, actorId: string, note: string | undefined, now = new Date()) {
  const closing = status !== 'OPEN';
  return {
    status,
    resolvedById: closing ? actorId : null,
    resolvedAt: closing ? now : null,
    ...(note !== undefined ? { note: note.trim() || null } : {}),
  };
}

/** GET /content-issues/summary — открытые жалобы и открытые системные отметки (бейдж навигации). */
export async function issueSummary(courseId?: string): Promise<{ open: number; openSystem: number }> {
  const base = { status: 'OPEN' as const, ...(courseId ? { courseId } : {}) };
  const [open, openSystem] = await Promise.all([
    prisma.contentIssue.count({ where: base }),
    prisma.contentIssue.count({ where: { ...base, origin: 'SYSTEM' } }),
  ]);
  return { open, openSystem };
}
