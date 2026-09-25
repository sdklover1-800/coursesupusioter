import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  LANGUAGES,
  Role,
  AssessmentType,
  ApiErrorCode,
  DEFAULT_COURSE_STRUCTURE,
  GenerationType,
  Difficulty,
  RegenStrategy,
  LECTURE_SUMMARY_MAX_CHARS,
  PLACEHOLDER_VIDEO_ID,
  type CourseHealthItem,
} from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { Errors } from '../../lib/errors.js';
import { extractYoutubeId } from '../../lib/youtube.js';
import { audit } from '../../telemetry/events.js';
import { enqueueGeneration } from '../../generation/enqueue.js';
import { llmRateLimit } from '../../plugins/rateLimits.js';
import { courseStatusFrom, healthItemText, publishCheckInclude, publishProblemItems, publishWarningItems, type SiblingVersion } from './publishValidation.js';
import { lectureTitleProblem } from './lectureTitle.js';

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

  // GET /courses/:id — детали курса + «здоровье» контента для редактора:
  // по лекции — мини-квиз, длина расшифровки, длительность, видео, краткое содержание;
  // по версии — итоговый мини-квиз, блокеры (problems), предупреждения (warnings) и
  // число открытых системных отметок на экспертную проверку (openReviewIssues).
  // problems/warnings — русский текст; problemItems/warningItems — код + параметры
  // для перевода на клиенте. Экспертная проверка в warnings не входит — у неё свой счётчик.
  app.get('/courses/:id', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const course = await prisma.course.findUnique({ where: { id }, include: { languageVersions: { include: publishCheckInclude } } });
    if (!course) throw Errors.notFound('Курс не найден');
    const versionIds = course.languageVersions.map((v) => v.id);
    const reviewCounts = versionIds.length
      ? await prisma.contentIssue.groupBy({
          by: ['languageVersionId'],
          where: { languageVersionId: { in: versionIds }, origin: 'SYSTEM', status: 'OPEN' },
          _count: { _all: true },
        })
      : [];
    const openReview = new Map(reviewCounts.map((r) => [r.languageVersionId, r._count._all]));
    const siblings: SiblingVersion[] = course.languageVersions;
    return {
      course: {
        ...course,
        languageVersions: course.languageVersions.map((v) => {
          const openReviewIssues = openReview.get(v.id) ?? 0;
          const problemItems = publishProblemItems(v);
          const warningItems = publishWarningItems(v, siblings);
          return {
            ...v,
            finalMiniQuizId: v.finalMiniQuiz?.id ?? null,
            problems: problemItems.map(healthItemText),
            problemItems,
            warnings: warningItems.map(healthItemText),
            warningItems,
            openReviewIssues,
            modules: v.modules.map((m) => ({
              ...m,
              lectures: m.lectures.map((l) => ({
                ...l,
                miniQuizId: l.miniQuiz?.id ?? null,
                miniQuestionCount: l.miniQuiz?._count.questions ?? 0,
                transcriptChars: l.transcriptText.trim().length,
                hasVideo: !!l.youtubeVideoId && l.youtubeVideoId !== PLACEHOLDER_VIDEO_ID,
                hasSummary: !!l.summary?.trim(),
              })),
            })),
          };
        }),
      },
    };
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
  // Только в неопубликованной версии: структура опубликованной меняется лишь после снятия.
  app.post('/modules/:id/lectures', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const data = parse(z.object({ title: z.string().min(1).optional(), youtubeUrl: z.string().optional(), transcriptText: z.string().optional() }), req.body);
    const mod = await prisma.module.findUnique({
      where: { id },
      include: { lectures: { orderBy: { orderIndex: 'desc' }, take: 1 }, languageVersion: { select: { status: true } } },
    });
    if (!mod) throw Errors.notFound('Модуль не найден');
    assertStructureEditable(mod.languageVersion.status);
    if (data.title) {
      // Название публично видно в каталоге — те же правила, что при публикации (FR-2.9).
      const titleProblem = lectureTitleProblem(data.title);
      if (titleProblem) throw Errors.badRequest(`Название лекции: ${titleProblem}`);
    }
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
    await audit({ actorId: req.user!.id, action: 'LECTURE_CREATED', targetType: 'Lecture', targetId: lecture.id, detail: { moduleId: id, orderIndex: nextIndex } });
    return { lecture };
  });

  // PATCH /modules/:id — переименовать модуль (название видно в каталоге и курсе).
  app.patch('/modules/:id', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { title } = parse(z.object({ title: z.string().trim().min(1).max(200) }), req.body);
    const mod = await prisma.module.findUnique({ where: { id }, select: { title: true } });
    if (!mod) throw Errors.notFound('Модуль не найден');
    const updated = await prisma.module.update({ where: { id }, data: { title } });
    await audit({ actorId: req.user!.id, action: 'MODULE_UPDATED', targetType: 'Module', targetId: id, detail: { from: mod.title, to: title } });
    return { module: updated };
  });

  // PATCH /lectures/:id — наполнение лекции (видео + расшифровка, длительность,
  // краткое содержание) (FR-2.4, FR-4.3). Пустое краткое содержание → null.
  app.patch('/lectures/:id', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const data = parse(
      z.object({
        title: z.string().min(1).optional(),
        youtubeUrl: z.string().optional(),
        transcriptText: z.string().optional(),
        durationSec: z.number().int().min(0).max(14400).nullable().optional(),
        summary: z.string().trim().max(LECTURE_SUMMARY_MAX_CHARS).nullable().optional(),
      }),
      req.body,
    );
    const existing = await prisma.lecture.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw Errors.notFound('Лекция не найдена');
    const update: Record<string, unknown> = {};
    if (data.title) {
      // Название публично видно в каталоге — те же правила, что при публикации (FR-2.9).
      const titleProblem = lectureTitleProblem(data.title);
      if (titleProblem) throw Errors.badRequest(`Название лекции: ${titleProblem}`);
      update.title = data.title;
    }
    if (data.youtubeUrl !== undefined) update.youtubeVideoId = data.youtubeUrl ? extractYoutubeId(data.youtubeUrl) : '';
    if (data.transcriptText !== undefined) update.transcriptText = data.transcriptText;
    if (data.durationSec !== undefined) update.durationSec = data.durationSec;
    if (data.summary !== undefined) update.summary = data.summary ? data.summary : null;
    const lecture = await prisma.lecture.update({ where: { id }, data: update });
    await audit({ actorId: req.user!.id, action: 'LECTURE_UPDATED', targetType: 'Lecture', targetId: id, detail: { fields: Object.keys(update) } });
    return { lecture };
  });

  // DELETE /lectures/:id — удалить лекцию из модуля (FR-2.1 — настраиваемость структуры).
  // Не в опубликованной версии: каскад стёр бы прогресс студентов по лекции.
  app.delete('/lectures/:id', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const lecture = await prisma.lecture.findUnique({
      where: { id },
      select: { title: true, moduleId: true, module: { select: { languageVersion: { select: { status: true } } } } },
    });
    if (!lecture) throw Errors.notFound('Лекция не найдена');
    assertStructureEditable(lecture.module.languageVersion.status);
    await prisma.lecture.delete({ where: { id } });
    await audit({ actorId: req.user!.id, action: 'LECTURE_DELETED', targetType: 'Lecture', targetId: id, detail: { moduleId: lecture.moduleId, title: lecture.title } });
    return { ok: true };
  });

  // POST /language-versions/:id/generate — запуск ИИ-генерации (FR-2.6, FR-7.1).
  // Rate limit на дорогом ИИ-эндпоинте (NFR-2.8, аудит H4).
  app.post('/language-versions/:id/generate', { ...guard, config: llmRateLimit }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const data = parse(
      z.object({
        type: z
          .enum([GenerationType.QUIZ, GenerationType.PRACTICAL, GenerationType.MINI, GenerationType.ALL, GenerationType.LECTURE_SUMMARY])
          .default(GenerationType.ALL),
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
            quiz: { include: { questions: { where: { archivedAt: null }, orderBy: { orderIndex: 'asc' } } } },
            // referenceSolution/rubric скрыты в превью «как студент» тоже
            practicalTask: { select: { id: true, title: true, scenarioPrompt: true, difficulty: true, maxAiMessages: true } },
          },
        },
      },
    });
    if (!version) throw Errors.notFound('Версия не найдена');
    const warningItems = await versionWarnings(id);
    return { version, warnings: warningItems.map(healthItemText), warningItems };
  });

  // POST /language-versions/:id/publish — публикация с валидацией (FR-2.9, FR-3.5).
  app.post('/language-versions/:id/publish', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const version = await prisma.courseLanguageVersion.findUnique({ where: { id }, include: publishCheckInclude });
    if (!version) throw Errors.notFound('Версия не найдена');

    // Валидация перед публикацией (FR-2.9); предупреждения публикацию не блокируют
    const problemItems = publishProblemItems(version);
    const warningItems = await versionWarnings(id);
    const warnings = warningItems.map(healthItemText);
    if (problemItems.length > 0) {
      throw Errors.validation('Версия не готова к публикации', { problems: problemItems.map(healthItemText), warnings, problemItems, warningItems });
    }

    const updated = await prisma.courseLanguageVersion.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
    // Курс становится PUBLISHED, если есть хотя бы одна опубликованная версия
    await syncCourseStatus(version.courseId);
    await audit({ actorId: req.user!.id, action: 'COURSE_PUBLISHED', targetType: 'CourseLanguageVersion', targetId: id, detail: { warnings: warnings.length } });
    return { version: updated, warnings, warningItems };
  });

  // POST /language-versions/:id/unpublish — снятие с публикации (FR-2.7).
  app.post('/language-versions/:id/unpublish', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const updated = await prisma.courseLanguageVersion.update({ where: { id }, data: { status: 'DRAFT' } });
    await syncCourseStatus(updated.courseId); // курс остаётся PUBLISHED, только пока есть опубликованная версия
    await audit({ actorId: req.user!.id, action: 'COURSE_UNPUBLISHED', targetType: 'CourseLanguageVersion', targetId: id });
    return { version: updated };
  });

  // POST /language-versions/:id/archive — перевод версии в ARCHIVED (FR-2.5).
  // Студентам архивные версии недоступны (доступ только к PUBLISHED).
  app.post('/language-versions/:id/archive', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const updated = await prisma.courseLanguageVersion.update({ where: { id }, data: { status: 'ARCHIVED' } });
    await syncCourseStatus(updated.courseId);
    await audit({ actorId: req.user!.id, action: 'COURSE_ARCHIVED', targetType: 'CourseLanguageVersion', targetId: id });
    return { version: updated };
  });
}

/**
 * Структуру (состав лекций) опубликованной версии менять нельзя: удаление лекции
 * каскадом стирает прогресс студентов, добавление меняет прогресс/сертификат на лету.
 */
function assertStructureEditable(status: string): void {
  if (status === 'PUBLISHED') {
    throw Errors.coded(409, ApiErrorCode.VERSION_PUBLISHED, 'Версия опубликована: снимите её с публикации, чтобы менять структуру');
  }
}

/** Статус курса — производный от статусов его версий (публикация/снятие/архив). */
async function syncCourseStatus(courseId: string): Promise<void> {
  const versions = await prisma.courseLanguageVersion.findMany({ where: { courseId }, select: { status: true } });
  await prisma.course.update({ where: { id: courseId }, data: { status: courseStatusFrom(versions.map((v) => v.status)) } });
}

/** Предупреждения публикации версии (с учётом параллельных версий и системных отметок). */
async function versionWarnings(versionId: string): Promise<CourseHealthItem[]> {
  const version = await prisma.courseLanguageVersion.findUnique({ where: { id: versionId }, include: publishCheckInclude });
  if (!version) return [];
  const [siblings, openReviewIssues] = await Promise.all([
    prisma.courseLanguageVersion.findMany({
      where: { courseId: version.courseId, id: { not: versionId } },
      select: { language: true, modules: { select: { orderIndex: true, quiz: { select: { questions: { where: { archivedAt: null }, select: { id: true } } } } } } },
    }),
    prisma.contentIssue.count({ where: { languageVersionId: versionId, origin: 'SYSTEM', status: 'OPEN' } }),
  ]);
  return publishWarningItems(version, siblings, { openReviewIssues });
}
