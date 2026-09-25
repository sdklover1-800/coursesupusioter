import {
  COURSE_FINAL_QUESTIONS_PER_LECTURE,
  DEFAULTS,
  GenerationType,
  MODULE_QUIZ_QUESTIONS,
  type Language,
  type Difficulty,
} from '@edu/shared';
import { practicalGenerationSchema } from '../llm/schemas/generation.js';
import { prisma } from '../lib/prisma.js';
import { getGateway } from '../llm/gateway.js';
import { env, practicalTokenBudget } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { practicalGenSystemPrompt, practicalGenUserPrompt, GENERATION_PROMPT_VERSION } from '../llm/prompts/generation.js';
import type { GenerationJobData } from '../queue/queues.js';
import {
  ARCHIVE_ORDER_BASE,
  MINI_QUIZ_QUESTIONS,
  archiveQuestionsTx,
  draftCourseFinal,
  draftMiniQuiz,
  draftModuleQuiz,
  generateLectureSummary,
  gradedPromptsOfModule,
  gradedPromptsOfVersion,
  practicePromptsForModule,
  type DraftQuestion,
} from './drafts.js';
import { localizedTitle } from './titles.js';
import { normalizeTimecode } from '../llm/schemas/generation.js';

/**
 * Сервис ИИ-генерации материалов (§5.2, §5.3).
 * Асинхронно вызывается воркером; результат — черновики (isAIGenerated=true),
 * требующие ручной проверки (FR-7.2). Стратегия regen не затирает правки молча (FR-7.5).
 *
 * gen-2.0: вопросы строятся черновиками generation/drafts.ts (цикл качества, перемешивание,
 * обоснования, источник) и затем записываются; тест модуля — ровно MODULE_QUIZ_QUESTIONS
 * вопросов SINGLE_CHOICE (USER_DECISIONS §5); оцениваемый тест с попытками не трогается
 * («frozen»); заменяемые вопросы АРХИВИРУЮТСЯ, а не удаляются; названия — titles.ts.
 */

type Strategy = 'OVERWRITE' | 'APPEND' | 'KEEP';

/** Типы задач, которые умеет runGeneration (worker.ts отклоняет прочие до старта). */
export const RUNNABLE_GENERATION_TYPES: ReadonlySet<GenerationType> = new Set<GenerationType>([
  GenerationType.QUIZ,
  GenerationType.PRACTICAL,
  GenerationType.MINI,
  GenerationType.ALL,
  GenerationType.LECTURE_SUMMARY,
]);

export interface GenerationResult {
  quizzes: number;
  practicals: number;
  minis: number;
  summaries: number;
  /** Пропуски по причинам: keep — уже заполнено; frozen — у оцениваемого теста есть попытки; canonical — каноническое задание; full — добавлять некуда. */
  skipped: Record<SkipReason, number>;
  model: string;
  promptVersion: string;
  language: string;
}

export type SkipReason = 'keep' | 'frozen' | 'canonical' | 'full' | 'empty';

/* ── Планирование записи (чистые функции — покрыты тестами) ─────────── */

export type QuizWritePlan =
  | { action: 'skip'; reason: SkipReason }
  | { action: 'generate'; count: number; archiveNonEdited: boolean };

/**
 * Что делать с тестом при генерации:
 *  - оцениваемый тест с попытками — НИКОГДА (frozen): его банк меняет только
 *    контролируемый writeQuizQuestions(ARCHIVE_REPLACE) из CONTENT;
 *  - KEEP — пропуск, если есть хоть один неархивный вопрос (идемпотентность ретраев, аудит H1);
 *  - OVERWRITE — архивировать неотредактированные, догенерировать до target с учётом ручных правок;
 *  - APPEND — догенерировать до target.
 */
export function planQuizWrite(p: {
  strategy: Strategy;
  isGraded: boolean;
  attemptCount: number;
  activeCount: number;
  editedCount: number;
  target: number;
}): QuizWritePlan {
  if (p.isGraded && p.attemptCount > 0) return { action: 'skip', reason: 'frozen' };
  if (p.strategy === 'KEEP') {
    return p.activeCount > 0 ? { action: 'skip', reason: 'keep' } : { action: 'generate', count: p.target, archiveNonEdited: false };
  }
  if (p.strategy === 'OVERWRITE') {
    const count = Math.max(0, p.target - p.editedCount);
    return count > 0 ? { action: 'generate', count, archiveNonEdited: true } : { action: 'skip', reason: 'full' };
  }
  const count = Math.max(0, p.target - p.activeCount);
  return count > 0 ? { action: 'generate', count, archiveNonEdited: false } : { action: 'skip', reason: 'full' };
}

export type PracticalWritePlan = { action: 'skip'; reason: SkipReason } | { action: 'generate'; refreshTitle: boolean };

/**
 * Практическое задание: каноническое (canonicalRef, USER_DECISIONS §4) не
 * перегенерируется никогда; KEEP/APPEND при существующем задании выходят БЕЗ вызова
 * LLM (аудит: KEEP всё равно вызывал модель); OVERWRITE обновляет и название.
 */
export function planPracticalWrite(p: {
  strategy: Strategy;
  existing: { isEdited: boolean; canonicalRef: string | null } | null;
}): PracticalWritePlan {
  if (p.existing?.canonicalRef) return { action: 'skip', reason: 'canonical' };
  if (p.existing && p.strategy !== 'OVERWRITE') return { action: 'skip', reason: 'keep' };
  return { action: 'generate', refreshTitle: p.strategy === 'OVERWRITE' };
}

/* ── Конвейер ─────────────────────────────────────────────────────── */

export async function runGeneration(data: GenerationJobData): Promise<GenerationResult> {
  // Неизвестный тип — громкий отказ, а не «успешная» пустая задача.
  if (!RUNNABLE_GENERATION_TYPES.has(data.type)) throw new Error(`Неизвестный тип генерации: ${String(data.type)}`);

  const version = await prisma.courseLanguageVersion.findUnique({
    where: { id: data.courseLanguageVersionId },
    include: {
      modules: {
        orderBy: { orderIndex: 'asc' },
        include: { lectures: { orderBy: { orderIndex: 'asc' } }, quiz: true, practicalTask: true },
      },
    },
  });
  if (!version) throw new Error('Языковая версия не найдена');

  const language = version.language as Language;
  const difficulty = (data.params.difficulty ?? 'MEDIUM') as Difficulty;
  const strategy: Strategy = data.params.regenStrategy ?? 'KEEP';
  const targetModules = data.params.moduleIds
    ? version.modules.filter((m) => data.params.moduleIds!.includes(m.id))
    : version.modules;
  const has = (t: GenerationType) => data.type === t || data.type === GenerationType.ALL;

  const result: GenerationResult = {
    quizzes: 0,
    practicals: 0,
    minis: 0,
    summaries: 0,
    skipped: { keep: 0, frozen: 0, canonical: 0, full: 0, empty: 0 },
    model: env.LLM_MODEL_GENERATION,
    // FR-R.7 (воспроизводимость): модель и версия промптов ГЕНЕРАЦИИ (A26).
    promptVersion: GENERATION_PROMPT_VERSION,
    language,
  };
  const count = (r: SkipReason | 'done', key: 'quizzes' | 'practicals' | 'minis' | 'summaries') => {
    if (r === 'done') result[key]++;
    else result.skipped[r]++;
  };

  // Порядок: сначала оцениваемые тесты, затем тренировочные — мини-квизы получают
  // свежие оцениваемые формулировки как doNotReuse (A11).
  for (const mod of targetModules) {
    if (has(GenerationType.QUIZ) && mod.assessmentType === 'QUIZ') {
      count(await generateQuizForModule({ moduleId: mod.id, language, strategy }), 'quizzes');
    }
    if (has(GenerationType.PRACTICAL) && mod.assessmentType === 'PRACTICAL') {
      count(await generatePracticalForModule({ module: mod, versionId: version.id, language, difficulty, strategy }), 'practicals');
    }
  }

  // Мини-квизы (тренировочные): после каждой лекции + итоговый по курсу.
  if (has(GenerationType.MINI)) {
    for (const mod of targetModules) {
      for (const lec of mod.lectures) {
        count(await generateLectureMiniQuiz({ lecture: lec, moduleId: mod.id, language, strategy }), 'minis');
      }
    }
    count(await generateCourseMiniQuiz({ versionId: version.id, language, strategy }), 'minis');
  }

  // Краткие содержания лекций (Lecture.summary).
  if (has(GenerationType.LECTURE_SUMMARY)) {
    for (const mod of targetModules) {
      for (const lec of mod.lectures) {
        count((await generateLectureSummary(lec.id, strategy)) ? 'done' : 'keep', 'summaries');
      }
    }
  }

  return result;
}

/* ── Запись вопросов в тест ───────────────────────────────────────── */

/**
 * Пишет черновики в тест (одна транзакция): при archiveNonEdited — архивирует
 * неотредактированные неархивные вопросы (ручные правки сохраняются, FR-7.5);
 * новые — строго после максимума рабочего диапазона orderIndex.
 */
async function writeGenerated(p: {
  quizId: string;
  items: DraftQuestion[];
  archiveNonEdited: boolean;
  title?: string;
}): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      if (p.title) await tx.quiz.update({ where: { id: p.quizId }, data: { title: p.title } });
      if (p.archiveNonEdited) {
        const nonEdited = await tx.quizQuestion.findMany({
          where: { quizId: p.quizId, archivedAt: null, isEdited: false },
          select: { id: true },
        });
        await archiveQuestionsTx(
          tx,
          p.quizId,
          nonEdited.map((q) => q.id),
        );
      }
      const last = await tx.quizQuestion.findFirst({
        where: { quizId: p.quizId, orderIndex: { lt: ARCHIVE_ORDER_BASE } },
        orderBy: { orderIndex: 'desc' },
        select: { orderIndex: true },
      });
      const start = last ? last.orderIndex + 1 : 0;
      await tx.quizQuestion.createMany({
        data: p.items.map((d, i) => ({
          quizId: p.quizId,
          type: d.type,
          prompt: d.prompt,
          options: d.options,
          correctOptionIds: d.correctOptionIds,
          explanation: d.explanation,
          difficulty: d.difficulty,
          ...(d.optionRationales ? { optionRationales: d.optionRationales } : {}),
          sourceLectureId: d.sourceLectureId,
          sourceTimecode: d.sourceTimecode ? (normalizeTimecode(d.sourceTimecode) ?? null) : null,
          canonicalKey: d.canonicalKey ?? null,
          orderIndex: start + i,
          isAIGenerated: true,
          isEdited: false,
        })),
      });
    },
    { timeout: 30_000 },
  );
}

async function quizState(where: { moduleId: string } | { lectureId: string } | { courseLanguageVersionId: string }) {
  const quiz = await prisma.quiz.findUnique({
    where: where as never,
    include: {
      questions: { where: { archivedAt: null }, select: { id: true, prompt: true, isEdited: true, sourceLectureId: true } },
      _count: { select: { attempts: true } },
    },
  });
  return quiz;
}

async function generateQuizForModule(p: { moduleId: string; language: Language; strategy: Strategy }): Promise<SkipReason | 'done'> {
  const mod = await prisma.module.findUnique({ where: { id: p.moduleId }, select: { id: true, title: true } });
  if (!mod) return 'empty';
  const quiz = await quizState({ moduleId: p.moduleId });
  const active = quiz?.questions ?? [];
  const plan = planQuizWrite({
    strategy: p.strategy,
    isGraded: quiz?.isGraded ?? true,
    attemptCount: quiz?._count.attempts ?? 0,
    activeCount: active.length,
    editedCount: active.filter((q) => q.isEdited).length,
    target: MODULE_QUIZ_QUESTIONS,
  });
  if (plan.action === 'skip') {
    logger.info({ moduleId: p.moduleId, reason: plan.reason }, `Пропуск генерации теста модуля (${plan.reason})`);
    return plan.reason;
  }

  // Сохраняемые (ручные правки / APPEND) + тренировочные формулировки модуля — не повторять.
  const kept = plan.archiveNonEdited ? active.filter((q) => q.isEdited) : active;
  const doNotReuse = [...kept.map((q) => q.prompt), ...(await practicePromptsForModule(p.moduleId))];
  const items = await draftModuleQuiz(p.moduleId, {
    count: plan.count,
    types: { SINGLE_CHOICE: plan.count }, // блюпринт USER_DECISIONS §5: без TRUE_FALSE
    doNotReuse,
    seedBase: quiz?.id ?? `module:${p.moduleId}`,
  });

  const title = localizedTitle('MODULE_FINAL', p.language, mod.title);
  const target =
    quiz ??
    (await prisma.quiz.create({
      data: { moduleId: p.moduleId, title, passThreshold: DEFAULTS.quizPassThreshold, maxAttempts: DEFAULTS.quizMaxAttempts },
    }));
  await writeGenerated({
    quizId: target.id,
    items,
    archiveNonEdited: plan.archiveNonEdited,
    // OVERWRITE обновляет и название (аудит: устаревшие «Тест:» в kk/en).
    ...(p.strategy === 'OVERWRITE' ? { title } : {}),
  });
  return 'done';
}

async function generatePracticalForModule(p: {
  module: {
    id: string;
    title: string;
    coversWholeCourse: boolean;
    practicalTask: { isEdited: boolean; canonicalRef: string | null } | null;
  };
  versionId: string;
  language: Language;
  difficulty: Difficulty;
  strategy: Strategy;
}): Promise<SkipReason | 'done'> {
  const plan = planPracticalWrite({ strategy: p.strategy, existing: p.module.practicalTask });
  if (plan.action === 'skip') {
    // KEEP выходит ДО вызова LLM (аудит: раньше модель вызывалась и для существующего задания).
    logger.info({ moduleId: p.module.id, reason: plan.reason }, `Пропуск генерации практического (${plan.reason})`);
    return plan.reason;
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
  // Итоговое (весь курс, модуль V) — только метка, без названия модуля.
  const title = localizedTitle('PRACTICAL', p.language, p.module.coversWholeCourse ? null : p.module.title);

  await prisma.practicalTask.upsert({
    where: { moduleId: p.module.id },
    create: {
      moduleId: p.module.id,
      title,
      scenarioPrompt: data.student_facing_scenario,
      referenceSolution: data.reference_solution,
      rubricSpec: data.rubric as object,
      difficulty,
      tokenBudget: practicalTokenBudget(data.recommended_token_budget, p.language),
      maxAiMessages: data.recommended_max_ai_messages,
      systemPromptTemplateId: GENERATION_PROMPT_VERSION,
      isAIGenerated: true,
      isEdited: false,
    },
    // Сюда доходит только OVERWRITE (planPracticalWrite): содержимое и название обновляются.
    update: {
      ...(plan.refreshTitle ? { title } : {}),
      scenarioPrompt: data.student_facing_scenario,
      referenceSolution: data.reference_solution,
      rubricSpec: data.rubric as object,
      difficulty,
      tokenBudget: practicalTokenBudget(data.recommended_token_budget, p.language),
      maxAiMessages: data.recommended_max_ai_messages,
      systemPromptTemplateId: GENERATION_PROMPT_VERSION,
      isAIGenerated: true,
      isEdited: false,
    },
  });
  return 'done';
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

/* ── Мини-квизы (тренировочные, не оцениваются) ─────────────────────── */

/** Мини-квиз после лекции — вопросы строго по её расшифровке, без повторов оцениваемых (A11). */
async function generateLectureMiniQuiz(p: {
  lecture: { id: string; title: string; transcriptText: string };
  moduleId: string;
  language: Language;
  strategy: Strategy;
}): Promise<SkipReason | 'done'> {
  if (!p.lecture.transcriptText?.trim()) return 'empty';
  const quiz = await quizState({ lectureId: p.lecture.id });
  const active = quiz?.questions ?? [];
  const plan = planQuizWrite({
    strategy: p.strategy,
    isGraded: false,
    attemptCount: 0,
    activeCount: active.length,
    editedCount: active.filter((q) => q.isEdited).length,
    target: MINI_QUIZ_QUESTIONS,
  });
  if (plan.action === 'skip') return plan.reason;

  const kept = plan.archiveNonEdited ? active.filter((q) => q.isEdited) : active;
  const items = await draftMiniQuiz(p.lecture.id, {
    count: plan.count,
    doNotReuse: [...(await gradedPromptsOfModule(p.moduleId)), ...kept.map((q) => q.prompt)],
    seedBase: quiz?.id ?? `lecture:${p.lecture.id}`,
  });
  const title = localizedTitle('LECTURE_MINI', p.language, p.lecture.title);
  const target =
    quiz ??
    (await prisma.quiz.create({
      // тренировочный: без попыток, прогресса и оценочной телеметрии
      data: { lectureId: p.lecture.id, kind: 'LECTURE_MINI', isGraded: false, title },
    }));
  await writeGenerated({ quizId: target.id, items, archiveNonEdited: plan.archiveNonEdited, ...(p.strategy === 'OVERWRITE' ? { title } : {}) });
  return 'done';
}

/**
 * Итоговый мини-квиз курса: по COURSE_FINAL_QUESTIONS_PER_LECTURE вопросу на лекцию
 * (draftCourseFinal), без повторов оцениваемых формулировок версии (A11).
 */
async function generateCourseMiniQuiz(p: { versionId: string; language: Language; strategy: Strategy }): Promise<SkipReason | 'done'> {
  const lectures = await prisma.lecture.findMany({
    where: { module: { courseLanguageVersionId: p.versionId } },
    select: { id: true, transcriptText: true },
  });
  const withText = lectures.filter((l) => l.transcriptText.trim());
  if (!withText.length) return 'empty';
  const quiz = await quizState({ courseLanguageVersionId: p.versionId });
  const active = quiz?.questions ?? [];
  const plan = planQuizWrite({
    strategy: p.strategy,
    isGraded: false,
    attemptCount: 0,
    activeCount: active.length,
    editedCount: active.filter((q) => q.isEdited).length,
    target: withText.length * COURSE_FINAL_QUESTIONS_PER_LECTURE,
  });
  if (plan.action === 'skip') return plan.reason;

  // Лекции, уже покрытые сохраняемыми вопросами (с известным источником), пропускаем.
  const kept = plan.archiveNonEdited ? active.filter((q) => q.isEdited) : active;
  const covered = kept.map((q) => q.sourceLectureId).filter((x): x is string => !!x);
  if (withText.every((l) => covered.includes(l.id))) return 'full';
  const items = await draftCourseFinal(p.versionId, {
    doNotReuse: [...(await gradedPromptsOfVersion(p.versionId)), ...kept.map((q) => q.prompt)],
    skipLectureIds: covered,
    ...(quiz ? { seedBase: quiz.id } : {}),
  });
  const title = localizedTitle('COURSE_FINAL', p.language);
  const target =
    quiz ??
    (await prisma.quiz.create({
      data: { courseLanguageVersionId: p.versionId, kind: 'COURSE_FINAL', isGraded: false, title },
    }));
  await writeGenerated({ quizId: target.id, items, archiveNonEdited: plan.archiveNonEdited, ...(p.strategy === 'OVERWRITE' ? { title } : {}) });
  return 'done';
}
