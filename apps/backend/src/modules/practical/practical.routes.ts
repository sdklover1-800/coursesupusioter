import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Role, Difficulty, practicalGenerationSchema, practicalRubricSchema, type Language } from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { Errors } from '../../lib/errors.js';
import { requireConsent } from '../../plugins/consentGate.js';
import { orchestrator } from '../../llm/orchestrator.js';
import { getGateway } from '../../llm/gateway.js';
import { practicalGenSystemPrompt, practicalGenUserPrompt } from '../../llm/prompts.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { withLock } from '../../lib/lock.js';
import { llmRateLimit } from '../../plugins/rateLimits.js';

const managerGuard = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.COURSE_MANAGER, Role.ADMIN)] });
const studentContent = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.STUDENT), requireConsent] });

export async function practicalRoutes(app: FastifyInstance): Promise<void> {
  /* ── Менеджер: глубокое редактирование практического задания (FR-7.3) ── */

  // PATCH /practical-tasks/:id — сценарий/эталон/рубрика/бюджет/сложность/системная инструкция.
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
    });
    const data = parse(schema, req.body);
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
        isEdited: true, // FR-7.4
      },
    });
    return { task };
  });

  // GET /practical-tasks/:id — полное задание для редактора (включая скрытое) (менеджер).
  app.get('/practical-tasks/:id', managerGuard(app), async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const task = await prisma.practicalTask.findUnique({ where: { id } });
    if (!task) throw Errors.notFound('Задание не найдено');
    return { task };
  });

  // POST /practical-tasks/:id/regenerate — перегенерация задания (FR-7.3).
  app.post('/practical-tasks/:id/regenerate', { ...managerGuard(app), config: llmRateLimit }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const task = await prisma.practicalTask.findUnique({ where: { id }, include: { module: { include: { languageVersion: true } } } });
    if (!task) throw Errors.notFound('Задание не найдено');
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
      data: { scenarioPrompt: data.student_facing_scenario, referenceSolution: data.reference_solution, rubricSpec: data.rubric as object, tokenBudget: data.recommended_token_budget, maxAiMessages: data.recommended_max_ai_messages, isAIGenerated: true, isEdited: false },
    });
    return { task: updated };
  });

  /* ── Студент: сократическая сессия (FR-6.*, §5.4) ── */

  // POST /practical-tasks/:id/sessions — старт/возобновление сессии (NFR-1.7).
  app.post('/practical-tasks/:id/sessions', { ...studentContent(app), config: llmRateLimit }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { enrollmentId } = parse(z.object({ enrollmentId: z.string() }), req.body);
    const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId }, include: { languageVersion: true, user: true } });
    if (!enrollment || enrollment.userId !== req.user!.id) throw Errors.forbidden('Нет доступа к записи');
    if (enrollment.languageVersion.status !== 'PUBLISHED') throw Errors.forbidden('Курс недоступен');

    const task = await prisma.practicalTask.findUnique({ where: { id }, include: { module: { select: { courseLanguageVersionId: true } } } });
    if (!task) throw Errors.notFound('Задание не найдено');
    if (task.module.courseLanguageVersionId !== enrollment.languageVersionId) throw Errors.forbidden('Задание не относится к вашему курсу'); // H2
    // NFR-1.8: окно доступности (если задано) — вне окна старт запрещён.
    const now = new Date();
    if ((task.availableFrom && now < task.availableFrom) || (task.availableUntil && now > task.availableUntil)) {
      throw Errors.conflict('Задание сейчас недоступно (вне окна доступности)');
    }

    // Старт под локом на пользователя (H5): исключаем гонку «одна активная сессия»
    // (TOCTOU findFirst→create), иначе двойной клик создаёт дубли IN_PROGRESS.
    const session = await withLock(`practical-start:${req.user!.id}`, 15_000, async () => {
      const otherActive = await prisma.practicalSession.findFirst({ where: { enrollment: { userId: req.user!.id }, status: 'IN_PROGRESS', practicalTaskId: { not: id } } });
      if (otherActive) throw Errors.conflict('У вас уже есть активная практическая сессия');
      return orchestrator.startSession({
        enrollmentId,
        task,
        language: enrollment.languageVersion.language as Language,
        cohortId: enrollment.user.cohortId,
        userId: req.user!.id,
      });
    });
    const messages = await prisma.chatMessage.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: 'asc' } });
    return { session: sessionView(session), messages: messages.map(msgView) };
  });

  // GET /sessions/:id — состояние/история/вердикт (§11.3).
  app.get('/sessions/:id', studentContent(app), async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const session = await prisma.practicalSession.findUnique({ where: { id }, include: { enrollment: true, messages: { orderBy: { createdAt: 'asc' } } } });
    if (!session || session.enrollment.userId !== req.user!.id) throw Errors.forbidden('Нет доступа');
    return { session: sessionView(session), messages: session.messages.map(msgView) };
  });

  // POST /sessions/:id/messages — ход студента; ответ ассистента потоково (SSE). §11.3
  // Rate limit на дорогом ИИ-эндпоинте (NFR-2.8, аудит H4).
  app.post('/sessions/:id/messages', { ...studentContent(app), config: llmRateLimit }, async (req, reply) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ message: z.string().default(''), typingMs: z.number().int().nonnegative().optional() }), req.body);
    const session = await prisma.practicalSession.findUnique({ where: { id }, include: { enrollment: { include: { user: true } } } });
    if (!session || session.enrollment.userId !== req.user!.id) throw Errors.forbidden('Нет доступа');

    // Сериализуем ходы одной сессии (H5): параллельные запросы иначе обходят лимит
    // реплик и портят учёт токенов. Лок берём ДО hijack, чтобы конкурентный ход
    // получил честный 409, а не «повисший» SSE.
    await withLock(`session:${id}`, 5 * 60_000, async () => {
      // SSE (NFR-1.4)
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send('open', { sessionId: id });

      // §5.7f: если модель отвечает дольше обычного (нет первого токена), шлём честный
      // статус ожидания, чтобы клиент показал «ассистент отвечает дольше обычного».
      let started = false;
      const waiting = setInterval(() => { if (!started) send('waiting', {}); }, 4000);

      try {
        const result = await orchestrator.handleStudentTurn({
          sessionId: id,
          studentText: body.message,
          typingMs: body.typingMs,
          userId: req.user!.id,
          cohortId: session.enrollment.user.cohortId,
          onDelta: (chunk) => { started = true; clearInterval(waiting); send('delta', { text: chunk }); },
        });
        clearInterval(waiting);
        // Пересчёт прогресса при завершении сессии
        if (result.status === 'PASSED' || result.status === 'FAILED') {
          const { recomputeProgress } = await import('../learn/progress.service.js');
          await recomputeProgress(session.enrollmentId);
        }
        send('done', result);
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

function sessionView(s: { id: string; status: string; aiMessageCount: number; maxAiMessages: number; tokensUsed: number; verdictReason: string | null; evaluationResult: unknown; startedAt: Date; endedAt: Date | null }) {
  return {
    id: s.id, status: s.status, aiMessageCount: s.aiMessageCount, maxAiMessages: s.maxAiMessages,
    remainingAiMessages: Math.max(0, s.maxAiMessages - s.aiMessageCount), // FR-6.7 (реплики, не токены)
    verdictReason: s.verdictReason, evaluationResult: s.evaluationResult, startedAt: s.startedAt, endedAt: s.endedAt,
  };
}

function msgView(m: { id: string; role: string; content: string; createdAt: Date }) {
  return { id: m.id, role: m.role, content: m.content, createdAt: m.createdAt };
}
