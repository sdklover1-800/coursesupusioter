import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PracticalTask } from '@prisma/client';
import {
  ApiErrorCode,
  EventType,
  Role,
  Difficulty,
  practicalAttemptState,
  type Language,
  type PracticalLectureRef,
  type SessionDetail,
} from '@edu/shared';
import { practicalGenerationSchema, practicalRubricSchema } from '../../llm/schemas/generation.js';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { AppError, Errors } from '../../lib/errors.js';
import { requireConsent } from '../../plugins/consentGate.js';
import { orchestrator } from '../../llm/orchestrator.js';
import { getGateway } from '../../llm/gateway.js';
import { practicalGenSystemPrompt, practicalGenUserPrompt } from '../../llm/prompts.js';
import { env, practicalTokenBudget } from '../../config/env.js';
import { withLock } from '../../lib/lock.js';
import { llmRateLimit } from '../../plugins/rateLimits.js';
import { audit, logEvent } from '../../telemetry/events.js';
import { loadOwnedEnrollment, assertPracticalInEnrollment } from '../learn/access.js';
import { attemptInput, buildBrief, buildSessionDetail, buildSessionsView, turnDone, type SessionRow } from './sessions.view.js';

const managerGuard = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.COURSE_MANAGER, Role.ADMIN)] });
const studentContent = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.STUDENT), requireConsent] });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Частота SSE-события waiting, пока идут судья, тьютор и проверки (A23). */
const WAITING_INTERVAL_MS = 1500;

/* ── Данные для построителей DTO ───────────────────────────────── */

/** Сессии записи по заданию + число реплик СТУДЕНТА (засчёт попытки, A7). */
async function sessionRows(enrollmentId: string, practicalTaskId: string): Promise<SessionRow[]> {
  const rows = await prisma.practicalSession.findMany({
    where: { enrollmentId, practicalTaskId },
    orderBy: { startedAt: 'asc' },
    select: {
      id: true,
      status: true,
      verdictCode: true,
      verdictReason: true,
      aiMessageCount: true,
      maxAiMessages: true,
      startedAt: true,
      endedAt: true,
      summaryStatus: true,
      summary: true,
      evaluationResult: true,
      excusedAt: true,
      _count: { select: { messages: { where: { role: 'STUDENT' } } } },
    },
  });
  return rows.map(({ _count, ...r }) => ({ ...r, userMessageCount: _count.messages }));
}

type TaskRules = Pick<PracticalTask, 'maxSessions' | 'availableFrom' | 'availableUntil'>;

/** Полная сессия для студента: final — по правилу попыток (A6 — что открыть в оценке). */
async function sessionDetail(sessionId: string): Promise<SessionDetail> {
  const s = await prisma.practicalSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: {
      enrollmentId: true,
      practicalTaskId: true,
      practicalTask: { select: { maxSessions: true, availableFrom: true, availableUntil: true } },
    },
  });
  const rows = await sessionRows(s.enrollmentId, s.practicalTaskId);
  const row = rows.find((r) => r.id === sessionId)!;
  const final = practicalAttemptState(rows.map(attemptInput), s.practicalTask).final;
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, createdAt: true },
  });
  return buildSessionDetail(row, messages, final);
}

/** Бриф: разделы и лекции курса для листа «Конспекты лекций» (USER_DECISIONS §4). */
async function briefFor(task: PracticalTask & { module: { id: string; courseLanguageVersionId: string; coversWholeCourse: boolean; title: string; languageVersion: { language: string } } }) {
  const modules = await prisma.module.findMany({
    where: { courseLanguageVersionId: task.module.courseLanguageVersionId },
    orderBy: { orderIndex: 'asc' },
    select: { id: true, title: true, orderIndex: true, lectures: { orderBy: { orderIndex: 'asc' }, select: { id: true, title: true } } },
  });
  // Сквозная нумерация лекций 1..N: по порядку модулей, затем лекций.
  let n = 0;
  const lectures: (PracticalLectureRef & { moduleId: string })[] = [];
  for (const m of modules) for (const l of m.lectures) lectures.push({ id: l.id, title: l.title, lectureNumber: ++n, moduleOrderIndex: m.orderIndex, moduleId: m.id });
  const whole = task.module.coversWholeCourse;
  const scoped = whole ? lectures : lectures.filter((l) => l.moduleId === task.module.id);
  return buildBrief({
    id: task.id,
    title: task.title,
    scenarioPrompt: task.scenarioPrompt,
    agenda: task.agenda,
    estimatedMinutes: task.estimatedMinutes,
    maxAiMessages: task.maxAiMessages,
    maxSessions: task.maxSessions,
    language: task.module.languageVersion.language as Language,
    moduleTitles: whole ? modules.filter((m) => m.lectures.length > 0).map((m) => m.title) : [task.module.title],
    lectures: scoped.map(({ moduleId: _m, ...l }) => l),
  });
}

/**
 * Лок с ожиданием (StrictMode шлёт старт дважды): если лок занят, ждём до waitMs,
 * затем отдаём onTimeout() вместо 409. Ошибки ВНУТРИ fn пробрасываются как есть.
 */
async function withLockWait<T>(key: string, ttlMs: number, waitMs: number, fn: () => Promise<T>, onTimeout: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    let entered = false;
    try {
      return await withLock(key, ttlMs, async () => {
        entered = true;
        return fn();
      });
    } catch (err) {
      if (entered || !(err instanceof AppError) || err.statusCode !== 409) throw err;
      if (Date.now() >= deadline) return onTimeout();
      await sleep(150);
    }
  }
}

/** Сессия студента: владение, активность аккаунта, одобрение заявки, публикация (leftover a). */
async function loadOwnedSession(userId: string, sessionId: string) {
  const session = await prisma.practicalSession.findUnique({
    where: { id: sessionId },
    select: { id: true, enrollmentId: true, status: true, enrollment: { select: { user: { select: { cohortId: true } } } } },
  });
  if (!session) throw Errors.forbidden('Нет доступа');
  await loadOwnedEnrollment(userId, session.enrollmentId);
  return { id: session.id, enrollmentId: session.enrollmentId, status: session.status, cohortId: session.enrollment.user.cohortId };
}

export async function practicalRoutes(app: FastifyInstance): Promise<void> {
  /* ── Менеджер: глубокое редактирование практического задания (FR-7.3) ── */

  // PATCH /practical-tasks/:id — сценарий/эталон/рубрика/бюджет/сложность/бриф/попытки.
  app.patch('/practical-tasks/:id', managerGuard(app), async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const schema = z.object({
      title: z.string().min(1).optional(),
      scenarioPrompt: z.string().min(1).optional(),
      referenceSolution: z.string().min(1).optional(),
      rubricSpec: practicalRubricSchema.optional(),
      difficulty: z.enum([Difficulty.VERY_EASY, Difficulty.EASY, Difficulty.MEDIUM, Difficulty.HARD]).optional(),
      tokenBudget: z.number().int().positive().optional(),
      maxAiMessages: z.number().int().min(1).max(100).optional(),
      availableFrom: z.string().datetime().nullable().optional(),
      availableUntil: z.string().datetime().nullable().optional(),
      systemPromptTemplateId: z.string().optional(),
      // Бриф для студента и число попыток (USER_DECISIONS §4)
      agenda: z.array(z.string().trim().min(1).max(120)).max(3).optional(),
      estimatedMinutes: z.number().int().min(1).max(600).nullable().optional(),
      introMessage: z.string().trim().max(4000).nullable().optional(),
      maxSessions: z.number().int().min(1).max(5).optional(),
    });
    const data = parse(schema, req.body);
    const exists = await prisma.practicalTask.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw Errors.notFound('Задание не найдено');
    const task = await prisma.practicalTask.update({
      where: { id },
      data: {
        ...(data.title ? { title: data.title } : {}),
        ...(data.scenarioPrompt ? { scenarioPrompt: data.scenarioPrompt } : {}),
        ...(data.referenceSolution ? { referenceSolution: data.referenceSolution } : {}),
        ...(data.rubricSpec ? { rubricSpec: data.rubricSpec as object } : {}),
        ...(data.difficulty ? { difficulty: data.difficulty } : {}),
        ...(data.tokenBudget ? { tokenBudget: data.tokenBudget } : {}),
        ...(data.maxAiMessages ? { maxAiMessages: data.maxAiMessages } : {}),
        ...(data.availableFrom !== undefined ? { availableFrom: data.availableFrom ? new Date(data.availableFrom) : null } : {}),
        ...(data.availableUntil !== undefined ? { availableUntil: data.availableUntil ? new Date(data.availableUntil) : null } : {}),
        ...(data.systemPromptTemplateId ? { systemPromptTemplateId: data.systemPromptTemplateId } : {}),
        ...(data.agenda !== undefined ? { agenda: data.agenda } : {}),
        ...(data.estimatedMinutes !== undefined ? { estimatedMinutes: data.estimatedMinutes } : {}),
        ...(data.introMessage !== undefined ? { introMessage: data.introMessage || null } : {}),
        ...(data.maxSessions !== undefined ? { maxSessions: data.maxSessions } : {}),
        isEdited: true, // FR-7.4
      },
    });
    await audit({ actorId: req.user!.id, action: 'PRACTICAL_TASK_UPDATED', targetType: 'PracticalTask', targetId: id, detail: { fields: Object.keys(data) } }); // NFR-2.9
    return { task };
  });

  // GET /practical-tasks/:id — полное задание для редактора (включая скрытое) (менеджер).
  app.get('/practical-tasks/:id', managerGuard(app), async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const task = await prisma.practicalTask.findUnique({ where: { id } });
    if (!task) throw Errors.notFound('Задание не найдено');
    const sessionCount = await prisma.practicalSession.count({ where: { practicalTaskId: id } });
    return { task: { ...task, sessionCount } };
  });

  // POST /practical-tasks/:id/regenerate — перегенерация задания (FR-7.3).
  app.post('/practical-tasks/:id/regenerate', { ...managerGuard(app), config: llmRateLimit }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { force } = parse(z.object({ force: z.boolean().optional() }), req.body ?? {});
    const task = await prisma.practicalTask.findUnique({ where: { id }, include: { module: { include: { languageVersion: true } } } });
    if (!task) throw Errors.notFound('Задание не найдено');
    // Канонический межъязыковой сценарий (USER_DECISIONS §4) — перегенерация сломала бы
    // сопоставимость языковых групп. Снять защиту может только администратор явно.
    if (task.canonicalRef && !(force === true && req.user!.role === Role.ADMIN)) {
      throw Errors.coded(409, ApiErrorCode.CANONICAL_LOCKED, 'Канонический сценарий: перегенерация заблокирована', { canonicalRef: task.canonicalRef });
    }
    const version = task.module.languageVersion;
    const language = version.language as Language;
    const modules = await prisma.module.findMany({ where: { courseLanguageVersionId: version.id }, include: { lectures: { orderBy: { orderIndex: 'asc' } } }, orderBy: { orderIndex: 'asc' } });
    const transcripts = task.module.coversWholeCourse
      ? modules.map((m) => m.lectures.map((l) => l.transcriptText).join('\n\n')).join('\n\n')
      : (await prisma.lecture.findMany({ where: { moduleId: task.moduleId } })).map((l) => l.transcriptText).join('\n\n');

    const { data } = await getGateway().completeStructured(
      { model: env.LLM_MODEL_GENERATION, system: practicalGenSystemPrompt(language, task.difficulty as Difficulty), maxTokens: 8000, messages: [{ role: 'user', content: practicalGenUserPrompt({ transcripts, courseTitle: version.title }) }] },
      practicalGenerationSchema,
      'practical_regen',
    );
    const updated = await prisma.practicalTask.update({
      where: { id },
      data: { scenarioPrompt: data.student_facing_scenario, referenceSolution: data.reference_solution, rubricSpec: data.rubric as object, tokenBudget: practicalTokenBudget(data.recommended_token_budget, language), maxAiMessages: data.recommended_max_ai_messages, isAIGenerated: true, isEdited: false },
    });
    await audit({ actorId: req.user!.id, action: 'PRACTICAL_TASK_REGENERATED', targetType: 'PracticalTask', targetId: id, detail: { forced: Boolean(task.canonicalRef && force), canonicalRef: task.canonicalRef } });
    return { task: updated };
  });

  // POST /practical-sessions/:id/excuse — сотрудник освобождает завершённую сессию: она
  // не считается попыткой (A7, напр. сбой не по вине студента). Аудируется.
  app.post('/practical-sessions/:id/excuse', managerGuard(app), async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { note } = parse(z.object({ note: z.string().trim().min(1).max(500) }), req.body);
    const session = await prisma.practicalSession.findUnique({ where: { id }, select: { id: true, status: true, enrollmentId: true, excusedAt: true } });
    if (!session) throw Errors.notFound('Сессия не найдена');
    if (session.status === 'IN_PROGRESS') throw Errors.conflict('Сессия ещё идёт — освободить можно только завершённую');
    const updated = session.excusedAt
      ? await prisma.practicalSession.findUniqueOrThrow({ where: { id } })
      : await prisma.practicalSession.update({ where: { id }, data: { excusedAt: new Date(), excusedById: req.user!.id } });
    if (!session.excusedAt) {
      await audit({ actorId: req.user!.id, action: 'PRACTICAL_SESSION_EXCUSED', targetType: 'PracticalSession', targetId: id, detail: { note, enrollmentId: session.enrollmentId } });
    }
    return { session: { id: updated.id, status: updated.status, verdictCode: updated.verdictCode, excusedAt: updated.excusedAt, excusedById: updated.excusedById } };
  });

  /* ── Студент: сократическая сессия (FR-6.*, §5.4) ── */

  // GET /practical-tasks/:id/sessions?enrollmentId — бриф + сессии + можно ли начать.
  // БЕЗ побочных эффектов: открытие страницы сессию не создаёт (находка j).
  app.get('/practical-tasks/:id/sessions', studentContent(app), async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { enrollmentId } = parse(z.object({ enrollmentId: z.string().min(1) }), req.query);
    const enr = await loadOwnedEnrollment(req.user!.id, enrollmentId);
    await assertPracticalInEnrollment(id, enr);
    const task = await prisma.practicalTask.findUniqueOrThrow({
      where: { id },
      include: { module: { select: { id: true, courseLanguageVersionId: true, coversWholeCourse: true, title: true, languageVersion: { select: { language: true } } } } },
    });
    const brief = await briefFor(task);
    return buildSessionsView(brief, await sessionRows(enrollmentId, id), task);
  });

  // POST /practical-tasks/:id/sessions — ЯВНЫЙ старт (или возврат активной) сессии.
  app.post('/practical-tasks/:id/sessions', { ...studentContent(app), config: llmRateLimit }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { enrollmentId } = parse(z.object({ enrollmentId: z.string().min(1) }), req.body);
    const userId = req.user!.id;
    // Владение + активность + одобрение заявки + опубликованность + задание из этой версии (H2).
    const enr = await loadOwnedEnrollment(userId, enrollmentId);
    await assertPracticalInEnrollment(id, enr);
    const task = await prisma.practicalTask.findUniqueOrThrow({ where: { id } });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { cohortId: true } });

    const findActive = () => prisma.practicalSession.findFirst({ where: { enrollmentId, practicalTaskId: id, status: 'IN_PROGRESS' } });
    // Старт под локом на пользователя (H5): исключаем гонку «одна активная сессия».
    const session = await withLockWait(
      `practical-start:${userId}`,
      15_000,
      3_000,
      async () => {
        const rows = await sessionRows(enrollmentId, id);
        const state = practicalAttemptState(rows.map(attemptInput), task as TaskRules);
        if (state.activeSessionId) return prisma.practicalSession.findUniqueOrThrow({ where: { id: state.activeSessionId } });
        if (state.passed) throw Errors.coded(409, ApiErrorCode.ALREADY_PASSED, 'Практикум уже сдан — новая сессия не нужна');
        if (state.lock) throw Errors.coded(409, ApiErrorCode.NOT_AVAILABLE, 'Задание сейчас недоступно (вне окна доступности)', { lock: state.lock });
        if (!state.canStart) {
          throw Errors.coded(409, ApiErrorCode.NO_SESSIONS_LEFT, 'Попытки практикума исчерпаны', { sessionsUsed: state.sessionsUsed, maxSessions: task.maxSessions });
        }
        const otherActive = await prisma.practicalSession.findFirst({ where: { enrollment: { userId }, status: 'IN_PROGRESS', practicalTaskId: { not: id } } });
        if (otherActive) throw Errors.conflict('У вас уже есть активная практическая сессия');
        return orchestrator.startSession({ enrollmentId, task, cohortId: user?.cohortId ?? null, userId });
      },
      async () => {
        // Параллельный старт всё ещё держит лок — отдаём уже созданную им сессию.
        const active = await findActive();
        if (active) return active;
        throw Errors.conflict('Сессия уже создаётся — повторите через пару секунд');
      },
    );
    return sessionDetail(session.id);
  });

  // GET /sessions/:id — состояние/история/итоговая оценка (§11.3). Вывода судьи нет (A1).
  app.get('/sessions/:id', studentContent(app), async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    await loadOwnedSession(req.user!.id, id);
    return sessionDetail(id);
  });

  // POST /sessions/:id/end {reason} — завершение студентом. TECH_ISSUE — пауза, не итог.
  app.post('/sessions/:id/end', { ...studentContent(app), config: llmRateLimit }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { reason } = parse(z.object({ reason: z.enum(['DONE', 'TECH_ISSUE', 'OTHER']) }), req.body);
    const session = await loadOwnedSession(req.user!.id, id);
    if (session.status !== 'IN_PROGRESS') return sessionDetail(id); // уже завершена — идемпотентно

    if (reason === 'TECH_ISSUE') {
      // Пауза: сессия остаётся IN_PROGRESS и возобновляется (§5.7). Если студент не
      // вернётся, sweep закроет её как ABANDONED/IDLE_AFTER_PAUSE — и она засчитается (A7).
      await logEvent({
        eventType: EventType.PRACTICAL_SESSION_ENDED,
        userId: req.user!.id,
        sessionId: id,
        enrollmentId: session.enrollmentId,
        cohortId: session.cohortId,
        payload: { reason: 'TECH_ISSUE', paused: true },
      });
      return sessionDetail(id);
    }

    // Финальная оценка судьи по транскрипту — сериализуется с ходами той же сессии.
    await withLock(`session:${id}`, 5 * 60_000, () =>
      orchestrator.endSession({ sessionId: id, reason, userId: req.user!.id, cohortId: session.cohortId }),
    );
    return sessionDetail(id);
  });

  // POST /sessions/:id/messages — ход студента; ответ тьютора через SSE (§11.3).
  // Rate limit на дорогом ИИ-эндпоинте (NFR-2.8, аудит H4).
  app.post('/sessions/:id/messages', { ...studentContent(app), config: llmRateLimit }, async (req, reply) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ message: z.string().default(''), typingMs: z.number().int().nonnegative().optional() }), req.body);
    // Доступ проверяется ДО hijack SSE: деактивированный аккаунт получает честный 403 (leftover a).
    const session = await loadOwnedSession(req.user!.id, id);
    if (session.status !== 'IN_PROGRESS') throw Errors.conflict('Сессия уже завершена');

    // Сериализуем ходы одной сессии (H5): параллельные запросы иначе обходят лимит
    // реплик и портят учёт токенов. Лок берём ДО hijack, чтобы конкурентный ход
    // получил честный 409, а не «повисший» SSE.
    await withLock(`session:${id}`, 5 * 60_000, async () => {
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const send = (event: string, data: unknown) => {
        if (!reply.raw.destroyed) reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      send('open', { sessionId: id });
      // Реплика тьютора буферизуется до конца проверок (A21): пока идут судья,
      // подтверждение, тьютор и проверка утечки — ровный пульс waiting без деталей
      // (стадия не раскрывается: «идёт подтверждение» выдало бы вердикт судьи).
      send('waiting', {});
      const waiting = setInterval(() => send('waiting', {}), WAITING_INTERVAL_MS);

      try {
        const result = await orchestrator.handleStudentTurn({
          sessionId: id,
          studentText: body.message,
          typingMs: body.typingMs,
          userId: req.user!.id,
          cohortId: session.cohortId,
        });
        clearInterval(waiting);
        // Ровно один delta с окончательным (проверенным и сохранённым) текстом, затем done-allowlist (A1).
        send('delta', { text: result.tutorMessage });
        send('done', turnDone(result));
      } catch (err) {
        clearInterval(waiting);
        // Техническая ошибка ≠ FAILED (§5.7, FR-6.12): статус не меняется, лимит не расходуется.
        const code = err instanceof AppError ? err.code : 'INTERNAL';
        const message = err instanceof AppError ? err.message : 'Ассистент временно недоступен, попробуйте ещё раз';
        req.log.error({ err, sessionId: id }, 'Ошибка хода сократической сессии (сессия не провалена)');
        send('error', { code, message, recoverable: true });
      } finally {
        reply.raw.end();
      }
    });
  });
}
