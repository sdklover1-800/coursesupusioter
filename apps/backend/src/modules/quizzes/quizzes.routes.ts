import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  Role,
  QuestionType,
  Difficulty,
  QuizReviewPolicy,
  QuizScoringRule,
  ApiErrorCode,
  timecodeToSeconds,
  type Language,
} from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { Errors } from '../../lib/errors.js';
import { requireConsent } from '../../plugins/consentGate.js';
import { getGateway } from '../../llm/gateway.js';
import { quizGenerationSchema } from '../../llm/schemas/generation.js';
import { quizGenSystemPrompt } from '../../llm/prompts.js';
import { env } from '../../config/env.js';
import { audit } from '../../telemetry/events.js';
import { loadOwnedEnrollment, assertLectureInEnrollment } from '../learn/access.js';
import { llmRateLimit } from '../../plugins/rateLimits.js';
import {
  attemptHistory,
  attemptResult,
  attemptState,
  buildLobby,
  legacySubmit,
  loadQuiz,
  practiceCheck,
  practiceSet,
  saveAnswers,
  startAttempt,
  submitAttempt,
  versionLectures,
} from './attempts.service.js';
import { effectiveCooldownMinutes, frozenQuestionIds, sameIdSet, sameStrings } from './policy.js';

const managerGuard = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.COURSE_MANAGER, Role.ADMIN)] });
const studentGuard = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.STUDENT), requireConsent] });

/** Пояснение к варианту: строка (пустая → null) или null; индекс = id варианта. */
const rationaleSchema = z.array(z.string().max(2000).nullable()).max(6).nullable();

const questionInput = z.object({
  type: z.enum([QuestionType.SINGLE_CHOICE, QuestionType.TRUE_FALSE]),
  prompt: z.string().trim().min(1),
  options: z.array(z.string().trim().min(1)).min(2).max(6),
  correctOptionIds: z.array(z.number().int().nonnegative()).min(1),
  explanation: z.string().optional().nullable(),
  difficulty: z.enum([Difficulty.VERY_EASY, Difficulty.EASY, Difficulty.MEDIUM, Difficulty.HARD]).default('MEDIUM'),
  optionRationales: rationaleSchema.optional(),
  sourceLectureId: z.string().nullable().optional(),
  sourceTimecode: z.string().trim().max(12).nullable().optional(),
});

/** Метки TRUE_FALSE (индекс 0 = «верно») — если модель не вернула варианты. */
const TRUE_FALSE_LABELS: Record<Language, string[]> = {
  ru: ['Верно', 'Неверно'],
  kk: ['Дұрыс', 'Қате'],
  en: ['True', 'False'],
};

const quizFrozen = (message: string) => Errors.coded(409, ApiErrorCode.QUIZ_FROZEN, message);

/** Число попыток по тесту (любых, включая идущие) — тест с попытками заморожен. */
const attemptCountOf = (quizId: string) => prisma.quizAttempt.count({ where: { quizId } });

export async function quizRoutes(app: FastifyInstance): Promise<void> {
  const mgr = managerGuard(app);
  const stu = studentGuard(app);

  /* ── Менеджер: глубокое редактирование теста (FR-7.3) ── */

  // GET /quizzes/:id/edit[?includeArchived=1] — тест для редактора (С ключом) (менеджер):
  // заморозка, политика попыток, жалобы и экспертная проверка по вопросам, лекции версии.
  app.get('/quizzes/:id/edit', mgr, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { includeArchived } = parse(z.object({ includeArchived: z.enum(['0', '1', 'true', 'false']).optional() }), req.query);
    const withArchived = includeArchived === '1' || includeArchived === 'true';
    const loaded = await loadQuiz(id);
    const { row } = loaded;
    const attempts = await prisma.quizAttempt.findMany({ where: { quizId: id }, select: { presentation: true, answers: true } });
    const frozenIds = frozenQuestionIds(attempts);
    const questions = row.questions
      .filter((q) => withArchived || q.archivedAt === null)
      .sort((a, b) => a.orderIndex - b.orderIndex);
    const issues = questions.length
      ? await prisma.contentIssue.groupBy({
          by: ['targetId', 'origin'],
          where: { targetType: 'QUIZ_QUESTION', status: 'OPEN', targetId: { in: questions.map((q) => q.id) } },
          _count: { _all: true },
        })
      : [];
    const openStudent = new Map<string, number>();
    const pendingSystem = new Set<string>();
    for (const g of issues) {
      if (g.origin === 'STUDENT') openStudent.set(g.targetId, g._count._all);
      else pendingSystem.add(g.targetId);
    }
    const lectures = await versionLectures(loaded.versionId);
    const { questions: _all, module: _m, lecture: _l, ...quizFields } = row;
    return {
      quiz: {
        ...quizFields,
        frozen: attempts.length > 0,
        attemptCount: attempts.length,
        effectiveCooldownMinutes: effectiveCooldownMinutes(row.cooldownMinutes, env.QUIZ_COOLDOWN_MINUTES),
        lectures: lectures.map((l) => ({ id: l.id, title: l.title, lectureNumber: l.lectureNumber })),
        questions: questions.map((q) => ({
          ...q,
          frozen: frozenIds.has(q.id),
          openIssueCount: openStudent.get(q.id) ?? 0,
          reviewPending: pendingSystem.has(q.id),
        })),
      },
    };
  });

  // PATCH /quizzes/:id — порог, попытки (FR-5.4, FR-5.6), политика разбора, правило
  // зачёта и пауза (USER_DECISIONS §1). При наличии попыток порог и правило зачёта
  // заморожены, попытки можно только увеличить. Изменения — в аудит.
  app.patch('/quizzes/:id', mgr, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const data = parse(
      z.object({
        title: z.string().trim().min(1).max(300).optional(),
        passThreshold: z.number().min(0).max(1).optional(),
        maxAttempts: z.number().int().min(1).max(10).optional(),
        reviewPolicy: z.enum([QuizReviewPolicy.FULL_AFTER_FINAL, QuizReviewPolicy.SCORE_UNTIL_FINAL, QuizReviewPolicy.SCORE_ONLY]).optional(),
        scoringRule: z.enum([QuizScoringRule.BEST, QuizScoringRule.FIRST]).optional(),
        // 0 — без паузы; null — по умолчанию (env QUIZ_COOLDOWN_MINUTES); ≤ 7 суток
        cooldownMinutes: z.number().int().min(0).max(10080).nullable().optional(),
      }),
      req.body,
    );
    const existing = await prisma.quiz.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('Тест не найден');
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(data) as (keyof typeof data)[]) {
      if (data[key] !== undefined && data[key] !== existing[key]) changes[key] = { from: existing[key], to: data[key] };
    }
    if (Object.keys(changes).length === 0) return { quiz: existing };
    const attemptCount = await attemptCountOf(id);
    if (attemptCount > 0) {
      if (changes.passThreshold) throw quizFrozen('По тесту уже есть попытки — порог сдачи изменить нельзя');
      if (changes.scoringRule) throw quizFrozen('По тесту уже есть попытки — правило зачёта изменить нельзя');
      if (changes.maxAttempts && (data.maxAttempts ?? 0) < existing.maxAttempts) {
        throw quizFrozen('По тесту уже есть попытки — число попыток можно только увеличить');
      }
    }
    const patch = Object.fromEntries(Object.keys(changes).map((k) => [k, data[k as keyof typeof data]]));
    const quiz = await prisma.quiz.update({ where: { id }, data: patch as Prisma.QuizUpdateInput });
    await audit({ actorId: req.user!.id, action: 'QUIZ_SETTINGS_UPDATED', targetType: 'Quiz', targetId: id, detail: { changes, attemptCount } });
    return { quiz };
  });

  // POST /quizzes/:id/questions — добавить вопрос вручную (FR-7.3). Тест с попытками заморожен.
  app.post('/quizzes/:id/questions', mgr, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const data = parse(questionInput, req.body);
    const loaded = await loadQuiz(id);
    if ((await attemptCountOf(id)) > 0) throw quizFrozen('По тесту уже есть попытки — добавлять вопросы нельзя');
    validateCorrectIndexes(data.options.length, data.correctOptionIds, data.type);
    const extra = await validateExtras(loaded.versionId, data.options.length, data);
    // Следующий индекс после действующих (архивные вынесены в диапазон 10000+).
    const maxActive = loaded.active.reduce((m, q) => Math.max(m, q.orderIndex), -1);
    const question = await prisma.quizQuestion.create({
      data: { quizId: id, ...toDb(data), ...extra, orderIndex: maxActive + 1, isAIGenerated: false, isEdited: true },
    });
    await audit({ actorId: req.user!.id, action: 'QUIZ_QUESTION_CREATED', targetType: 'QuizQuestion', targetId: question.id, detail: { quizId: id } });
    return { question };
  });

  // PATCH /quiz-questions/:id — правка (FR-7.3). Замороженный вопрос (он показан или
  // отвечен в какой-либо попытке): можно менять формулировку, пояснения, обоснования
  // вариантов и источник, но не варианты, ключ и тип (409 QUIZ_FROZEN).
  app.patch('/quiz-questions/:id', mgr, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const data = parse(questionInput.partial(), req.body);
    const existing = await prisma.quizQuestion.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('Вопрос не найден');
    if (existing.archivedAt) throw Errors.conflict('Архивный вопрос не редактируется');
    const loaded = await loadQuiz(existing.quizId);
    const attempts = await prisma.quizAttempt.findMany({ where: { quizId: existing.quizId }, select: { presentation: true, answers: true } });
    const frozen = frozenQuestionIds(attempts).has(id);

    const oldOptions = (existing.options as string[]) ?? [];
    const oldCorrect = (existing.correctOptionIds as number[]) ?? [];
    const typeChanged = data.type !== undefined && data.type !== existing.type;
    // Сравнение без учёта крайних пробелов: сохранение формы целиком не считается правкой вариантов.
    const optionsChanged = data.options !== undefined && !sameStrings(data.options, oldOptions.map((o) => String(o).trim()));
    const correctChanged = data.correctOptionIds !== undefined && !sameIdSet(data.correctOptionIds, oldCorrect);
    if (frozen && (typeChanged || optionsChanged || correctChanged)) {
      throw quizFrozen('По вопросу уже есть попытки — варианты, ключ и тип изменить нельзя');
    }
    const type = (data.type ?? existing.type) as 'SINGLE_CHOICE' | 'TRUE_FALSE';
    const options = data.options ?? oldOptions;
    const correct = data.correctOptionIds ?? oldCorrect;
    if (typeChanged || optionsChanged || correctChanged) validateCorrectIndexes(options.length, correct, type);
    const extra = await validateExtras(loaded.versionId, options.length, data);
    // Варианты поменялись, а обоснования не присланы — старые обоснования больше не соответствуют.
    const staleRationales = optionsChanged && data.optionRationales === undefined && existing.optionRationales !== null;

    const question = await prisma.quizQuestion.update({
      where: { id },
      data: {
        ...(typeChanged ? { type } : {}),
        ...(data.prompt ? { prompt: data.prompt } : {}),
        ...(optionsChanged ? { options } : {}),
        ...(correctChanged ? { correctOptionIds: correct } : {}),
        ...(data.explanation !== undefined ? { explanation: data.explanation } : {}),
        ...(data.difficulty ? { difficulty: data.difficulty } : {}),
        ...extra,
        ...(staleRationales ? { optionRationales: Prisma.DbNull } : {}),
        isEdited: true, // помечаем ручную правку (FR-7.4)
      },
    });
    const len = (v: unknown) => (typeof v === 'string' ? v.length : Array.isArray(v) ? v.reduce((s: number, x) => s + (typeof x === 'string' ? x.length : 0), 0) : 0);
    const fields = Object.keys(data).filter((k) => (data as Record<string, unknown>)[k] !== undefined);
    await audit({
      actorId: req.user!.id,
      action: 'QUIZ_QUESTION_UPDATED',
      targetType: 'QuizQuestion',
      targetId: id,
      detail: {
        quizId: existing.quizId,
        frozen,
        fields,
        lengths: {
          prompt: { before: len(existing.prompt), after: len(question.prompt) },
          explanation: { before: len(existing.explanation), after: len(question.explanation) },
          optionRationales: { before: len(existing.optionRationales), after: len(question.optionRationales) },
        },
      },
    });
    return { question };
  });

  // DELETE /quiz-questions/:id — удалить вопрос (FR-7.3). Тест с попытками заморожен.
  app.delete('/quiz-questions/:id', mgr, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const existing = await prisma.quizQuestion.findUnique({ where: { id }, select: { quizId: true, prompt: true } });
    if (!existing) throw Errors.notFound('Вопрос не найден');
    if ((await attemptCountOf(existing.quizId)) > 0) throw quizFrozen('По тесту уже есть попытки — удалять вопросы нельзя');
    await prisma.quizQuestion.delete({ where: { id } });
    await audit({ actorId: req.user!.id, action: 'QUIZ_QUESTION_DELETED', targetType: 'QuizQuestion', targetId: id, detail: { quizId: existing.quizId } });
    return { ok: true };
  });

  // POST /quiz-questions/:id/regenerate — перегенерация одного вопроса (FR-7.3, §11.2).
  // Тест с попытками заморожен; канонический вопрос (единый ru/kk/en) не перегенерируется.
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
    if (q.archivedAt) throw Errors.conflict('Архивный вопрос не перегенерируется');
    if ((await attemptCountOf(q.quizId)) > 0) throw quizFrozen('По тесту уже есть попытки — перегенерация вопросов недоступна');
    if (q.canonicalKey) {
      throw Errors.coded(409, ApiErrorCode.CANONICAL_LOCKED, 'Канонический вопрос (единый для ru/kk/en) не перегенерируется — исправьте формулировку вручную во всех языках');
    }
    // Источник материала зависит от вида теста (QuizKind): модуль / лекция / весь курс.
    const version =
      q.quiz.module?.languageVersion ?? q.quiz.lecture?.module.languageVersion ?? q.quiz.languageVersion ?? null;
    if (!version) throw Errors.notFound('Не найден источник материалов теста');
    const language = version.language as Language;
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
    const options = first.options ?? (first.type === 'TRUE_FALSE' ? TRUE_FALSE_LABELS[language] ?? TRUE_FALSE_LABELS.ru : []);
    const rationales = (first as { option_rationales?: string[] }).option_rationales;
    const updated = await prisma.quizQuestion.update({
      where: { id },
      data: {
        type: first.type,
        prompt: first.prompt,
        options,
        correctOptionIds: first.correct_option_indexes,
        explanation: first.explanation ?? null,
        difficulty: first.difficulty,
        optionRationales: rationales && rationales.length === options.length ? rationales : Prisma.DbNull,
        // Источник прежнего вопроса к новому не относится (кроме мини-квиза одной лекции).
        sourceLectureId: q.quiz.lecture?.id ?? null,
        sourceTimecode: null,
        isAIGenerated: true,
        isEdited: false,
      },
    });
    await audit({ actorId: req.user!.id, action: 'QUIZ_QUESTION_REGENERATED', targetType: 'QuizQuestion', targetId: id, detail: { quizId: q.quizId } });
    return { question: updated };
  });

  /* ── Студент: официальная попытка (USER_DECISIONS §1, FR-5.3–5.5) ── */

  // GET /quizzes/:id?enrollmentId — лобби теста (QuizLobby). У оцениваемого теста
  // вопросов нет: они приходят только в начатой попытке. QUIZ_STARTED здесь больше
  // не пишется — только при реальном старте попытки.
  app.get('/quizzes/:id', stu, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { enrollmentId } = parse(z.object({ enrollmentId: z.string() }), req.query);
    const enr = await loadOwnedEnrollment(req.user!.id, enrollmentId);
    const lobby = await buildLobby(req.user!.id, enr, id);
    return {
      ...lobby,
      /**
       * @deprecated — удалить после FE3: вид для старого QuizPage (без вопросов
       * оцениваемого теста), чтобы страница не падала до замены лобби.
       */
      quiz: {
        id: lobby.id,
        title: lobby.title,
        passThreshold: lobby.passThreshold,
        maxAttempts: lobby.maxAttempts,
        attemptsUsed: lobby.attemptsUsed,
        questions: (lobby.questions ?? []).map((q) => ({ ...q, difficulty: 'MEDIUM' })),
      },
    };
  });

  // POST /quizzes/:id/attempts/start {enrollmentId, integrityAck: true} → AttemptStart.
  // 409 COOLDOWN | ATTEMPTS_EXHAUSTED | QUIZ_ALREADY_PASSED, 422 INTEGRITY_ACK_REQUIRED.
  app.post('/quizzes/:id/attempts/start', stu, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ enrollmentId: z.string(), integrityAck: z.unknown().optional() }), req.body);
    const enr = await loadOwnedEnrollment(req.user!.id, body.enrollmentId);
    return startAttempt(req.user!.id, enr, id, body.integrityAck === true);
  });

  // GET /quiz-attempts/:id/state — идущая попытка (продолжение после обновления страницы).
  app.get('/quiz-attempts/:id/state', stu, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    return attemptState(req.user!.id, id);
  });

  // PATCH /quiz-attempts/:id/answers {answers, flagged} — автосохранение. Без телеметрии.
  app.patch('/quiz-attempts/:id/answers', stu, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(
      z.object({ answers: z.record(z.string(), z.unknown()), flagged: z.array(z.string()).max(200).default([]) }),
      req.body,
    );
    return saveAnswers(req.user!.id, id, body.answers, body.flagged);
  });

  // POST /quiz-attempts/:id/submit {answers} → AttemptResult. 409 ATTEMPT_SUBMITTED, 422 INVALID_ANSWERS.
  app.post('/quiz-attempts/:id/submit', stu, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ answers: z.record(z.string(), z.unknown()).optional() }), req.body ?? {});
    return submitAttempt(req.user!.id, id, body.answers);
  });

  // GET /quizzes/:id/attempts?enrollmentId → AttemptSummary[] (только отправленные).
  app.get('/quizzes/:id/attempts', stu, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { enrollmentId } = parse(z.object({ enrollmentId: z.string() }), req.query);
    const enr = await loadOwnedEnrollment(req.user!.id, enrollmentId);
    return attemptHistory(enr, id);
  });

  // GET /quiz-attempts/:id → AttemptResult. Уровень разбора — по ТЕКУЩЕМУ состоянию:
  // полный ключ открывается, когда студент сдал тест или исчерпал попытки.
  app.get('/quiz-attempts/:id', stu, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    return attemptResult(req.user!.id, id);
  });

  // @deprecated — удалить после FE3. POST /quizzes/:id/attempts — одношаговая попытка
  // старого QuizPage: старт + отправка тем же сервисом (те же пауза, лимит, политика разбора).
  app.post('/quizzes/:id/attempts', stu, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ enrollmentId: z.string(), answers: z.record(z.string(), z.unknown()) }), req.body);
    const enr = await loadOwnedEnrollment(req.user!.id, body.enrollmentId);
    return legacySubmit(req.user!.id, enr, id, body.answers);
  });

  /* ── Студент: тренировка (USER_DECISIONS §2) ── */

  // GET /lectures/:id/mini-quiz — тренировочный мини-квиз после лекции.
  // Возвращает вопросы БЕЗ правильных ответов; проверка — через /quizzes/:id/practice.
  app.get('/lectures/:id/mini-quiz', stu, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { enrollmentId } = parse(z.object({ enrollmentId: z.string() }), req.query);
    const enr = await loadOwnedEnrollment(req.user!.id, enrollmentId);
    await assertLectureInEnrollment(id, enr);
    const quiz = await prisma.quiz.findUnique({ where: { lectureId: id }, include: { questions: { where: { archivedAt: null }, orderBy: { orderIndex: 'asc' } } } });
    if (!quiz) return { quiz: null };
    return { quiz: publicQuizView(quiz) };
  });

  // GET /language-versions/:id/final-mini-quiz — итоговый тренировочный мини-квиз курса.
  app.get('/language-versions/:id/final-mini-quiz', stu, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { enrollmentId } = parse(z.object({ enrollmentId: z.string() }), req.query);
    const enr = await loadOwnedEnrollment(req.user!.id, enrollmentId);
    if (enr.languageVersionId !== id) throw Errors.forbidden('Версия не относится к вашей записи');
    const quiz = await prisma.quiz.findUnique({ where: { courseLanguageVersionId: id }, include: { questions: { where: { archivedAt: null }, orderBy: { orderIndex: 'asc' } } } });
    if (!quiz) return { quiz: null };
    return { quiz: publicQuizView(quiz) };
  });

  // GET /modules/:id/practice-set?enrollmentId — «Тренировка по модулю» (PracticeSet).
  app.get('/modules/:id/practice-set', stu, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { enrollmentId } = parse(z.object({ enrollmentId: z.string() }), req.query);
    const enr = await loadOwnedEnrollment(req.user!.id, enrollmentId);
    return practiceSet(enr, id);
  });

  // POST /quizzes/:id/practice — ТРЕНИРОВОЧНАЯ проверка одного вопроса (PracticeCheck).
  // Не создаёт попытку и НЕ логируется в телеметрию (валидность исследования).
  // Вопросы оцениваемого теста — только после его финала (403 PRACTICE_LOCKED):
  // иначе тренировка раскрывала бы ключ официальной попытки.
  app.post('/quizzes/:id/practice', stu, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    // H2: enrollmentId обязателен — владение и принадлежность теста курсу проверяются.
    const body = parse(
      z.object({ enrollmentId: z.string(), questionId: z.string(), selectedOptionIds: z.array(z.number().int()).min(1).max(6) }),
      req.body,
    );
    const enr = await loadOwnedEnrollment(req.user!.id, body.enrollmentId);
    return practiceCheck(enr, id, body.questionId, body.selectedOptionIds);
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

/**
 * Проверка и нормализация полей разбора: обоснования вариантов (по одному на вариант,
 * пустая строка → null), лекция-источник (той же языковой версии) и таймкод (mm:ss).
 */
async function validateExtras(
  versionId: string | null,
  optionCount: number,
  d: { optionRationales?: (string | null)[] | null; sourceLectureId?: string | null; sourceTimecode?: string | null },
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  if (d.optionRationales !== undefined) {
    if (d.optionRationales === null) out.optionRationales = Prisma.DbNull;
    else {
      if (d.optionRationales.length !== optionCount) throw Errors.badRequest('Обоснований должно быть столько же, сколько вариантов');
      const clean = d.optionRationales.map((r) => (r && r.trim() ? r.trim() : null));
      out.optionRationales = clean.every((r) => r === null) ? Prisma.DbNull : clean;
    }
  }
  if (d.sourceLectureId !== undefined) {
    if (d.sourceLectureId) {
      const lecture = await prisma.lecture.findUnique({ where: { id: d.sourceLectureId }, select: { module: { select: { courseLanguageVersionId: true } } } });
      if (!lecture || lecture.module.courseLanguageVersionId !== versionId) throw Errors.badRequest('Лекция-источник не относится к версии теста');
    }
    out.sourceLectureId = d.sourceLectureId || null;
  }
  if (d.sourceTimecode !== undefined) {
    if (d.sourceTimecode && timecodeToSeconds(d.sourceTimecode) === null) throw Errors.badRequest('Таймкод источника — в формате мм:сс');
    out.sourceTimecode = d.sourceTimecode || null;
  }
  return out;
}

function validateCorrectIndexes(optionCount: number, correct: number[], type: 'SINGLE_CHOICE' | 'TRUE_FALSE'): void {
  for (const idx of correct) if (idx < 0 || idx >= optionCount) throw Errors.badRequest(`Индекс правильного ответа ${idx} вне диапазона`);
  if (new Set(correct).size !== correct.length) throw Errors.badRequest('Индексы правильных ответов повторяются');
  if (type === 'SINGLE_CHOICE' && correct.length !== 1) throw Errors.badRequest('SINGLE_CHOICE требует ровно один правильный вариант');
  if (type === 'TRUE_FALSE' && (optionCount !== 2 || correct.length !== 1)) throw Errors.badRequest('TRUE_FALSE требует 2 варианта и один правильный');
}
