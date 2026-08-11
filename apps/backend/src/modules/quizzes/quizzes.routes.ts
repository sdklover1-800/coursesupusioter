import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Role, QuestionType, Difficulty, EventType } from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { Errors } from '../../lib/errors.js';
import { requireConsent } from '../../plugins/consentGate.js';
import { getGateway } from '../../llm/gateway.js';
import { quizGenerationSchema } from '@edu/shared';
import { quizGenSystemPrompt } from '../../llm/prompts.js';
import { env } from '../../config/env.js';
import { logEvent } from '../../telemetry/events.js';
import { recomputeProgress } from '../learn/progress.service.js';
import { scoreQuiz, isAnswerCorrect } from './scoring.js';
import { loadOwnedEnrollment, assertQuizInEnrollment, assertLectureInEnrollment } from '../learn/access.js';
import { llmRateLimit } from '../../plugins/rateLimits.js';
import { withLock } from '../../lib/lock.js';

const managerGuard = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.COURSE_MANAGER, Role.ADMIN)] });
const studentGuard = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.STUDENT), requireConsent] });

const questionInput = z.object({
  type: z.enum([QuestionType.SINGLE_CHOICE, QuestionType.TRUE_FALSE]),
  prompt: z.string().min(1),
  options: z.array(z.string().min(1)).min(2).max(6),
  correctOptionIds: z.array(z.number().int().nonnegative()).min(1),
  explanation: z.string().optional().nullable(),
  difficulty: z.enum([Difficulty.VERY_EASY, Difficulty.EASY, Difficulty.MEDIUM, Difficulty.HARD]).default('MEDIUM'),
});

export async function quizRoutes(app: FastifyInstance): Promise<void> {
  const mgr = managerGuard(app);
  const stu = studentGuard(app);

  /* ── Менеджер: глубокое редактирование теста (FR-7.3) ── */

  // GET /quizzes/:id/edit — полный тест для редактора (С правильными ответами) (менеджер).
  app.get('/quizzes/:id/edit', mgr, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const quiz = await prisma.quiz.findUnique({ where: { id }, include: { questions: { orderBy: { orderIndex: 'asc' } } } });
    if (!quiz) throw Errors.notFound('Тест не найден');
    return { quiz };
  });

  // PATCH /quizzes/:id — порог сдачи, попытки (FR-5.4, FR-5.6).
  app.patch('/quizzes/:id', mgr, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const data = parse(z.object({ title: z.string().optional(), passThreshold: z.number().min(0).max(1).optional(), maxAttempts: z.number().int().min(1).optional() }), req.body);
    const quiz = await prisma.quiz.update({ where: { id }, data });
    return { quiz };
  });

  // POST /quizzes/:id/questions — добавить вопрос вручную (FR-7.3).
  app.post('/quizzes/:id/questions', mgr, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const data = parse(questionInput, req.body);
    validateCorrectIndexes(data.options.length, data.correctOptionIds, data.type);
    const count = await prisma.quizQuestion.count({ where: { quizId: id } });
    const question = await prisma.quizQuestion.create({
      data: { quizId: id, ...toDb(data), orderIndex: count, isAIGenerated: false, isEdited: true },
    });
    return { question };
  });

  // PATCH /quiz-questions/:id — правка (текст/варианты/ответы/сложность) (FR-7.3).
  app.patch('/quiz-questions/:id', mgr, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const data = parse(questionInput.partial(), req.body);
    const existing = await prisma.quizQuestion.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('Вопрос не найден');
    const options = data.options ?? (existing.options as string[]);
    const correct = data.correctOptionIds ?? (existing.correctOptionIds as number[]);
    if (data.options || data.correctOptionIds) validateCorrectIndexes(options.length, correct, data.type ?? (existing.type as 'SINGLE_CHOICE'));
    const question = await prisma.quizQuestion.update({
      where: { id },
      data: {
        ...(data.type ? { type: data.type } : {}),
        ...(data.prompt ? { prompt: data.prompt } : {}),
        ...(data.options ? { options: data.options } : {}),
        ...(data.correctOptionIds ? { correctOptionIds: data.correctOptionIds } : {}),
        ...(data.explanation !== undefined ? { explanation: data.explanation } : {}),
        ...(data.difficulty ? { difficulty: data.difficulty } : {}),
        isEdited: true, // помечаем ручную правку (FR-7.4)
      },
    });
    return { question };
  });

  // DELETE /quiz-questions/:id — удалить вопрос (FR-7.3).
  app.delete('/quiz-questions/:id', mgr, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    await prisma.quizQuestion.delete({ where: { id } });
    return { ok: true };
  });

  // POST /quiz-questions/:id/regenerate — перегенерация одного вопроса (FR-7.3, §11.2).
  app.post('/quiz-questions/:id/regenerate', { ...mgr, config: llmRateLimit }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const q = await prisma.quizQuestion.findUnique({
      where: { id },
      include: {
        quiz: {
          include: {
            module: { include: { languageVersion: true, lectures: true } },
            lecture: { include: { module: { include: { languageVersion: true } } } },
            languageVersion: { include: { modules: { include: { lectures: true } } } },
          },
        },
      },
    });
    if (!q) throw Errors.notFound('Вопрос не найден');
    // Источник материала зависит от вида теста (QuizKind): модуль / лекция / весь курс.
    const version =
      q.quiz.module?.languageVersion ?? q.quiz.lecture?.module.languageVersion ?? q.quiz.languageVersion ?? null;
    if (!version) throw Errors.notFound('Не найден источник материалов теста');
    const language = version.language as 'kk' | 'ru' | 'en';
    const transcripts = q.quiz.module
      ? q.quiz.module.lectures.map((l) => l.transcriptText).join('\n\n')
      : q.quiz.lecture
        ? q.quiz.lecture.transcriptText
        : (q.quiz.languageVersion?.modules ?? []).flatMap((m) => m.lectures.map((l) => l.transcriptText)).join('\n\n');
    const gateway = getGateway();
    const { data } = await gateway.completeStructured(
      { model: env.LLM_MODEL_GENERATION, system: quizGenSystemPrompt(language), maxTokens: 1200, messages: [{ role: 'user', content: `Сгенерируй ОДИН вопрос типа ${q.type} по материалам ниже, отличный от прежнего.\n\n${transcripts}` }] },
      quizGenerationSchema,
      'quiz_regen',
    );
    const first = data.questions[0];
    if (!first) throw Errors.upstream('Не удалось перегенерировать вопрос');
    const updated = await prisma.quizQuestion.update({
      where: { id },
      data: { type: first.type, prompt: first.prompt, options: first.options, correctOptionIds: first.correct_option_indexes, explanation: first.explanation ?? null, difficulty: first.difficulty, isAIGenerated: true, isEdited: false },
    });
    return { question: updated };
  });

  /* ── Студент: прохождение теста (FR-5.3–5.5) ── */

  // GET /quizzes/:id — тест для прохождения (БЕЗ правильных ответов).
  app.get('/quizzes/:id', stu, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const enrollmentId = parse(z.object({ enrollmentId: z.string() }), req.query).enrollmentId;
    const enr = await loadOwnedEnrollment(req.user!.id, enrollmentId);
    await assertQuizInEnrollment(id, enr); // H2: тест должен входить в курс студента
    const quiz = await prisma.quiz.findUnique({ where: { id }, include: { questions: { orderBy: { orderIndex: 'asc' } } } });
    if (!quiz) throw Errors.notFound('Тест не найден');
    const attempts = await prisma.quizAttempt.count({ where: { enrollmentId, quizId: id } });
    await logEvent({ eventType: EventType.QUIZ_STARTED, userId: req.user!.id, enrollmentId, payload: { quizId: id } });
    return {
      quiz: {
        id: quiz.id, title: quiz.title, passThreshold: quiz.passThreshold, maxAttempts: quiz.maxAttempts,
        attemptsUsed: attempts,
        questions: quiz.questions.map((q) => ({ id: q.id, type: q.type, prompt: q.prompt, options: q.options, difficulty: q.difficulty })),
      },
    };
  });

  // GET /lectures/:id/mini-quiz — тренировочный мини-квиз после лекции.
  // Возвращает вопросы БЕЗ правильных ответов; проверка — через /quizzes/:id/practice.
  app.get('/lectures/:id/mini-quiz', stu, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { enrollmentId } = parse(z.object({ enrollmentId: z.string() }), req.query);
    const enr = await loadOwnedEnrollment(req.user!.id, enrollmentId);
    await assertLectureInEnrollment(id, enr);
    const quiz = await prisma.quiz.findUnique({ where: { lectureId: id }, include: { questions: { orderBy: { orderIndex: 'asc' } } } });
    if (!quiz) return { quiz: null };
    return { quiz: publicQuizView(quiz) };
  });

  // GET /language-versions/:id/final-mini-quiz — итоговый тренировочный мини-квиз курса.
  app.get('/language-versions/:id/final-mini-quiz', stu, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { enrollmentId } = parse(z.object({ enrollmentId: z.string() }), req.query);
    const enr = await loadOwnedEnrollment(req.user!.id, enrollmentId);
    if (enr.languageVersionId !== id) throw Errors.forbidden('Версия не относится к вашей записи');
    const quiz = await prisma.quiz.findUnique({ where: { courseLanguageVersionId: id }, include: { questions: { orderBy: { orderIndex: 'asc' } } } });
    if (!quiz) return { quiz: null };
    return { quiz: publicQuizView(quiz) };
  });

  // POST /quizzes/:id/practice — ТРЕНИРОВОЧНАЯ проверка одного вопроса (интерактив).
  // Не создаёт попытку и НЕ логируется в телеметрию (валидность исследования сохранена).
  // Даёт студенту мгновенную обратную связь «чтобы понимать, что он делает».
  app.post('/quizzes/:id/practice', stu, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    // H2: требуем enrollmentId и проверяем владение + принадлежность теста курсу —
    // иначе тренировка раскрывала бы correctOptionIds любого теста любому студенту.
    const body = parse(z.object({ enrollmentId: z.string(), questionId: z.string(), selectedOptionIds: z.array(z.number().int()) }), req.body);
    const enr = await loadOwnedEnrollment(req.user!.id, body.enrollmentId);
    await assertQuizInEnrollment(id, enr);
    const question = await prisma.quizQuestion.findFirst({ where: { id: body.questionId, quizId: id } });
    if (!question) throw Errors.notFound('Вопрос не найден');
    const isCorrect = isAnswerCorrect(body.selectedOptionIds, question.correctOptionIds as number[]);
    // Тренировка раскрывает ответ и пояснение — но это НЕ оценивание.
    return { practice: true, isCorrect, correctOptionIds: question.correctOptionIds, explanation: question.explanation };
  });

  // POST /quizzes/:id/attempts — отправка ответов, серверная проверка (FR-5.4).
  app.post('/quizzes/:id/attempts', stu, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ enrollmentId: z.string(), answers: z.record(z.string(), z.array(z.number().int())) }), req.body);
    const enr = await loadOwnedEnrollment(req.user!.id, body.enrollmentId);
    await assertQuizInEnrollment(id, enr); // H2
    const quiz = await prisma.quiz.findUnique({ where: { id }, include: { questions: true } });
    if (!quiz) throw Errors.notFound('Тест не найден');
    // Мини-квизы тренировочные: попытки не создаются, балл не идёт в прогресс и
    // в оценочную телеметрию — так сохраняется валидность исследования.
    if (!quiz.isGraded) throw Errors.badRequest('Мини-квиз тренировочный и не оценивается');

    // Серверная проверка (авторитетная, §9.3) — чистая функция scoreQuiz.
    const scored = scoreQuiz(
      quiz.questions.map((q) => ({ id: q.id, correctOptionIds: q.correctOptionIds as number[], explanation: q.explanation })),
      body.answers,
      quiz.passThreshold,
    );

    // Лимит попыток атомарно (аудит M3): count+create под локом, иначе параллельные
    // отправки обходят maxAttempts (TOCTOU).
    const attempt = await withLock(`quiz-attempt:${body.enrollmentId}:${id}`, 15_000, async () => {
      const used = await prisma.quizAttempt.count({ where: { enrollmentId: body.enrollmentId, quizId: id } });
      if (used >= quiz.maxAttempts) throw Errors.conflict('Исчерпаны попытки прохождения теста');
      return prisma.quizAttempt.create({
        data: { enrollmentId: body.enrollmentId, quizId: id, answers: body.answers, score: scored.score, passed: scored.passed, submittedAt: new Date() },
      });
    });
    await logEvent({ eventType: EventType.QUIZ_SUBMITTED, userId: req.user!.id, enrollmentId: body.enrollmentId, payload: { quizId: id, score: scored.score, passed: scored.passed } });
    await recomputeProgress(body.enrollmentId);

    // Политика показа (FR-5.5): показываем балл, статус и пояснения к вопросам.
    return {
      attempt: { id: attempt.id, score: scored.score, passed: scored.passed, correctCount: scored.correctCount, total: scored.total },
      review: scored.review,
    };
  });
}

/* ── helpers ── */

/** Представление теста для студента: без правильных ответов и пояснений. */
function publicQuizView(quiz: { id: string; title: string; kind: string; isGraded: boolean; questions: { id: string; type: string; prompt: string; options: unknown; difficulty: string }[] }) {
  return {
    id: quiz.id,
    title: quiz.title,
    kind: quiz.kind,
    isGraded: quiz.isGraded,
    questions: quiz.questions.map((q) => ({ id: q.id, type: q.type, prompt: q.prompt, options: q.options, difficulty: q.difficulty })),
  };
}
function toDb(d: z.infer<typeof questionInput>) {
  return { type: d.type, prompt: d.prompt, options: d.options, correctOptionIds: d.correctOptionIds, explanation: d.explanation ?? null, difficulty: d.difficulty };
}

function validateCorrectIndexes(optionCount: number, correct: number[], type: 'SINGLE_CHOICE' | 'TRUE_FALSE'): void {
  for (const idx of correct) if (idx < 0 || idx >= optionCount) throw Errors.badRequest(`Индекс правильного ответа ${idx} вне диапазона`);
  if (type === 'SINGLE_CHOICE' && correct.length !== 1) throw Errors.badRequest('SINGLE_CHOICE требует ровно один правильный вариант');
  if (type === 'TRUE_FALSE' && (optionCount !== 2 || correct.length !== 1)) throw Errors.badRequest('TRUE_FALSE требует 2 варианта и один правильный');
}
