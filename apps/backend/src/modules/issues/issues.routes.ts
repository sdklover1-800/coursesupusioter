import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ContentIssueOrigin, ContentIssueStatus, ContentIssueTarget, Role } from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { Errors } from '../../lib/errors.js';
import { requireConsent } from '../../plugins/consentGate.js';
import { audit } from '../../telemetry/events.js';
import { ISSUE_COMMENT_MAX, issueSummary, listIssues, reportIssue, statusPatch } from './issues.service.js';

const targetEnum = z.enum([ContentIssueTarget.QUIZ_QUESTION, ContentIssueTarget.CHAT_MESSAGE, ContentIssueTarget.LECTURE, ContentIssueTarget.PRACTICAL_TASK]);
const statusEnum = z.enum([ContentIssueStatus.OPEN, ContentIssueStatus.RESOLVED, ContentIssueStatus.DISMISSED]);
const noteSchema = z.string().max(2000).optional();

/**
 * Жалобы на контент (ContentIssue): подача студентом и сотрудником, очередь и
 * разбор сотрудниками, пакетное закрытие отметок экспертной проверки.
 * SYSTEM-отметки через API не создаются (только контент-скрипты).
 */
export async function issuesRoutes(app: FastifyInstance): Promise<void> {
  // Студент — с согласием на исследование (гейт пропускает сотрудников).
  const reporterGuard = { preHandler: [app.authenticate, app.requireRole(Role.STUDENT, Role.COURSE_MANAGER, Role.ADMIN), requireConsent] };
  const staffGuard = { preHandler: [app.authenticate, app.requireRole(Role.COURSE_MANAGER, Role.ADMIN)] };

  // POST /content-issues (ContentIssueInput) → ТОЛЬКО {ok: true}: ответ никогда не
  // раскрывает верность ответа (жалоба возможна и во время официальной попытки).
  app.post('/content-issues', reporterGuard, async (req) => {
    const input = parse(
      z.object({
        targetType: targetEnum,
        targetId: z.string().min(1).max(64),
        reason: z.string().min(1).max(40),
        comment: z.string().max(ISSUE_COMMENT_MAX).optional(),
        context: z.string().min(1).max(40),
        enrollmentId: z.string().max(64).optional(),
      }),
      req.body,
    );
    return reportIssue({ id: req.user!.id, role: req.user!.role }, input);
  });

  // GET /content-issues?courseId&status&targetType&language&origin&cursor&limit — очередь
  // сотрудника, сгруппированная по объекту, с превью (у вопроса — с ключом).
  // status по умолчанию OPEN; ALL — все.
  app.get('/content-issues', staffGuard, async (req) => {
    const q = parse(
      z.object({
        courseId: z.string().optional(),
        status: z.enum([ContentIssueStatus.OPEN, ContentIssueStatus.RESOLVED, ContentIssueStatus.DISMISSED, 'ALL']).default('OPEN'),
        targetType: targetEnum.optional(),
        language: z.enum(['ru', 'kk', 'en']).optional(),
        origin: z.enum([ContentIssueOrigin.STUDENT, ContentIssueOrigin.SYSTEM]).optional(),
        cursor: z.string().max(64).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
      req.query,
    );
    return listIssues(q);
  });

  // GET /content-issues/summary?courseId? → {open, openSystem}. Без courseId — по всем
  // курсам (бейдж навигации сотрудника, A29).
  app.get('/content-issues/summary', staffGuard, async (req) => {
    const { courseId } = parse(z.object({ courseId: z.string().optional() }), req.query);
    return issueSummary(courseId);
  });

  // PATCH /content-issues/:id {status, note} — решено / отклонено / снова открыто. Аудит.
  app.patch('/content-issues/:id', staffGuard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ status: statusEnum, note: noteSchema }), req.body);
    const existing = await prisma.contentIssue.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('Жалоба не найдена');
    const issue = await prisma.contentIssue.update({ where: { id }, data: statusPatch(body.status, req.user!.id, body.note) });
    await audit({
      actorId: req.user!.id,
      action: 'CONTENT_ISSUE_STATUS_CHANGED',
      targetType: 'ContentIssue',
      targetId: id,
      detail: { from: existing.status, to: body.status, origin: existing.origin, issueTargetType: existing.targetType, issueTargetId: existing.targetId, hasNote: !!body.note?.trim() },
    });
    return { issue };
  });

  // POST /content-issues/bulk-status {ids[], status, note?} — пакетное закрытие
  // (партии экспертной проверки). Аудит одной записью.
  app.post('/content-issues/bulk-status', staffGuard, async (req) => {
    const body = parse(z.object({ ids: z.array(z.string().min(1)).min(1).max(500), status: statusEnum, note: noteSchema }), req.body);
    const ids = [...new Set(body.ids)];
    const res = await prisma.contentIssue.updateMany({ where: { id: { in: ids } }, data: statusPatch(body.status, req.user!.id, body.note) });
    await audit({
      actorId: req.user!.id,
      action: 'CONTENT_ISSUE_BULK_STATUS',
      targetType: 'ContentIssue',
      detail: { status: body.status, requested: ids.length, updated: res.count, ids: ids.slice(0, 200), hasNote: !!body.note?.trim() },
    });
    return { updated: res.count };
  });
}
