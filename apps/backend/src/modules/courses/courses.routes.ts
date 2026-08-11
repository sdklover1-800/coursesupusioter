import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LANGUAGES, Role, AssessmentType, DEFAULT_COURSE_STRUCTURE, GenerationType, Difficulty, RegenStrategy } from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { Errors } from '../../lib/errors.js';
import { extractYoutubeId } from '../../lib/youtube.js';
import { audit } from '../../telemetry/events.js';
import { enqueueGeneration } from '../../generation/enqueue.js';
import { llmRateLimit } from '../../plugins/rateLimits.js';

const langEnum = z.enum(LANGUAGES);
const managerOnly = (app: FastifyInstance) => ({ preHandler: [app.authenticate, app.requireRole(Role.COURSE_MANAGER, Role.ADMIN)] });

/**
 * Управление курсами и контентом (COURSE_MANAGER/ADMIN, §4.2–4.4).
 * Структура настраивается (FR-2.1), языковые версии независимы (FR-3.5).
 */
export async function courseRoutes(app: FastifyInstance): Promise<void> {
  const guard = managerOnly(app);

  // POST /courses — создать курс с базовой языковой версией и структурой модулей/лекций (FR-2.1, FR-2.2).
  app.post('/courses', guard, async (req) => {
    const moduleSchema = z.object({
      title: z.string().min(1),
      assessmentType: z.enum([AssessmentType.QUIZ, AssessmentType.PRACTICAL]),
      lectures: z.number().int().min(1).max(50),
      coversWholeCourse: z.boolean().optional(),
    });
    const schema = z.object({
      defaultLanguage: langEnum,
      title: z.string().min(1),
      description: z.string().optional(),
      // Если modules не заданы — применяется структура по умолчанию 3×5 (FR-2.1).
      modules: z.array(moduleSchema).optional(),
    });
    const data = parse(schema, req.body);

    const modules =
      data.modules ??
      Array.from({ length: DEFAULT_COURSE_STRUCTURE.modules }, (_, i) => ({
        title: `Модуль ${i + 1}`,
        // По умолчанию: модуль 1,2 → тест; модуль 3 → практическое, охватывает весь курс.
        assessmentType: i === DEFAULT_COURSE_STRUCTURE.modules - 1 ? AssessmentType.PRACTICAL : AssessmentType.QUIZ,
        lectures: DEFAULT_COURSE_STRUCTURE.lecturesPerModule,
        coversWholeCourse: i === DEFAULT_COURSE_STRUCTURE.modules - 1,
      }));

    const course = await prisma.course.create({
      data: {
        defaultLanguage: data.defaultLanguage,
        createdById: req.user!.id,
        languageVersions: {
          create: {
            language: data.defaultLanguage,
            title: data.title,
            description: data.description,
            modules: {
              create: modules.map((m, idx) => ({
                orderIndex: idx,
                title: m.title,
                assessmentType: m.assessmentType,
                coversWholeCourse: m.coversWholeCourse ?? false,
                lectures: {
                  create: Array.from({ length: m.lectures }, (_, li) => ({
                    orderIndex: li,
                    title: `Лекция ${li + 1}`,
                    youtubeVideoId: '',
                    transcriptText: '',
                  })),
                },
              })),
            },
          },
        },
      },
      include: { languageVersions: true },
    });
    await audit({ actorId: req.user!.id, action: 'COURSE_CREATED', targetType: 'Course', targetId: course.id });
    return { course };
  });

  // GET /courses — список курсов (со сводкой языковых версий).
  app.get('/courses', guard, async () => {
    const courses = await prisma.course.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { languageVersions: { select: { id: true, language: true, title: true, status: true } }, createdBy: { select: { name: true } } },
    });
    return { items: courses };
  });

  // GET /courses/:id — детали курса.
  app.get('/courses/:id', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const course = await prisma.course.findUnique({
      where: { id },
      include: {
        languageVersions: {
          include: { modules: { orderBy: { orderIndex: 'asc' }, include: { lectures: { orderBy: { orderIndex: 'asc' } }, quiz: { include: { questions: true } }, practicalTask: true } } },
        },
      },
    });
    if (!course) throw Errors.notFound('Курс не найден');
    return { course };
  });

  // POST /courses/:id/language-versions — добавить языковую версию (FR-3.1).
  app.post('/courses/:id/language-versions', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const schema = z.object({ language: langEnum, title: z.string().min(1), description: z.string().optional(), copyStructureFrom: z.string().optional() });
    const data = parse(schema, req.body);
    const course = await prisma.course.findUnique({ where: { id } });
    if (!course) throw Errors.notFound('Курс не найден');
    if (await prisma.courseLanguageVersion.findUnique({ where: { courseId_language: { courseId: id, language: data.language } } })) {
      throw Errors.conflict('Языковая версия уже существует');
    }
    // Копируем структуру (модули/лекции без контента) из существующей версии, если указано.
    let modulesCreate;
    if (data.copyStructureFrom) {
      const src = await prisma.courseLanguageVersion.findUnique({
        where: { id: data.copyStructureFrom },
        include: { modules: { orderBy: { orderIndex: 'asc' }, include: { lectures: { orderBy: { orderIndex: 'asc' } } } } },
      });
      modulesCreate = src?.modules.map((m) => ({
        orderIndex: m.orderIndex, title: m.title, assessmentType: m.assessmentType, coversWholeCourse: m.coversWholeCourse,
        lectures: { create: m.lectures.map((l) => ({ orderIndex: l.orderIndex, title: l.title, youtubeVideoId: '', transcriptText: '' })) },
      }));
    }
    const version = await prisma.courseLanguageVersion.create({
      data: { courseId: id, language: data.language, title: data.title, description: data.description, ...(modulesCreate ? { modules: { create: modulesCreate } } : {}) },
      include: { modules: true },
    });
    return { version };
  });

  // PATCH /language-versions/:id — правка версии (заголовок/описание).
  app.patch('/language-versions/:id', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const data = parse(z.object({ title: z.string().min(1).optional(), description: z.string().optional() }), req.body);
    const version = await prisma.courseLanguageVersion.update({ where: { id }, data });
    return { version };
  });

  // POST /modules/:id/lectures — добавить лекцию в существующий модуль (§11.2, FR-2.1).
  app.post('/modules/:id/lectures', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const data = parse(z.object({ title: z.string().min(1).optional(), youtubeUrl: z.string().optional(), transcriptText: z.string().optional() }), req.body);
    const mod = await prisma.module.findUnique({ where: { id }, include: { lectures: { orderBy: { orderIndex: 'desc' }, take: 1 } } });
    if (!mod) throw Errors.notFound('Модуль не найден');
    const nextIndex = (mod.lectures[0]?.orderIndex ?? -1) + 1;
    const lecture = await prisma.lecture.create({
      data: {
        moduleId: id,
        orderIndex: nextIndex,
        title: data.title ?? `Лекция ${nextIndex + 1}`,
        youtubeVideoId: data.youtubeUrl ? extractYoutubeId(data.youtubeUrl) : '',
        transcriptText: data.transcriptText ?? '',
      },
    });
    return { lecture };
  });

  // PATCH /lectures/:id — наполнение лекции (видео + расшифровка) (FR-2.4, FR-4.3).
  app.patch('/lectures/:id', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const data = parse(z.object({ title: z.string().min(1).optional(), youtubeUrl: z.string().optional(), transcriptText: z.string().optional() }), req.body);
    const update: Record<string, unknown> = {};
    if (data.title) update.title = data.title;
    if (data.youtubeUrl !== undefined) update.youtubeVideoId = data.youtubeUrl ? extractYoutubeId(data.youtubeUrl) : '';
    if (data.transcriptText !== undefined) update.transcriptText = data.transcriptText;
    const lecture = await prisma.lecture.update({ where: { id }, data: update });
    return { lecture };
  });

  // DELETE /lectures/:id — удалить лекцию из модуля (FR-2.1 — настраиваемость структуры).
  app.delete('/lectures/:id', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    await prisma.lecture.delete({ where: { id } });
    return { ok: true };
  });

  // POST /language-versions/:id/generate — запуск ИИ-генерации (FR-2.6, FR-7.1).
  // Rate limit на дорогом ИИ-эндпоинте (NFR-2.8, аудит H4).
  app.post('/language-versions/:id/generate', { ...guard, config: llmRateLimit }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const data = parse(
      z.object({
        type: z.enum([GenerationType.QUIZ, GenerationType.PRACTICAL, GenerationType.MINI, GenerationType.ALL]).default(GenerationType.ALL),
        moduleIds: z.array(z.string()).optional(),
        singleChoiceCount: z.number().int().min(1).max(20).optional(),
        trueFalseCount: z.number().int().min(0).max(20).optional(),
        difficulty: z.enum([Difficulty.VERY_EASY, Difficulty.EASY, Difficulty.MEDIUM, Difficulty.HARD]).optional(),
        regenStrategy: z.enum([RegenStrategy.OVERWRITE, RegenStrategy.APPEND, RegenStrategy.KEEP]).default(RegenStrategy.KEEP),
      }),
      req.body,
    );
    const version = await prisma.courseLanguageVersion.findUnique({ where: { id } });
    if (!version) throw Errors.notFound('Языковая версия не найдена');
    const job = await enqueueGeneration({ courseLanguageVersionId: id, type: data.type, params: data, createdById: req.user!.id });
    return { jobId: job.id, status: 'QUEUED' };
  });

  // GET /generation-jobs/:id — статус фоновой задачи (FR-7.1).
  app.get('/generation-jobs/:id', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const job = await prisma.generationJob.findUnique({ where: { id } });
    if (!job) throw Errors.notFound('Задача не найдена');
    return { job };
  });

  // GET /language-versions/:id/generation-jobs — история задач по версии.
  app.get('/language-versions/:id/generation-jobs', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const jobs = await prisma.generationJob.findMany({ where: { courseLanguageVersionId: id }, orderBy: { createdAt: 'desc' }, take: 20 });
    return { items: jobs };
  });

  // GET /language-versions/:id/preview — предпросмотр «глазами студента» (FR-2.8).
  app.get('/language-versions/:id/preview', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const version = await prisma.courseLanguageVersion.findUnique({
      where: { id },
      include: {
        modules: {
          orderBy: { orderIndex: 'asc' },
          include: {
            lectures: { orderBy: { orderIndex: 'asc' }, select: { id: true, title: true, youtubeVideoId: true, transcriptText: true, orderIndex: true } },
            quiz: { include: { questions: { orderBy: { orderIndex: 'asc' } } } },
            // referenceSolution/rubric скрыты в превью «как студент» тоже
            practicalTask: { select: { id: true, title: true, scenarioPrompt: true, difficulty: true, maxAiMessages: true } },
          },
        },
      },
    });
    if (!version) throw Errors.notFound('Версия не найдена');
    return { version };
  });

  // POST /language-versions/:id/publish — публикация с валидацией (FR-2.9, FR-3.5).
  app.post('/language-versions/:id/publish', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const version = await prisma.courseLanguageVersion.findUnique({
      where: { id },
      include: { modules: { include: { lectures: true, quiz: { include: { questions: true } }, practicalTask: true } } },
    });
    if (!version) throw Errors.notFound('Версия не найдена');

    // Валидация перед публикацией (FR-2.9)
    const problems: string[] = [];
    if (version.modules.length === 0) problems.push('Нет модулей');
    for (const m of version.modules) {
      if (m.lectures.length === 0) problems.push(`Модуль «${m.title}»: нет лекций`);
      for (const l of m.lectures) {
        if (!l.youtubeVideoId) problems.push(`Лекция «${l.title}»: не задано видео`);
        if (!l.transcriptText?.trim()) problems.push(`Лекция «${l.title}»: пустая расшифровка`);
      }
      if (m.assessmentType === 'QUIZ' && (!m.quiz || m.quiz.questions.length === 0)) problems.push(`Модуль «${m.title}»: нет готового теста`);
      if (m.assessmentType === 'PRACTICAL' && !m.practicalTask) problems.push(`Модуль «${m.title}»: нет практического задания`);
    }
    if (problems.length > 0) throw Errors.validation('Версия не готова к публикации', { problems });

    const updated = await prisma.courseLanguageVersion.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
    // Курс становится PUBLISHED, если есть хотя бы одна опубликованная версия
    await prisma.course.update({ where: { id: version.courseId }, data: { status: 'PUBLISHED' } });
    await audit({ actorId: req.user!.id, action: 'COURSE_PUBLISHED', targetType: 'CourseLanguageVersion', targetId: id });
    return { version: updated };
  });

  // POST /language-versions/:id/unpublish — снятие с публикации (FR-2.7).
  app.post('/language-versions/:id/unpublish', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const updated = await prisma.courseLanguageVersion.update({ where: { id }, data: { status: 'DRAFT' } });
    await audit({ actorId: req.user!.id, action: 'COURSE_UNPUBLISHED', targetType: 'CourseLanguageVersion', targetId: id });
    return { version: updated };
  });

  // POST /language-versions/:id/archive — перевод версии в ARCHIVED (FR-2.5).
  // Студентам архивные версии недоступны (доступ только к PUBLISHED).
  app.post('/language-versions/:id/archive', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const updated = await prisma.courseLanguageVersion.update({ where: { id }, data: { status: 'ARCHIVED' } });
    await audit({ actorId: req.user!.id, action: 'COURSE_ARCHIVED', targetType: 'CourseLanguageVersion', targetId: id });
    return { version: updated };
  });
}
