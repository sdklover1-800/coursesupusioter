import {
  quizGenerationSchema,
  practicalGenerationSchema,
  DEFAULTS,
  type Language,
  type Difficulty,
} from '@edu/shared';
import { prisma } from '../lib/prisma.js';
import { getGateway } from '../llm/gateway.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import {
  quizGenSystemPrompt,
  quizGenUserPrompt,
  practicalGenSystemPrompt,
  practicalGenUserPrompt,
  PROMPT_VERSION,
} from '../llm/prompts.js';
import type { GenerationJobData } from '../queue/queues.js';

/** Метки вариантов для TRUE_FALSE — фиксированы платформой, индекс 0 = «верно». */
const TRUE_FALSE_LABELS: Record<Language, string[]> = {
  ru: ['Верно', 'Неверно'],
  kk: ['Дұрыс', 'Қате'],
  en: ['True', 'False'],
};

/**
 * Сервис ИИ-генерации материалов (§5.2, §5.3).
 * Асинхронно вызывается воркером; результат — черновики (isAIGenerated=true),
 * требующие ручной проверки (FR-7.2). Стратегия regen не затирает правки молча (FR-7.5).
 */
export async function runGeneration(
  data: GenerationJobData,
): Promise<{ quizzes: number; practicals: number; minis: number; model: string; promptVersion: string; language: string }> {
  const version = await prisma.courseLanguageVersion.findUnique({
    where: { id: data.courseLanguageVersionId },
    include: { modules: { include: { lectures: { orderBy: { orderIndex: 'asc' } }, quiz: true, practicalTask: true } } },
  });
  if (!version) throw new Error('Языковая версия не найдена');

  const language = version.language as Language;
  const difficulty = (data.params.difficulty ?? 'MEDIUM') as Difficulty;
  const strategy = data.params.regenStrategy ?? 'KEEP';
  const targetModules = data.params.moduleIds
    ? version.modules.filter((m) => data.params.moduleIds!.includes(m.id))
    : version.modules;

  let quizzes = 0;
  let practicals = 0;
  let minis = 0;

  // Мини-квизы (тренировочные): после каждой лекции + итоговый по курсу.
  if (data.type === 'MINI' || data.type === 'ALL') {
    for (const mod of targetModules) {
      for (const lec of mod.lectures) {
        await generateLectureMiniQuiz({ lecture: lec, language, strategy });
        minis++;
      }
    }
    await generateCourseMiniQuiz({ versionId: version.id, language, courseTitle: version.title, strategy });
    minis++;
  }

  for (const mod of targetModules) {
    if ((data.type === 'QUIZ' || data.type === 'ALL') && mod.assessmentType === 'QUIZ') {
      await generateQuizForModule({ moduleId: mod.id, language, difficulty, params: data.params, strategy });
      quizzes++;
    }
    if ((data.type === 'PRACTICAL' || data.type === 'ALL') && mod.assessmentType === 'PRACTICAL') {
      await generatePracticalForModule({ module: mod, versionId: version.id, language, difficulty, strategy });
      practicals++;
    }
  }

  // FR-R.7 (воспроизводимость): фиксируем модель и версию промпта операции генерации.
  return { quizzes, practicals, minis, model: env.LLM_MODEL_GENERATION, promptVersion: PROMPT_VERSION, language };
}

async function moduleTranscripts(moduleId: string): Promise<string> {
  const lectures = await prisma.lecture.findMany({ where: { moduleId }, orderBy: { orderIndex: 'asc' } });
  return lectures.map((l, i) => `[Лекция ${i + 1}: ${l.title}]\n${l.transcriptText}`).join('\n\n');
}

async function versionTranscripts(versionId: string): Promise<string> {
  const modules = await prisma.module.findMany({
    where: { courseLanguageVersionId: versionId },
    include: { lectures: { orderBy: { orderIndex: 'asc' } } },
    orderBy: { orderIndex: 'asc' },
  });
  return modules
    .map((m) => m.lectures.map((l) => `[${m.title} / ${l.title}]\n${l.transcriptText}`).join('\n\n'))
    .join('\n\n');
}

async function generateQuizForModule(p: {
  moduleId: string;
  language: Language;
  difficulty: Difficulty;
  params: GenerationJobData['params'];
  strategy: 'OVERWRITE' | 'APPEND' | 'KEEP';
}): Promise<void> {
  const mod = await prisma.module.findUnique({ where: { id: p.moduleId }, include: { quiz: { include: { questions: true } } } });
  if (!mod) return;

  // FR-7.5 + идемпотентность (аудит H1): при KEEP пропускаем модуль, если в тесте
  // УЖЕ ЕСТЬ ЛЮБЫЕ вопросы. Иначе автоматический ретрай частично упавшей задачи
  // (BullMQ attempts:3) заново прогоняет уже сгенерированные модули и плодит дубли:
  // ИИ-вопросы прошлой попытки не isEdited, поэтому проверка только hasEdited их не ловила.
  const existingCount = mod.quiz?.questions.length ?? 0;
  if (p.strategy === 'KEEP' && existingCount > 0) {
    logger.info({ moduleId: p.moduleId }, 'Пропуск генерации теста (KEEP): в модуле уже есть вопросы');
    return;
  }

  const transcripts = await moduleTranscripts(p.moduleId);
  const gateway = getGateway();
  const { data } = await gateway.completeStructured(
    {
      model: env.LLM_MODEL_GENERATION,
      system: quizGenSystemPrompt(p.language),
      cacheSystem: true,
      // С запасом: развёрнутые варианты на русском/казахском легко съедают 4k,
      // а обрыв ответа по лимиту рушит JSON целиком.
      maxTokens: 8000,
      messages: [
        {
          role: 'user',
          content: quizGenUserPrompt({
            transcripts,
            moduleTitle: mod.title,
            singleChoiceCount: p.params.singleChoiceCount ?? 4,
            trueFalseCount: p.params.trueFalseCount ?? 2,
          }),
        },
      ],
    },
    quizGenerationSchema,
    'quiz_gen',
  );

  const quiz = await prisma.quiz.upsert({
    where: { moduleId: p.moduleId },
    create: { moduleId: p.moduleId, title: `Тест: ${mod.title}`, passThreshold: DEFAULTS.quizPassThreshold, maxAttempts: DEFAULTS.quizMaxAttempts },
    update: {},
  });

  if (p.strategy === 'OVERWRITE') {
    // Затираем только НЕотредактированные ИИ-вопросы (ручные всегда сохраняем)
    await prisma.quizQuestion.deleteMany({ where: { quizId: quiz.id, isEdited: false } });
  }

  // orderIndex новых вопросов — строго ПОСЛЕ максимума существующих (сохранённые
  // ручные правки могут занимать произвольные индексы). Так исключаем коллизии с
  // новым @@unique([quizId, orderIndex]).
  const remaining = await prisma.quizQuestion.findMany({ where: { quizId: quiz.id }, select: { orderIndex: true } });
  const startIndex = remaining.length ? Math.max(...remaining.map((r) => r.orderIndex)) + 1 : 0;
  await prisma.quizQuestion.createMany({
    data: data.questions.map((q, i) => ({
      quizId: quiz.id,
      type: q.type,
      prompt: q.prompt,
      // Для TRUE_FALSE метки задаёт платформа (локализованно), а не модель.
      options: q.type === 'TRUE_FALSE' ? TRUE_FALSE_LABELS[p.language] : (q.options ?? []),
      correctOptionIds: q.correct_option_indexes,
      explanation: q.explanation ?? null,
      difficulty: q.difficulty,
      orderIndex: startIndex + i,
      isAIGenerated: true,
      isEdited: false,
    })),
  });
}

async function generatePracticalForModule(p: {
  module: { id: string; title: string; coversWholeCourse: boolean; practicalTask: { isEdited: boolean } | null };
  versionId: string;
  language: Language;
  difficulty: Difficulty;
  strategy: 'OVERWRITE' | 'APPEND' | 'KEEP';
}): Promise<void> {
  if (p.module.practicalTask?.isEdited && p.strategy === 'KEEP') {
    logger.info({ moduleId: p.module.id }, 'Пропуск генерации практического: ручные правки, KEEP');
    return;
  }

  const transcripts = p.module.coversWholeCourse
    ? await versionTranscripts(p.versionId)
    : await moduleTranscripts(p.module.id);

  const version = await prisma.courseLanguageVersion.findUnique({ where: { id: p.versionId } });
  const gateway = getGateway();
  const { data } = await gateway.completeStructured(
    {
      model: env.LLM_MODEL_GENERATION,
      system: practicalGenSystemPrompt(p.language, p.difficulty),
      cacheSystem: true,
      // Практическое на весь курс — крупный вывод (сценарий + эталон + рубрика);
      // 3000 обрывало JSON. С запасом (аудит/пилот практической генерации).
      maxTokens: 8000,
      messages: [
        { role: 'user', content: practicalGenUserPrompt({ transcripts, courseTitle: version?.title ?? p.module.title }) },
      ],
    },
    practicalGenerationSchema,
    'practical_gen',
  );

  // Сложность задаёт менеджер (§16): берём запрошенную, вывод модели — необязателен.
  const difficulty = data.difficulty ?? p.difficulty;

  await prisma.practicalTask.upsert({
    where: { moduleId: p.module.id },
    create: {
      moduleId: p.module.id,
      title: `Практическое задание: ${p.module.title}`,
      scenarioPrompt: data.student_facing_scenario,
      referenceSolution: data.reference_solution,
      rubricSpec: data.rubric as object,
      difficulty,
      tokenBudget: data.recommended_token_budget,
      maxAiMessages: data.recommended_max_ai_messages,
      systemPromptTemplateId: PROMPT_VERSION,
      isAIGenerated: true,
      isEdited: false,
    },
    // OVERWRITE: обновляем содержимое (но только если не было ручных правок — иначе KEEP выше уже вышел)
    update:
      p.strategy === 'OVERWRITE'
        ? {
            scenarioPrompt: data.student_facing_scenario,
            referenceSolution: data.reference_solution,
            rubricSpec: data.rubric as object,
            difficulty,
            tokenBudget: data.recommended_token_budget,
            maxAiMessages: data.recommended_max_ai_messages,
            isAIGenerated: true,
            isEdited: false,
          }
        : {},
  });
}

/* ── Мини-квизы (тренировочные, не оцениваются) ─────────────────────────── */

const MINI_QUESTIONS = 3;

/** Общая часть: создать/обновить тренировочный квиз и записать вопросы. */
async function upsertMiniQuiz(p: {
  where: { lectureId: string } | { courseLanguageVersionId: string };
  kind: 'LECTURE_MINI' | 'COURSE_FINAL';
  title: string;
  language: Language;
  transcripts: string;
  sourceTitle: string;
  strategy: 'OVERWRITE' | 'APPEND' | 'KEEP';
}): Promise<void> {
  const existing = await prisma.quiz.findUnique({ where: p.where as never, include: { questions: true } });
  // Идемпотентность (как у обычных тестов): KEEP не трогает уже заполненный квиз.
  if (p.strategy === 'KEEP' && (existing?.questions.length ?? 0) > 0) return;

  const { data } = await getGateway().completeStructured(
    {
      model: env.LLM_MODEL_GENERATION,
      system: quizGenSystemPrompt(p.language),
      cacheSystem: true,
      maxTokens: 4000,
      messages: [
        {
          role: 'user',
          content: quizGenUserPrompt({
            transcripts: p.transcripts,
            moduleTitle: p.sourceTitle,
            singleChoiceCount: MINI_QUESTIONS - 1,
            trueFalseCount: 1,
          }),
        },
      ],
    },
    quizGenerationSchema,
    'mini_quiz_gen',
  );

  const quiz = await prisma.quiz.upsert({
    where: p.where as never,
    create: {
      ...p.where,
      kind: p.kind,
      isGraded: false, // тренировочный: без попыток, прогресса и оценочной телеметрии
      title: p.title,
    },
    update: {},
  });

  if (p.strategy === 'OVERWRITE') {
    await prisma.quizQuestion.deleteMany({ where: { quizId: quiz.id, isEdited: false } });
  }
  const remaining = await prisma.quizQuestion.findMany({ where: { quizId: quiz.id }, select: { orderIndex: true } });
  const startIndex = remaining.length ? Math.max(...remaining.map((r) => r.orderIndex)) + 1 : 0;

  await prisma.quizQuestion.createMany({
    data: data.questions.slice(0, MINI_QUESTIONS).map((q, i) => ({
      quizId: quiz.id,
      type: q.type,
      prompt: q.prompt,
      options: q.type === 'TRUE_FALSE' ? TRUE_FALSE_LABELS[p.language] : (q.options ?? []),
      correctOptionIds: q.correct_option_indexes,
      explanation: q.explanation ?? null,
      difficulty: q.difficulty,
      orderIndex: startIndex + i,
      isAIGenerated: true,
      isEdited: false,
    })),
  });
}

/** Мини-квиз после лекции — вопросы строго по её расшифровке. */
async function generateLectureMiniQuiz(p: {
  lecture: { id: string; title: string; transcriptText: string };
  language: Language;
  strategy: 'OVERWRITE' | 'APPEND' | 'KEEP';
}): Promise<void> {
  if (!p.lecture.transcriptText?.trim()) return;
  await upsertMiniQuiz({
    where: { lectureId: p.lecture.id },
    kind: 'LECTURE_MINI',
    title: `Мини-квиз: ${p.lecture.title}`,
    language: p.language,
    transcripts: p.lecture.transcriptText,
    sourceTitle: p.lecture.title,
    strategy: p.strategy,
  });
}

/** Итоговый мини-квиз по всему курсу. */
async function generateCourseMiniQuiz(p: {
  versionId: string;
  language: Language;
  courseTitle: string;
  strategy: 'OVERWRITE' | 'APPEND' | 'KEEP';
}): Promise<void> {
  const transcripts = await versionTranscripts(p.versionId);
  if (!transcripts.trim()) return;
  await upsertMiniQuiz({
    where: { courseLanguageVersionId: p.versionId },
    kind: 'COURSE_FINAL',
    title: `Итоговый мини-квиз: ${p.courseTitle}`,
    language: p.language,
    transcripts,
    sourceTitle: p.courseTitle,
    strategy: p.strategy,
  });
}
