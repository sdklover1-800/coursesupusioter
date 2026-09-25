import { Prisma } from '@prisma/client';
import {
  ApiErrorCode,
  COURSE_FINAL_QUESTIONS_PER_LECTURE,
  LECTURE_SUMMARY_MAX_CHARS,
  MODULE_QUIZ_OPTIONS,
  MODULE_QUIZ_QUESTIONS,
  type Difficulty,
  type Language,
} from '@edu/shared';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { Errors } from '../lib/errors.js';
import {
  quizGenerationSchema,
  distractorRepairSchema,
  rationaleBackfillSchema,
  lectureSummarySchema,
  courseDescriptionSchema,
  normalizeTimecode,
  type GeneratedQuestion,
} from '../llm/schemas/generation.js';
import {
  quizGenSystemPrompt,
  quizGenUserPrompt,
  distractorRepairSystemPrompt,
  distractorRepairUserPrompt,
  rationaleGenSystemPrompt,
  rationaleGenUserPrompt,
  lectureSummaryGenSystemPrompt,
  lectureSummaryGenUserPrompt,
  courseDescriptionGenSystemPrompt,
  courseDescriptionGenUserPrompt,
  genLabelledTranscripts,
} from '../llm/prompts/generation.js';
import {
  TRUE_FALSE_LABELS,
  callStructured,
  cleanText,
  emptyReport,
  snapTimecode,
  stripOptionLabels,
  transcriptEndSeconds,
  type DraftQuestion,
  type DraftReport,
} from './common.js';
import { balancedKeyPositions, seededCoin, seededRandom, seededShuffle } from './shuffle.js';
import {
  mockCourseDescriptionPayload,
  mockQuizPayload,
  mockRationalePayload,
  mockRepairPayload,
  mockSummaryPayload,
} from './mockDrafts.js';
import { LENGTH_CUE_RATIO, lengthCue, lengthRatio, overlapsWith, normalizeTokens } from './quality.js';

/**
 * Draft/write API контент-скриптов (CONTENT) и конвейера генерации (service.ts).
 *
 * Черновики (draft*) вызывают LLM и возвращают данные БЕЗ записи в БД; запись (write*,
 * replaceQuestions) пишет данные БЕЗ вызова LLM. CONTENT сохраняет черновики в
 * проверенные JSON и применяет их из файлов — повторный прогон на проде
 * детерминирован и ничего не стоит (USER_DECISIONS §5).
 */

export * from './translate.js';
export { localizedTitle, titleLabels, type TitleKind } from './titles.js';
export { seededShuffle, balancedKeyPositions, type ShuffleResult } from './shuffle.js';
export {
  lengthCue,
  lengthRatio,
  tfBalance,
  normalizeTokens,
  jaccard,
  charTrigramSimilarity,
  overlapsWith,
  testwiseScore,
  keyPositionHistogram,
  OVERLAP_THRESHOLDS,
  type OverlapMatch,
  type TfBalance,
} from './quality.js';
export {
  TRUE_FALSE_LABELS,
  getDraftUsage,
  resetDraftUsage,
  parseTranscript,
  snapTimecode,
  type DraftQuestion,
  type DraftReport,
  type DraftUsage,
} from './common.js';

/* ── Загрузка источников ─────────────────────────────────────────── */

/** Лекция-источник: номер для меток «#N» = позиция в списке контекста. */
interface SourceLecture {
  id: string;
  title: string;
  transcript: string;
  summary: string | null;
  durationSec: number | null;
  moduleOrder: number;
  lectureOrder: number;
}

const lectureSelect = {
  id: true,
  title: true,
  transcriptText: true,
  summary: true,
  durationSec: true,
  orderIndex: true,
} satisfies Prisma.LectureSelect;

type LectureRow = Prisma.LectureGetPayload<{ select: typeof lectureSelect }>;

const toSource = (l: LectureRow, moduleOrder: number): SourceLecture => ({
  id: l.id,
  title: l.title,
  transcript: l.transcriptText ?? '',
  summary: l.summary,
  durationSec: l.durationSec,
  moduleOrder,
  lectureOrder: l.orderIndex,
});

async function loadVersion(versionId: string) {
  const version = await prisma.courseLanguageVersion.findUnique({
    where: { id: versionId },
    include: {
      modules: {
        orderBy: { orderIndex: 'asc' },
        include: { lectures: { orderBy: { orderIndex: 'asc' }, select: lectureSelect } },
      },
    },
  });
  if (!version) throw Errors.notFound('Языковая версия не найдена');
  return {
    version,
    language: version.language as Language,
    modules: version.modules.map((m) => ({
      id: m.id,
      title: m.title,
      orderIndex: m.orderIndex,
      assessmentType: m.assessmentType,
      lectures: m.lectures.map((l) => toSource(l, m.orderIndex)),
    })),
  };
}

async function loadModule(moduleId: string) {
  const mod = await prisma.module.findUnique({
    where: { id: moduleId },
    include: {
      languageVersion: { select: { id: true, language: true } },
      lectures: { orderBy: { orderIndex: 'asc' }, select: lectureSelect },
      quiz: { select: { id: true } },
    },
  });
  if (!mod) throw Errors.notFound('Модуль не найден');
  return {
    module: mod,
    language: mod.languageVersion.language as Language,
    lectures: mod.lectures.map((l) => toSource(l, mod.orderIndex)),
  };
}

/** Формулировки неархивных вопросов оцениваемых тестов модулей версии (doNotReuse, A11). */
export async function gradedPromptsOfVersion(versionId: string): Promise<string[]> {
  const rows = await prisma.quizQuestion.findMany({
    where: { archivedAt: null, quiz: { isGraded: true, kind: 'MODULE_FINAL', module: { courseLanguageVersionId: versionId } } },
    select: { prompt: true },
  });
  return rows.map((r) => r.prompt);
}

/** Формулировки неархивных вопросов оцениваемого теста модуля. */
export async function gradedPromptsOfModule(moduleId: string): Promise<string[]> {
  const rows = await prisma.quizQuestion.findMany({
    where: { archivedAt: null, quiz: { isGraded: true, moduleId } },
    select: { prompt: true },
  });
  return rows.map((r) => r.prompt);
}

/** Формулировки тренировочных вопросов, пересекающихся с материалом модуля (мини-квизы его лекций + итоговый). */
export async function practicePromptsForModule(moduleId: string): Promise<string[]> {
  const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { courseLanguageVersionId: true } });
  if (!mod) return [];
  const rows = await prisma.quizQuestion.findMany({
    where: {
      archivedAt: null,
      quiz: {
        isGraded: false,
        OR: [{ lecture: { moduleId } }, { courseLanguageVersionId: mod.courseLanguageVersionId }],
      },
    },
    select: { prompt: true },
  });
  return rows.map((r) => r.prompt);
}

/* ── Цикл качества ───────────────────────────────────────────────── */

interface Candidate {
  draft: DraftQuestion;
  /** Индекс лекции в ctx.lectures (null — модель не указала или вне диапазона). */
  lectureIndex: number | null;
}

interface GenCtx {
  label: string;
  language: Language;
  /** Заголовок для промпта (модуль / лекция / курс). */
  title: string;
  lectures: SourceLecture[];
  optionCount: number;
  doNotReuse: string[];
  report: DraftReport;
  /** Ориентир покрытия лекций (тест модуля); strict — квоты по лекциям обязательны. */
  perLecture?: { index: number; count: number }[];
  perLectureStrict?: boolean;
}

interface GenPlan {
  sc: number;
  tf: number;
  tfTrue?: number;
}

const MAX_FILL_ROUNDS = 2;

/** Грубая оценка лимита вывода: ~900 токенов на вопрос с обоснованиями (кириллица «дороже»). */
const outputBudget = (items: number) => Math.min(16000, 1500 + items * 900);

/** Фразы-«припоминания», запрещённые gen-2.0 (предупреждение рецензенту, а не отказ). */
const RECALL_WORDING =
  /согласно лекци|в лекции|по лекции|лектор|according to the lecture|in the lecture|the lecturer|дәрісте|дәріс бойынша|не упоминается|not mentioned/i;

/**
 * Ссылки на позицию варианта в пояснениях: после перемешивания они становятся
 * неверными («в первом варианте» указывает уже на другой вариант).
 */
const POSITION_REFERENCE =
  /(перв|втор|трет|четв[её]рт|последн)\S*\s+вариант|вариант[а-я]*\s+[A-DА-Г1-4](?![\p{L}\d])|(first|second|third|fourth|last)\s+option|option\s+[A-D1-4]\b|(бірінші|екінші|үшінші|төртінші|соңғы)\s+нұсқа|[A-D]\s*нұсқа/iu;

function toCandidate(q: GeneratedQuestion, ctx: GenCtx, fallbackLecture: number | null): Candidate {
  const isTF = q.type === 'TRUE_FALSE';
  const options = isTF ? [...TRUE_FALSE_LABELS[ctx.language]] : stripOptionLabels((q.options ?? []).map(cleanText));
  let idx: number | null =
    q.source_lecture_index !== undefined && q.source_lecture_index < ctx.lectures.length ? q.source_lecture_index : null;
  if (idx === null) idx = ctx.lectures.length === 1 ? 0 : fallbackLecture;
  const lecture = idx !== null ? ctx.lectures[idx] : undefined;
  return {
    lectureIndex: idx,
    draft: {
      type: q.type,
      prompt: cleanText(q.prompt),
      options,
      correctOptionIds: [...new Set(q.correct_option_indexes)].sort((a, b) => a - b),
      explanation: q.explanation ? cleanText(q.explanation) : null,
      optionRationales: q.option_rationales ? q.option_rationales.map(cleanText) : null,
      sourceLectureId: lecture?.id ?? null,
      sourceTimecode: lecture ? snapTimecode(lecture.transcript, q.source_timecode ?? null) : null,
      difficulty: q.difficulty,
    },
  };
}

/** Причина отказа или null: блюпринт — ровно optionCount вариантов и ОДИН ключ (USER_DECISIONS §5). */
function invalidReason(c: Candidate, ctx: GenCtx): string | null {
  const d = c.draft;
  if (d.prompt.length < 8) return 'пустая формулировка';
  if (d.correctOptionIds.length !== 1) return 'не один верный вариант';
  if (d.type === 'SINGLE_CHOICE') {
    if (d.options.length !== ctx.optionCount) return `вариантов ${d.options.length}, нужно ${ctx.optionCount}`;
    const norm = d.options.map((o) => normalizeTokens(o).join(' '));
    if (new Set(norm).size !== norm.length) return 'повторяющиеся варианты';
    if (d.options.some((o) => /^(все|всё|ни один|all|none|both) (перечисленн|из перечисленн|of the above|вышеперечисленн)/i.test(o))) {
      return 'вариант «всё/ничего из перечисленного»';
    }
  }
  return null;
}

/**
 * Генерация с дозапросами: валидные, непересекающиеся вопросы нужного типа
 * (и нужной лекции для strict-квот); лишние — обрезаются. Отброшенные из-за
 * пересечения перегенерируются ОДИН раз (раунд 1), раунд 2 — только добор
 * недостающих. Не хватило — ошибка (контракт «ровно count»).
 */
async function generateCandidates(ctx: GenCtx, plan: GenPlan): Promise<Candidate[]> {
  const accepted: Candidate[] = [];
  const produced: string[] = [];
  const need = { sc: plan.sc, tf: plan.tf };
  const quota = new Map((ctx.perLectureStrict ? ctx.perLecture ?? [] : []).map((p) => [p.index, p.count]));
  const tfTrueNeeded = () => {
    if (plan.tfTrue === undefined) return undefined;
    const have = accepted.filter((c) => c.draft.type === 'TRUE_FALSE' && c.draft.correctOptionIds[0] === 0).length;
    return Math.max(0, Math.min(need.tf, plan.tfTrue - have));
  };

  for (let round = 0; round <= MAX_FILL_ROUNDS && need.sc + need.tf > 0; round++) {
    const perLecture = ctx.perLectureStrict
      ? [...quota.entries()].filter(([, n]) => n > 0).map(([index, count]) => ({ index, count }))
      : remainingSpread(ctx.perLecture, accepted, need.sc + need.tf);
    const relevant = perLecture && ctx.perLectureStrict ? perLecture.map((p) => p.index) : ctx.lectures.map((_, i) => i);
    const labelled = relevant.map((i) => ({ index: i, title: ctx.lectures[i]!.title, transcript: ctx.lectures[i]!.transcript }));
    // Раунды добора видят и уже принятые, и отброшенные формулировки.
    const avoid = [...ctx.doNotReuse, ...produced];
    const tfTrue = tfTrueNeeded();
    const data = await callStructured(
      ctx.label,
      {
        system: quizGenSystemPrompt(ctx.language),
        user: quizGenUserPrompt({
          transcripts: genLabelledTranscripts(labelled),
          moduleTitle: ctx.title,
          singleChoiceCount: need.sc,
          trueFalseCount: need.tf,
          optionCount: ctx.optionCount,
          trueFalseTrueCount: tfTrue,
          perLecture,
          perLectureStrict: ctx.perLectureStrict,
          doNotReuse: avoid,
        }),
        maxTokens: outputBudget(need.sc + need.tf),
        mock: () =>
          mockQuizPayload({
            language: ctx.language,
            lectures: labelled,
            sc: need.sc,
            tf: need.tf,
            tfTrue,
            optionCount: ctx.optionCount,
            perLecture,
            avoid,
          }),
      },
      quizGenerationSchema,
      ctx.report,
    );

    const strictOrder = perLecture && ctx.perLectureStrict ? perLecture.flatMap((p) => Array(p.count).fill(p.index) as number[]) : [];
    data.questions.forEach((q, pos) => {
      const c = toCandidate(q, ctx, strictOrder[pos] ?? null);
      produced.push(c.draft.prompt);
      const invalid = invalidReason(c, ctx);
      if (invalid) {
        ctx.report.invalidDropped++;
        logger.debug({ label: ctx.label, invalid, prompt: c.draft.prompt.slice(0, 80) }, 'Вопрос отброшен как невалидный');
        return;
      }
      if (c.draft.type === 'SINGLE_CHOICE' ? need.sc <= 0 : need.tf <= 0) return; // лишний — обрезаем
      if (ctx.perLectureStrict && (c.lectureIndex === null || !(quota.get(c.lectureIndex)! > 0))) return;
      const hit = overlapsWith(c.draft.prompt, [...ctx.doNotReuse, ...accepted.map((a) => a.draft.prompt)]);
      if (hit) {
        ctx.report.overlapsDropped++;
        logger.info({ label: ctx.label, prompt: c.draft.prompt.slice(0, 80), with: hit.text.slice(0, 80) }, 'Вопрос отброшен: пересечение формулировок');
        return;
      }
      accepted.push(c);
      if (c.draft.type === 'SINGLE_CHOICE') need.sc--;
      else need.tf--;
      if (ctx.perLectureStrict && c.lectureIndex !== null) quota.set(c.lectureIndex, quota.get(c.lectureIndex)! - 1);
    });
  }

  if (need.sc + need.tf > 0) {
    throw new Error(
      `${ctx.label}: после дозапросов не хватает вопросов (SINGLE_CHOICE ${need.sc}, TRUE_FALSE ${need.tf}) — «${ctx.title}»`,
    );
  }
  return accepted;
}

/**
 * Ориентир покрытия для раунда добора: исходное распределение минус уже принятые
 * вопросы по лекциям. Если сумма не сходится с недостающим числом — без ориентира.
 */
function remainingSpread(
  spread: { index: number; count: number }[] | undefined,
  accepted: Candidate[],
  total: number,
): { index: number; count: number }[] | undefined {
  if (!spread) return undefined;
  const rest = spread
    .map((p) => ({ index: p.index, count: Math.max(0, p.count - accepted.filter((c) => c.lectureIndex === p.index).length) }))
    .filter((p) => p.count > 0);
  return rest.reduce((sum, p) => sum + p.count, 0) === total ? rest : undefined;
}

/** Материалы для вспомогательных вызовов: только лекции-источники затронутых вопросов. */
function sourceTranscripts(ctx: GenCtx, cands: Candidate[]): string {
  const idx = [...new Set(cands.map((c) => c.lectureIndex).filter((i): i is number => i !== null))].sort((a, b) => a - b);
  const use = idx.length ? idx : ctx.lectures.map((_, i) => i);
  return genLabelledTranscripts(use.map((i) => ({ index: i, title: ctx.lectures[i]!.title, transcript: ctx.lectures[i]!.transcript })));
}

/** Верный вариант — строго самый длинный (стратегия «угадывателя», A12). */
const keyIsLongest = (d: DraftQuestion) => {
  const k = d.correctOptionIds[0];
  if (d.type !== 'SINGLE_CHOICE' || k === undefined) return false;
  const keyLen = d.options[k]!.trim().length;
  return d.options.every((o, i) => i === k || o.trim().length < keyLen);
};

/** Доля вопросов набора, где ключ может оставаться самым длинным (ожидание без подсказки — 1/4). */
const MAX_KEY_LONGEST_SHARE = 0.35;

/**
 * Подсказка длиной (ключ > 1.5× медианы дистракторов) и стратегия «самый длинный»
 * (A12): ОДИН вызов ремонта на все такие вопросы — переписываются только дистракторы,
 * ключ и формулировка те же. В ремонт идут все вопросы с подсказкой длиной и, если
 * ключ самый длинный в слишком многих вопросах, — самые «выпирающие» из них.
 * Не помогло — остаётся лучший вариант и предупреждение рецензенту.
 */
async function repairLengthCues(ctx: GenCtx, cands: Candidate[]): Promise<void> {
  const sc = cands.filter((c) => c.draft.type === 'SINGLE_CHOICE' && c.draft.correctOptionIds.length === 1);
  const flagged = sc.filter((c) => lengthCue(c.draft.options, c.draft.correctOptionIds));
  const longest = sc
    .filter((c) => !flagged.includes(c) && keyIsLongest(c.draft))
    .sort((a, b) => (lengthRatio(b.draft.options, b.draft.correctOptionIds) ?? 0) - (lengthRatio(a.draft.options, a.draft.correctOptionIds) ?? 0));
  const allowed = Math.floor(sc.length * MAX_KEY_LONGEST_SHARE);
  const stillLongest = sc.filter((c) => keyIsLongest(c.draft)).length - flagged.filter((c) => keyIsLongest(c.draft)).length;
  const extra = longest.slice(0, Math.max(0, stillLongest - allowed));
  const toRepair = [...flagged, ...extra];
  if (!toRepair.length) return;
  ctx.report.lengthCueRepaired += toRepair.length;

  const items = toRepair.map((c, key) => {
    const k = c.draft.correctOptionIds[0]!;
    const correct = c.draft.options[k]!;
    const n = c.draft.options.length - 1;
    const L = correct.trim().length;
    // Цели длины дистракторов: от ~0.9 до ~1.2 длины ключа — хотя бы один длиннее ключа.
    const targets = Array.from({ length: n }, (_, i) => Math.round(L * (n === 1 ? 1.1 : 0.9 + (0.3 * i) / (n - 1))));
    return { key, prompt: c.draft.prompt, correct, correct_chars: L, distractors: c.draft.options.filter((_, i) => i !== k), target_chars: targets };
  });
  const data = await callStructured(
    `${ctx.label}_repair`,
    {
      system: distractorRepairSystemPrompt(ctx.language),
      user: distractorRepairUserPrompt({ items, transcripts: sourceTranscripts(ctx, toRepair) }),
      maxTokens: outputBudget(toRepair.length),
      mock: () => mockRepairPayload(ctx.language, items),
    },
    distractorRepairSchema,
    ctx.report,
  );
  const byKey = new Map(data.items.map((i) => [i.key, i]));
  toRepair.forEach((c, key) => {
    const fix = byKey.get(key);
    const k = c.draft.correctOptionIds[0]!;
    const oldDistractors = c.draft.options.length - 1;
    const p = c.draft.prompt.slice(0, 80);
    if (!fix || fix.distractors.length !== oldDistractors) {
      ctx.report.warnings.push(`ремонт дистракторов не вернул ${oldDistractors} дистр.: ${p}`);
      return;
    }
    const newDistractors = fix.distractors.map(cleanText);
    const options = [...newDistractors.slice(0, k), c.draft.options[k]!, ...newDistractors.slice(k)];
    const norm = options.map((o) => normalizeTokens(o).join(' '));
    if (new Set(norm).size !== norm.length) {
      ctx.report.warnings.push(`ремонт дал повторяющиеся варианты — оставлен исходный: ${p}`);
      return;
    }
    const before = lengthRatio(c.draft.options, c.draft.correctOptionIds) ?? Infinity;
    const after = lengthRatio(options, c.draft.correctOptionIds) ?? Infinity;
    // Обратная подсказка («самый короткий — верный») тоже недопустима.
    const reverseCue = after < 1 / LENGTH_CUE_RATIO;
    const improved =
      !reverseCue && (keyIsLongest(c.draft) && !keyIsLongest({ ...c.draft, options }) ? after <= Math.max(before, 1.2) : after < before);
    if (!improved) {
      ctx.report.warnings.push(`ремонт не улучшил длины (${before.toFixed(2)}× → ${after.toFixed(2)}×) — оставлен исходный: ${p}`);
      return;
    }
    const drs = fix.distractor_rationales;
    const keyRationale = c.draft.optionRationales?.[k];
    c.draft.options = options;
    c.draft.optionRationales =
      keyRationale && drs && drs.length === oldDistractors
        ? [...drs.slice(0, k).map(cleanText), keyRationale, ...drs.slice(k).map(cleanText)]
        : null; // дозапросим обоснования целиком
  });
  for (const c of flagged) {
    if (lengthCue(c.draft.options, c.draft.correctOptionIds)) {
      const r = lengthRatio(c.draft.options, c.draft.correctOptionIds) ?? 0;
      ctx.report.warnings.push(`подсказка длиной осталась (${r.toFixed(2)}×): ${c.draft.prompt.slice(0, 80)}`);
    }
  }
}

/** Обоснования вариантов и источник для вопросов, где модель их не дала (один вызов). */
async function backfillRationales(ctx: GenCtx, cands: Candidate[]): Promise<void> {
  const missing = cands.filter((c) => !c.draft.optionRationales || c.draft.optionRationales.length !== c.draft.options.length);
  if (!missing.length) return;
  const items = missing.map((c, key) => ({
    key,
    type: c.draft.type,
    prompt: c.draft.prompt,
    options: c.draft.options,
    correct_option_indexes: c.draft.correctOptionIds,
  }));
  const data = await callStructured(
    `${ctx.label}_rationales`,
    {
      system: rationaleGenSystemPrompt(ctx.language),
      user: rationaleGenUserPrompt({ items, transcripts: sourceTranscripts(ctx, missing) }),
      maxTokens: outputBudget(missing.length),
      mock: () => mockRationalePayload(ctx.language, items),
    },
    rationaleBackfillSchema,
    ctx.report,
  );
  const byKey = new Map(data.items.map((i) => [i.key, i]));
  missing.forEach((c, key) => {
    const r = byKey.get(key);
    if (r && r.option_rationales.length === c.draft.options.length) {
      c.draft.optionRationales = r.option_rationales.map(cleanText);
      if (!c.draft.sourceLectureId && r.source_lecture_index !== undefined) {
        const lec = ctx.lectures[r.source_lecture_index];
        if (lec) {
          c.lectureIndex = r.source_lecture_index;
          c.draft.sourceLectureId = lec.id;
          c.draft.sourceTimecode = snapTimecode(lec.transcript, r.source_timecode ?? null);
        }
      }
    } else {
      ctx.report.warnings.push(`нет обоснований вариантов: ${c.draft.prompt.slice(0, 80)}`);
    }
  });
}

/** Полный цикл: генерация → ремонт подсказки длиной → обоснования. Без перемешивания. */
async function runQualityLoop(ctx: GenCtx, plan: GenPlan): Promise<Candidate[]> {
  const cands = await generateCandidates(ctx, plan);
  await repairLengthCues(ctx, cands);
  await backfillRationales(ctx, cands);
  for (const c of cands) {
    const p = c.draft.prompt.slice(0, 80);
    if (!c.draft.sourceLectureId) ctx.report.warnings.push(`не определена лекция-источник: ${p}`);
    if (RECALL_WORDING.test(c.draft.prompt)) ctx.report.warnings.push(`формулировка-«припоминание»: ${p}`);
    if ([c.draft.explanation ?? '', ...(c.draft.optionRationales ?? [])].some((t) => POSITION_REFERENCE.test(t))) {
      ctx.report.warnings.push(`пояснение ссылается на позицию варианта (после перемешивания неверно): ${p}`);
    }
  }
  return cands;
}

/**
 * Перемешивание с равномерными позициями ключа по набору (TRUE_FALSE не трогаем).
 * seed вопроса: canonicalKey, иначе `${seedBase}:${n}` (A17).
 */
function shuffleSet(drafts: DraftQuestion[], seedBase: string): DraftQuestion[] {
  const sc = drafts.map((d, i) => ({ d, i })).filter(({ d }) => d.type === 'SINGLE_CHOICE' && d.correctOptionIds.length === 1);
  const optionCount = Math.max(MODULE_QUIZ_OPTIONS, ...sc.map(({ d }) => d.options.length));
  const positions = balancedKeyPositions(sc.length, optionCount, seedBase);
  const out = [...drafts];
  sc.forEach(({ d, i }, k) => {
    const r = seededShuffle(d.options, d.correctOptionIds, d.optionRationales, d.canonicalKey ?? `${seedBase}:${i}`, {
      keyPosition: Math.min(positions[k]!, d.options.length - 1),
    });
    out[i] = { ...d, options: r.options, correctOptionIds: r.correctOptionIds, optionRationales: r.optionRationales };
  });
  return out;
}

/** Распределение count вопросов по лекциям: поровну, остаток — самым длинным расшифровкам. */
function distribute(count: number, lectures: SourceLecture[]): { index: number; count: number }[] {
  if (!lectures.length) return [];
  const base = Math.floor(count / lectures.length);
  let rest = count - base * lectures.length;
  const byLength = lectures.map((l, i) => ({ i, len: l.transcript.length })).sort((a, b) => b.len - a.len);
  const extra = new Set<number>();
  for (const { i } of byLength) if (rest-- > 0) extra.add(i);
  return lectures.map((_, i) => ({ index: i, count: base + (extra.has(i) ? 1 : 0) })).filter((p) => p.count > 0);
}

const finishReport = (report: DraftReport, onReport?: (r: DraftReport) => void) => {
  if (report.warnings.length) logger.warn({ warnings: report.warnings.slice(0, 20) }, 'Черновик генерации: предупреждения');
  onReport?.(report);
};

function typePlan(count: number, types: Partial<Record<'SINGLE_CHOICE' | 'TRUE_FALSE', number>> | undefined, seed: string): GenPlan {
  const tf = Math.max(0, types?.TRUE_FALSE ?? 0);
  const sc = count - tf;
  if (sc < 0) throw Errors.badRequest(`TRUE_FALSE (${tf}) больше общего числа вопросов (${count})`);
  // Баланс ключей TRUE_FALSE: половина верных, нечётный остаток — по seed (аудит: 18/24 «верно»).
  const tfTrue = Math.floor(tf / 2) + (tf % 2 === 1 && seededCoin(seed) ? 1 : 0);
  return { sc, tf, tfTrue };
}

/* ── Публичные черновики ─────────────────────────────────────────── */

export interface ModuleQuizDraftOptions {
  /** Сколько вопросов (по умолчанию MODULE_QUIZ_QUESTIONS = 8). */
  count?: number;
  /** Число по типам; по умолчанию все SINGLE_CHOICE (блюпринт USER_DECISIONS §5). */
  types?: Partial<Record<'SINGLE_CHOICE' | 'TRUE_FALSE', number>>;
  /** Формулировки, которые нельзя повторять (тренировочные вопросы и т. п.). */
  doNotReuse?: string[];
  /** Префикс canonicalKey, напр. 'polit:M2' → polit:M2:Q1..Q8. */
  canonicalKeyPrefix?: string;
  /** База seed перемешивания без canonicalKeyPrefix (по умолчанию id теста модуля или модуля). */
  seedBase?: string;
  /** Отчёт цикла качества (предупреждения для рецензента). */
  onReport?: (r: DraftReport) => void;
}

/**
 * Черновик оцениваемого теста модуля: ровно count вопросов × MODULE_QUIZ_OPTIONS
 * вариантов, один ключ, без подсказки длиной, с обоснованиями и источником,
 * перемешанные с равномерными позициями ключа. В БД НЕ пишет.
 */
export async function draftModuleQuiz(moduleId: string, opts: ModuleQuizDraftOptions = {}): Promise<DraftQuestion[]> {
  const { module: mod, language, lectures } = await loadModule(moduleId);
  const withText = lectures.filter((l) => l.transcript.trim());
  if (!withText.length) throw Errors.badRequest(`В модуле «${mod.title}» нет расшифровок лекций`);
  const count = opts.count ?? MODULE_QUIZ_QUESTIONS;
  const seedBase = opts.canonicalKeyPrefix ?? opts.seedBase ?? mod.quiz?.id ?? `module:${moduleId}`;
  const plan = typePlan(count, opts.types, seedBase);
  const report = emptyReport();
  const ctx: GenCtx = {
    label: 'quiz_gen',
    language,
    title: mod.title,
    lectures: withText,
    optionCount: MODULE_QUIZ_OPTIONS,
    doNotReuse: opts.doNotReuse ?? [],
    report,
    perLecture: distribute(count, withText),
  };
  const cands = await runQualityLoop(ctx, plan);
  const drafts = cands.map((c, i) => ({
    ...c.draft,
    ...(opts.canonicalKeyPrefix ? { canonicalKey: `${opts.canonicalKeyPrefix}:Q${i + 1}` } : {}),
  }));
  finishReport(report, opts.onReport);
  return shuffleSet(drafts, seedBase);
}

export interface MiniQuizDraftOptions {
  /** Сколько вопросов (по умолчанию 3). */
  count?: number;
  /** По умолчанию: count−1 SINGLE_CHOICE + 1 TRUE_FALSE (при count ≥ 3). */
  types?: Partial<Record<'SINGLE_CHOICE' | 'TRUE_FALSE', number>>;
  /** По умолчанию — неархивные вопросы оцениваемого теста модуля лекции (A11). */
  doNotReuse?: string[];
  canonicalKeyPrefix?: string;
  seedBase?: string;
  onReport?: (r: DraftReport) => void;
}

export const MINI_QUIZ_QUESTIONS = 3;

/** Черновик тренировочного мини-квиза лекции — строго по её расшифровке. В БД НЕ пишет. */
export async function draftMiniQuiz(lectureId: string, opts: MiniQuizDraftOptions = {}): Promise<DraftQuestion[]> {
  const lec = await prisma.lecture.findUnique({
    where: { id: lectureId },
    select: {
      ...lectureSelect,
      moduleId: true,
      module: { select: { orderIndex: true, languageVersion: { select: { language: true } } } },
      miniQuiz: { select: { id: true } },
    },
  });
  if (!lec) throw Errors.notFound('Лекция не найдена');
  if (!lec.transcriptText?.trim()) throw Errors.badRequest(`У лекции «${lec.title}» нет расшифровки`);
  const language = lec.module.languageVersion.language as Language;
  const count = opts.count ?? MINI_QUIZ_QUESTIONS;
  const seedBase = opts.canonicalKeyPrefix ?? opts.seedBase ?? lec.miniQuiz?.id ?? `lecture:${lectureId}`;
  const types = opts.types ?? (count >= 3 ? { SINGLE_CHOICE: count - 1, TRUE_FALSE: 1 } : { SINGLE_CHOICE: count });
  const report = emptyReport();
  const ctx: GenCtx = {
    label: 'mini_quiz_gen',
    language,
    title: lec.title,
    lectures: [toSource(lec, lec.module.orderIndex)],
    optionCount: MODULE_QUIZ_OPTIONS,
    doNotReuse: opts.doNotReuse ?? (await gradedPromptsOfModule(lec.moduleId)),
    report,
  };
  const cands = await runQualityLoop(ctx, typePlan(count, types, seedBase));
  const drafts = cands.map((c, i) => ({
    ...c.draft,
    ...(opts.canonicalKeyPrefix ? { canonicalKey: `${opts.canonicalKeyPrefix}:Q${i + 1}` } : {}),
  }));
  finishReport(report, opts.onReport);
  return shuffleSet(drafts, seedBase);
}

export interface CourseFinalDraftOptions {
  /** По умолчанию — все неархивные вопросы оцениваемых тестов версии (A11). */
  doNotReuse?: string[];
  /** Ограничить модулями с этими orderIndex (для пробных прогонов). */
  moduleOrderIndexes?: number[];
  /** Лекции, для которых вопрос НЕ нужен (уже покрыты сохранёнными ручными правками). */
  skipLectureIds?: string[];
  canonicalKeyPrefix?: string;
  seedBase?: string;
  onReport?: (r: DraftReport) => void;
}

/**
 * Черновик итогового мини-квиза курса: COURSE_FINAL_QUESTIONS_PER_LECTURE вопрос(ов)
 * на КАЖДУЮ лекцию — из её собственной расшифровки, по одному вызову на модуль
 * (раньше единый промпт на 370 тыс. символов «залипал» на лекциях 1–2).
 * Порядок — по лекциям. В БД НЕ пишет.
 */
export async function draftCourseFinal(versionId: string, opts: CourseFinalDraftOptions = {}): Promise<DraftQuestion[]> {
  const { version, language, modules } = await loadVersion(versionId);
  const doNotReuse = opts.doNotReuse ?? (await gradedPromptsOfVersion(versionId));
  const skip = new Set(opts.skipLectureIds ?? []);
  const seedBase = opts.canonicalKeyPrefix ?? opts.seedBase ?? `course-final:${versionId}`;
  const perLecture = COURSE_FINAL_QUESTIONS_PER_LECTURE;
  const report = emptyReport();
  const all: Candidate[] = [];
  const accepted: string[] = [];

  for (const m of modules) {
    if (opts.moduleOrderIndexes && !opts.moduleOrderIndexes.includes(m.orderIndex)) continue;
    const lectures = m.lectures.filter((l) => l.transcript.trim() && !skip.has(l.id));
    if (!lectures.length) continue;
    const count = lectures.length * perLecture;
    const ctx: GenCtx = {
      label: 'course_final_gen',
      language,
      title: `${version.title} — ${m.title}`,
      lectures,
      optionCount: MODULE_QUIZ_OPTIONS,
      // Пересечения проверяем и с уже принятыми вопросами предыдущих модулей.
      doNotReuse: [...doNotReuse, ...accepted],
      report,
      perLecture: lectures.map((_, i) => ({ index: i, count: perLecture })),
      perLectureStrict: true,
    };
    const cands = await runQualityLoop(ctx, { sc: count, tf: 0 });
    // Порядок по лекциям модуля.
    cands.sort((a, b) => (a.lectureIndex ?? 0) - (b.lectureIndex ?? 0));
    all.push(...cands);
    accepted.push(...cands.map((c) => c.draft.prompt));
  }

  const drafts = all.map((c, i) => ({
    ...c.draft,
    ...(opts.canonicalKeyPrefix ? { canonicalKey: `${opts.canonicalKeyPrefix}:Q${i + 1}` } : {}),
  }));
  finishReport(report, opts.onReport);
  return shuffleSet(drafts, seedBase);
}

/* ── Замена отдельных вопросов ───────────────────────────────────── */

/** Какие лекции — источник вопросов теста (по виду теста). */
async function quizContext(quizId: string) {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      questions: { where: { archivedAt: null }, orderBy: { orderIndex: 'asc' } },
      module: { select: { id: true, title: true, orderIndex: true, courseLanguageVersionId: true } },
      lecture: { select: { id: true, title: true, module: { select: { courseLanguageVersionId: true } } } },
    },
  });
  if (!quiz) throw Errors.notFound('Тест не найден');
  const versionId =
    quiz.module?.courseLanguageVersionId ?? quiz.lecture?.module.courseLanguageVersionId ?? quiz.courseLanguageVersionId;
  if (!versionId) throw Errors.badRequest('Тест не привязан к языковой версии');
  const { version, language, modules } = await loadVersion(versionId);
  const allLectures = modules.flatMap((m) => m.lectures);
  let lectures: SourceLecture[];
  if (quiz.kind === 'LECTURE_MINI' && quiz.lectureId) lectures = allLectures.filter((l) => l.id === quiz.lectureId);
  else if (quiz.kind === 'MODULE_FINAL' && quiz.moduleId) lectures = modules.find((m) => m.id === quiz.moduleId)?.lectures ?? [];
  else lectures = allLectures;
  return { quiz, version, language, lectures: lectures.filter((l) => l.transcript.trim()) };
}

/**
 * Лекция-источник вопроса итогового мини-квиза без sourceLectureId: та, чья
 * расшифровка содержит больше слов вопроса и вариантов (грубая, но дешёвая оценка).
 */
function guessLecture(text: string, lectures: SourceLecture[]): number {
  const tokens = [...new Set(normalizeTokens(text).filter((t) => t.length > 3))];
  let best = 0;
  let bestScore = -1;
  lectures.forEach((l, i) => {
    const vocab = new Set(normalizeTokens(l.transcript));
    const score = tokens.filter((t) => vocab.has(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** Группировка вопросов по набору лекций-источников (для итогового — по лекции вопроса). */
function groupBySource(
  questions: { id: string; prompt: string; options: unknown; sourceLectureId: string | null }[],
  lectures: SourceLecture[],
  perQuestion: boolean,
): Map<string, { lectures: SourceLecture[]; ids: string[] }> {
  const groups = new Map<string, { lectures: SourceLecture[]; ids: string[] }>();
  for (const q of questions) {
    let key = 'all';
    let lecs = lectures;
    if (perQuestion) {
      let i = lectures.findIndex((l) => l.id === q.sourceLectureId);
      if (i === -1) i = guessLecture(`${q.prompt} ${(q.options as string[]).join(' ')}`, lectures);
      key = lectures[i]!.id;
      lecs = [lectures[i]!];
    }
    const g = groups.get(key) ?? { lectures: lecs, ids: [] };
    g.ids.push(q.id);
    groups.set(key, g);
  }
  return groups;
}

/** Позиции ключа для замен: наименее занятые в оставшейся части теста (детерминированно по seed). */
function pickKeyPositions(keptKeys: number[], n: number, optionCount: number, seed: string): number[] {
  const hist = Array.from({ length: optionCount }, (_, p) => keptKeys.filter((k) => k === p).length);
  const rnd = seededRandom(`${seed}:replace-positions`);
  const tiebreak = hist.map(() => rnd());
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let best = 0;
    for (let p = 1; p < optionCount; p++) {
      if (hist[p]! < hist[best]! || (hist[p] === hist[best] && tiebreak[p]! < tiebreak[best]!)) best = p;
    }
    hist[best]!++;
    out.push(best);
  }
  return out;
}

/**
 * Черновики замены отдельных вопросов (напр. пересечение с оцениваемыми, A11):
 * того же типа, из того же источника, с новой формулировкой. Map<questionId, черновик>.
 * seed перемешивания — id заменяемого вопроса (A17). В БД НЕ пишет.
 */
export async function draftReplacementQuestions(
  quizId: string,
  questionIds: string[],
  opts: { doNotReuse?: string[]; onReport?: (r: DraftReport) => void } = {},
): Promise<Map<string, DraftQuestion>> {
  const { quiz, language, lectures } = await quizContext(quizId);
  const targets = quiz.questions.filter((q) => questionIds.includes(q.id));
  const missing = questionIds.filter((id) => !targets.some((q) => q.id === id));
  if (missing.length) throw Errors.notFound(`Вопросы не найдены среди неархивных вопросов теста: ${missing.join(', ')}`);
  if (!lectures.length) throw Errors.badRequest('У теста нет лекций с расшифровками');

  const kept = quiz.questions.filter((q) => !questionIds.includes(q.id));
  const report = emptyReport();
  const result = new Map<string, DraftQuestion>();
  const groups = groupBySource(targets, lectures, quiz.kind === 'COURSE_FINAL');
  const title = quiz.title;

  for (const [, g] of groups) {
    const qs = g.ids.map((id) => targets.find((q) => q.id === id)!);
    const sc = qs.filter((q) => q.type === 'SINGLE_CHOICE');
    const tf = qs.filter((q) => q.type === 'TRUE_FALSE');
    const ctx: GenCtx = {
      label: 'quiz_replace_gen',
      language,
      title,
      lectures: g.lectures,
      optionCount: MODULE_QUIZ_OPTIONS,
      doNotReuse: [
        ...(opts.doNotReuse ?? []),
        ...kept.map((q) => q.prompt),
        ...qs.map((q) => q.prompt), // замена должна отличаться от заменяемого
        ...[...result.values()].map((d) => d.prompt),
      ],
      report,
    };
    const cands = await runQualityLoop(ctx, typePlan(qs.length, { TRUE_FALSE: tf.length }, qs[0]!.id));
    const scCands = cands.filter((c) => c.draft.type === 'SINGLE_CHOICE');
    const tfCands = cands.filter((c) => c.draft.type === 'TRUE_FALSE');
    const keptKeys = kept.filter((q) => q.type === 'SINGLE_CHOICE').map((q) => (q.correctOptionIds as number[])[0]!);
    const positions = pickKeyPositions(keptKeys, sc.length, MODULE_QUIZ_OPTIONS, quizId);
    sc.forEach((q, i) => {
      const d = scCands[i]!.draft;
      const r = seededShuffle(d.options, d.correctOptionIds, d.optionRationales, q.id, { keyPosition: positions[i] });
      result.set(q.id, {
        ...d,
        options: r.options,
        correctOptionIds: r.correctOptionIds,
        optionRationales: r.optionRationales,
        ...(q.canonicalKey ? { canonicalKey: q.canonicalKey } : {}),
      });
    });
    tf.forEach((q, i) => result.set(q.id, { ...tfCands[i]!.draft, ...(q.canonicalKey ? { canonicalKey: q.canonicalKey } : {}) }));
  }
  finishReport(report, opts.onReport);
  return result;
}

/* ── Обоснования для существующих вопросов ───────────────────────── */

export interface RationaleRow {
  questionId: string;
  optionRationales: string[];
  sourceLectureId: string | null;
  sourceTimecode: string | null;
  /** Снимок, по которому writeRationales проверяет, что вопрос не изменился. */
  prompt: string;
  options: string[];
  correctOptionIds: number[];
}

/**
 * Обоснования вариантов (+ источник) для СУЩЕСТВУЮЩИХ вопросов теста — формулировка,
 * варианты и ключ не меняются. По умолчанию — только вопросы без optionRationales.
 * В БД НЕ пишет.
 */
export async function draftRationales(
  quizId: string,
  opts: { onlyMissing?: boolean; questionIds?: string[]; onReport?: (r: DraftReport) => void } = {},
): Promise<RationaleRow[]> {
  const { quiz, language, lectures } = await quizContext(quizId);
  const onlyMissing = opts.onlyMissing ?? true;
  const targets = quiz.questions.filter(
    (q) => (!opts.questionIds || opts.questionIds.includes(q.id)) && (!onlyMissing || q.optionRationales === null),
  );
  if (!targets.length) return [];
  if (!lectures.length) throw Errors.badRequest('У теста нет лекций с расшифровками');
  const report = emptyReport();
  const rows: RationaleRow[] = [];
  const groups = groupBySource(targets, lectures, quiz.kind === 'COURSE_FINAL');

  for (const [, g] of groups) {
    const qs = g.ids.map((id) => targets.find((q) => q.id === id)!);
    for (let start = 0; start < qs.length; start += 10) {
      const chunk = qs.slice(start, start + 10);
      let pending = chunk.map((q, key) => ({ q, key }));
      for (let attempt = 0; attempt < 2 && pending.length; attempt++) {
        const items = pending.map(({ q, key }) => ({
          key,
          type: q.type,
          prompt: q.prompt,
          options: q.options as string[],
          correct_option_indexes: q.correctOptionIds as number[],
        }));
        const data = await callStructured(
          'rationale_gen',
          {
            system: rationaleGenSystemPrompt(language),
            user: rationaleGenUserPrompt({
              items,
              transcripts: genLabelledTranscripts(g.lectures.map((l, i) => ({ index: i, title: l.title, transcript: l.transcript }))),
            }),
            maxTokens: outputBudget(pending.length),
            mock: () => mockRationalePayload(language, items),
          },
          rationaleBackfillSchema,
          report,
        );
        const byKey = new Map(data.items.map((i) => [i.key, i]));
        const retry: typeof pending = [];
        for (const p of pending) {
          const r = byKey.get(p.key);
          const options = p.q.options as string[];
          if (!r || r.option_rationales.length !== options.length) {
            retry.push(p);
            continue;
          }
          const lec =
            r.source_lecture_index !== undefined ? g.lectures[r.source_lecture_index] : g.lectures.length === 1 ? g.lectures[0] : undefined;
          rows.push({
            questionId: p.q.id,
            optionRationales: r.option_rationales.map(cleanText),
            sourceLectureId: lec?.id ?? p.q.sourceLectureId,
            sourceTimecode: lec ? snapTimecode(lec.transcript, r.source_timecode ?? null) : p.q.sourceTimecode,
            prompt: p.q.prompt,
            options,
            correctOptionIds: p.q.correctOptionIds as number[],
          });
        }
        pending = retry;
      }
      for (const p of pending) report.warnings.push(`обоснования не получены: ${p.q.prompt.slice(0, 80)}`);
    }
  }
  finishReport(report, opts.onReport);
  return rows;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Запись обоснований (без LLM, одна транзакция). Проверяет, что формулировка,
 * варианты и ключ НЕ изменились со времени черновика; пишет только optionRationales
 * и источник (источник — если в строке он задан). Возвращает число обновлённых.
 */
export async function writeRationales(rows: RationaleRow[]): Promise<number> {
  return prisma.$transaction(async (tx) => {
    let n = 0;
    for (const row of rows) {
      const q = await tx.quizQuestion.findUnique({ where: { id: row.questionId } });
      if (!q) throw Errors.notFound(`Вопрос ${row.questionId} не найден`);
      const mismatch = [
        row.prompt !== undefined && row.prompt !== q.prompt ? 'prompt' : null,
        row.options !== undefined && !sameJson(row.options, q.options) ? 'options' : null,
        row.correctOptionIds !== undefined && !sameJson(row.correctOptionIds, q.correctOptionIds) ? 'correctOptionIds' : null,
      ].filter(Boolean);
      if (mismatch.length) {
        throw Errors.conflict(`Вопрос ${row.questionId} изменился после черновика (${mismatch.join(', ')}) — перегенерируйте обоснования`);
      }
      const options = q.options as string[];
      if (row.optionRationales.length !== options.length) {
        throw Errors.validation(`Вопрос ${row.questionId}: обоснований ${row.optionRationales.length}, вариантов ${options.length}`);
      }
      const tc = row.sourceTimecode ? normalizeTimecode(row.sourceTimecode) : undefined;
      await tx.quizQuestion.update({
        where: { id: q.id },
        data: {
          optionRationales: row.optionRationales,
          ...(row.sourceLectureId ? { sourceLectureId: row.sourceLectureId } : {}),
          ...(tc ? { sourceTimecode: tc } : {}),
        },
      });
      n++;
    }
    return n;
  });
}

/* ── Запись вопросов ─────────────────────────────────────────────── */

/** Архивные вопросы уводятся из «рабочего» диапазона orderIndex (@@unique([quizId, orderIndex])). */
export const ARCHIVE_ORDER_BASE = 10000;

/**
 * orderIndex архивного вопроса: 10000 + batch·100 + прежний индекс, где batch —
 * номер партии архивации теста. Прежний индекс обязан быть < 100.
 */
export function archivedOrderIndex(old: number, batch: number): number {
  if (!Number.isInteger(old) || old < 0 || old >= 100) throw new Error(`archivedOrderIndex: индекс ${old} вне 0..99`);
  if (!Number.isInteger(batch) || batch < 0) throw new Error(`archivedOrderIndex: партия ${batch} некорректна`);
  return ARCHIVE_ORDER_BASE + batch * 100 + old;
}

type Tx = Prisma.TransactionClient;

/** Номер следующей партии архивации: число различных archivedAt (и не меньше занятых диапазонов). */
async function nextArchiveBatch(tx: Tx, quizId: string): Promise<number> {
  const archived = await tx.quizQuestion.findMany({
    where: { quizId, archivedAt: { not: null } },
    select: { archivedAt: true, orderIndex: true },
  });
  const distinct = new Set(archived.map((a) => a.archivedAt!.getTime())).size;
  const maxIdx = archived.reduce((m, a) => Math.max(m, a.orderIndex), -1);
  const byRange = maxIdx >= ARCHIVE_ORDER_BASE ? Math.floor((maxIdx - ARCHIVE_ORDER_BASE) / 100) + 1 : 0;
  return Math.max(distinct, byRange);
}

/**
 * Архивирует вопросы (archivedAt = now) и переносит их orderIndex в архивный диапазон.
 * Уже архивные строки, оставшиеся в рабочем диапазоне, тоже переносятся (их archivedAt
 * не меняется), чтобы освободить индексы 0..n.
 */
export async function archiveQuestionsTx(tx: Tx, quizId: string, questionIds: string[] | 'ALL_ACTIVE'): Promise<number> {
  const rows = await tx.quizQuestion.findMany({
    where: { quizId, orderIndex: { lt: ARCHIVE_ORDER_BASE } },
    select: { id: true, orderIndex: true, archivedAt: true },
  });
  const toArchive = rows.filter((r) => r.archivedAt === null && (questionIds === 'ALL_ACTIVE' || questionIds.includes(r.id)));
  const strays = questionIds === 'ALL_ACTIVE' ? rows.filter((r) => r.archivedAt !== null) : [];
  if (!toArchive.length && !strays.length) return 0;
  const batch = await nextArchiveBatch(tx, quizId);
  const now = new Date();
  for (const r of [...toArchive, ...strays]) {
    await tx.quizQuestion.update({
      where: { id: r.id },
      data: { archivedAt: r.archivedAt ?? now, orderIndex: archivedOrderIndex(r.orderIndex, batch) },
    });
  }
  return toArchive.length;
}

const DIFFICULTIES: readonly Difficulty[] = ['VERY_EASY', 'EASY', 'MEDIUM', 'HARD'];

/** Проверка черновика перед записью (данные могли быть поправлены вручную в JSON). */
export function assertDraftQuestion(d: DraftQuestion, where = ''): void {
  const at = where ? `${where}: ` : '';
  if (d.type !== 'SINGLE_CHOICE' && d.type !== 'TRUE_FALSE') throw Errors.validation(`${at}неизвестный тип ${String(d.type)}`);
  if (!d.prompt?.trim()) throw Errors.validation(`${at}пустая формулировка`);
  if (!Array.isArray(d.options) || d.options.length < 2 || d.options.some((o) => typeof o !== 'string' || !o.trim())) {
    throw Errors.validation(`${at}варианты некорректны`);
  }
  if (d.type === 'TRUE_FALSE' && d.options.length !== 2) throw Errors.validation(`${at}TRUE_FALSE требует 2 варианта`);
  if (!d.correctOptionIds.length || d.correctOptionIds.some((i) => !Number.isInteger(i) || i < 0 || i >= d.options.length)) {
    throw Errors.validation(`${at}ключ вне диапазона вариантов`);
  }
  if (d.optionRationales && d.optionRationales.length !== d.options.length) {
    throw Errors.validation(`${at}обоснований ${d.optionRationales.length}, вариантов ${d.options.length}`);
  }
  if (d.sourceTimecode && !normalizeTimecode(d.sourceTimecode)) throw Errors.validation(`${at}таймкод ${d.sourceTimecode} некорректен`);
  if (!DIFFICULTIES.includes(d.difficulty)) throw Errors.validation(`${at}сложность ${String(d.difficulty)} некорректна`);
}

const questionData = (d: DraftQuestion) => ({
  type: d.type,
  prompt: d.prompt.trim(),
  options: d.options,
  correctOptionIds: d.correctOptionIds,
  explanation: d.explanation ?? null,
  difficulty: d.difficulty,
  // null → SQL NULL: замена на месте не должна оставлять обоснования старого вопроса.
  optionRationales: d.optionRationales ?? Prisma.DbNull,
  sourceLectureId: d.sourceLectureId ?? null,
  sourceTimecode: d.sourceTimecode ? normalizeTimecode(d.sourceTimecode)! : null,
  isAIGenerated: true,
  isEdited: false,
});

/** Лекции-источники черновиков должны принадлежать языковой версии теста (защита от ошибок сопоставления). */
async function assertSourcesInVersion(tx: Tx, quizId: string, items: DraftQuestion[]): Promise<void> {
  const ids = [...new Set(items.map((i) => i.sourceLectureId).filter((x): x is string => !!x))];
  if (!ids.length) return;
  const quiz = await tx.quiz.findUnique({
    where: { id: quizId },
    select: {
      courseLanguageVersionId: true,
      module: { select: { courseLanguageVersionId: true } },
      lecture: { select: { module: { select: { courseLanguageVersionId: true } } } },
    },
  });
  const versionId =
    quiz?.module?.courseLanguageVersionId ?? quiz?.lecture?.module.courseLanguageVersionId ?? quiz?.courseLanguageVersionId;
  const lectures = await tx.lecture.findMany({
    where: { id: { in: ids } },
    select: { id: true, module: { select: { courseLanguageVersionId: true } } },
  });
  const bad = ids.filter((id) => lectures.find((l) => l.id === id)?.module.courseLanguageVersionId !== versionId);
  if (bad.length) throw Errors.validation(`Лекции-источники не из языковой версии теста: ${bad.join(', ')}`);
}

export interface WriteQuizQuestionsOptions {
  /** ARCHIVE_REPLACE — архивировать текущие вопросы и записать новые 0..n−1; APPEND — дописать после текущих. */
  mode: 'ARCHIVE_REPLACE' | 'APPEND';
  /** Ключ ContentMigration: пишется в той же транзакции; если уже применён — ничего не делаем. */
  ledgerKey?: string;
  /** Сводка для ContentMigration.detail. */
  ledgerDetail?: Record<string, unknown>;
  /** Разрешить запись при незавершённой попытке теста (по умолчанию — отказ). */
  allowInProgress?: boolean;
}

/**
 * Запись вопросов в тест (без LLM, одна транзакция). ARCHIVE_REPLACE — единственный
 * путь замены оцениваемого банка (CONTENT, под контролем): старые вопросы
 * АРХИВИРУЮТСЯ, а не удаляются — прошлые попытки сохраняют смысл (USER_DECISIONS §5).
 * Возвращает id новых вопросов; [] — если ledgerKey уже применён.
 */
export async function writeQuizQuestions(quizId: string, items: DraftQuestion[], opts: WriteQuizQuestionsOptions): Promise<string[]> {
  items.forEach((d, i) => assertDraftQuestion(d, `вопрос ${i + 1}`));
  if (items.length >= 100) throw Errors.validation('Не более 99 вопросов в тесте');
  return prisma.$transaction(
    async (tx) => {
      if (opts.ledgerKey && (await tx.contentMigration.findUnique({ where: { key: opts.ledgerKey } }))) {
        logger.info({ quizId, ledgerKey: opts.ledgerKey }, 'writeQuizQuestions: уже применено (ledger)');
        return [];
      }
      const quiz = await tx.quiz.findUnique({ where: { id: quizId }, select: { id: true } });
      if (!quiz) throw Errors.notFound('Тест не найден');
      if (!opts.allowInProgress) {
        const inProgress = await tx.quizAttempt.count({ where: { quizId, submittedAt: null } });
        if (inProgress) {
          throw Errors.coded(409, ApiErrorCode.QUIZ_FROZEN, `У теста ${inProgress} незавершённых попыток — запись вопросов отложите`);
        }
      }
      await assertSourcesInVersion(tx, quizId, items);

      let start = 0;
      if (opts.mode === 'ARCHIVE_REPLACE') {
        await archiveQuestionsTx(tx, quizId, 'ALL_ACTIVE');
      } else {
        const last = await tx.quizQuestion.findFirst({
          where: { quizId, orderIndex: { lt: ARCHIVE_ORDER_BASE } },
          orderBy: { orderIndex: 'desc' },
          select: { orderIndex: true },
        });
        start = last ? last.orderIndex + 1 : 0;
        if (start + items.length > 100) throw Errors.validation('Рабочий диапазон orderIndex переполнен');
      }

      const ids: string[] = [];
      for (const [i, d] of items.entries()) {
        const row = await tx.quizQuestion.create({
          data: { quizId, orderIndex: start + i, canonicalKey: d.canonicalKey ?? null, ...questionData(d) },
          select: { id: true },
        });
        ids.push(row.id);
      }
      if (opts.ledgerKey) {
        await tx.contentMigration.create({
          data: {
            key: opts.ledgerKey,
            detail: { quizId, mode: opts.mode, questionIds: ids, ...(opts.ledgerDetail ?? {}) } as Prisma.InputJsonValue,
          },
        });
      }
      return ids;
    },
    { timeout: 30_000 },
  );
}

/** Есть ли у теста попытки (любые, в т. ч. незавершённые). */
export async function quizHasAttempts(quizId: string): Promise<boolean> {
  return (await prisma.quizAttempt.count({ where: { quizId } })) > 0;
}

/**
 * id вопросов теста, на которые ссылаются попытки: ключи answers и presentation.questionIds;
 * попытка без presentation (устаревшая) ссылается на все неархивные вопросы.
 */
async function referencedQuestionIds(tx: Tx, quizId: string): Promise<Set<string>> {
  const attempts = await tx.quizAttempt.findMany({ where: { quizId }, select: { answers: true, presentation: true } });
  const ids = new Set<string>();
  let legacy = false;
  for (const a of attempts) {
    for (const k of Object.keys((a.answers ?? {}) as Record<string, unknown>)) ids.add(k);
    const qids = (a.presentation as { questionIds?: unknown } | null)?.questionIds;
    if (Array.isArray(qids)) qids.forEach((q) => typeof q === 'string' && ids.add(q));
    else legacy = true;
  }
  if (legacy) {
    const active = await tx.quizQuestion.findMany({ where: { quizId, archivedAt: null }, select: { id: true } });
    active.forEach((q) => ids.add(q.id));
  }
  return ids;
}

/**
 * Замена вопросов на месте (без LLM, одна транзакция): id и orderIndex сохраняются.
 * Разрешена для тренировочных тестов и для вопросов, на которые не ссылается ни одна
 * попытка; иначе — 409 QUIZ_FROZEN. Возвращает id заменённых.
 */
export async function replaceQuestions(quizId: string, map: Map<string, DraftQuestion> | Record<string, DraftQuestion>): Promise<string[]> {
  const entries = map instanceof Map ? [...map.entries()] : Object.entries(map);
  entries.forEach(([id, d]) => assertDraftQuestion(d, id));
  return prisma.$transaction(async (tx) => {
    const quiz = await tx.quiz.findUnique({ where: { id: quizId }, select: { isGraded: true } });
    if (!quiz) throw Errors.notFound('Тест не найден');
    await assertSourcesInVersion(tx, quizId, entries.map(([, d]) => d));
    const referenced = quiz.isGraded ? await referencedQuestionIds(tx, quizId) : new Set<string>();
    const done: string[] = [];
    for (const [id, d] of entries) {
      const q = await tx.quizQuestion.findUnique({ where: { id }, select: { quizId: true, archivedAt: true, canonicalKey: true } });
      if (!q || q.quizId !== quizId) throw Errors.notFound(`Вопрос ${id} не найден в тесте`);
      if (q.archivedAt) throw Errors.conflict(`Вопрос ${id} архивирован`);
      if (referenced.has(id)) {
        throw Errors.coded(409, ApiErrorCode.QUIZ_FROZEN, `На вопрос ${id} ссылаются попытки — замена на месте запрещена`);
      }
      await tx.quizQuestion.update({
        where: { id },
        data: { ...questionData(d), canonicalKey: d.canonicalKey ?? q.canonicalKey },
      });
      done.push(id);
    }
    return done;
  });
}

/* ── Краткие содержания лекций ───────────────────────────────────── */

/** Целевая длина краткого содержания (жёсткий предел БД — LECTURE_SUMMARY_MAX_CHARS). */
export const LECTURE_SUMMARY_TARGET_CHARS = 400;

/** Снимает кавычки, если модель обернула ими весь текст (и внутри кавычек нет). */
function unquote(text: string): string {
  const m = /^[«"“](.*)[»"”]$/s.exec(text);
  return m && !/[«»"“”]/.test(m[1]!) ? m[1]!.trim() : text;
}

/** Обрезка по границе предложения, не длиннее max. */
function clipSentences(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.endsWith('.') ? cut.length - 1 : -1);
  return end > max * 0.5 ? cut.slice(0, end + 1).trim() : `${cut.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Краткое содержание лекции: 2–3 нейтральных предложения, ≤ 400 символов, на языке
 * лекции. Если модель превысила — один повтор с требованием сократить. В БД НЕ пишет.
 */
export async function draftLectureSummary(lectureId: string, opts: { onReport?: (r: DraftReport) => void } = {}): Promise<string> {
  const lec = await prisma.lecture.findUnique({
    where: { id: lectureId },
    select: { title: true, transcriptText: true, module: { select: { languageVersion: { select: { language: true } } } } },
  });
  if (!lec) throw Errors.notFound('Лекция не найдена');
  if (!lec.transcriptText?.trim()) throw Errors.badRequest(`У лекции «${lec.title}» нет расшифровки`);
  const language = lec.module.languageVersion.language as Language;
  const report = emptyReport();
  const ask = async (extra?: string) =>
    cleanText(
      (
        await callStructured(
          'lecture_summary_gen',
          {
            system: lectureSummaryGenSystemPrompt(language, LECTURE_SUMMARY_TARGET_CHARS),
            user: lectureSummaryGenUserPrompt({ title: lec.title, transcript: lec.transcriptText }) + (extra ? `\n${extra}` : ''),
            maxTokens: 800,
            mock: () => mockSummaryPayload(language, lec.title),
          },
          lectureSummarySchema,
          report,
        )
      ).summary,
    );
  let summary = unquote(await ask());
  if (summary.length > LECTURE_SUMMARY_TARGET_CHARS) {
    summary = unquote(
      await ask(
        `Предыдущий вариант был длиной ${summary.length} символов — сократи до ${LECTURE_SUMMARY_TARGET_CHARS} символов, сохранив 2–3 предложения.`,
      ),
    );
  }
  if (summary.length > LECTURE_SUMMARY_TARGET_CHARS) report.warnings.push(`краткое содержание длиннее ${LECTURE_SUMMARY_TARGET_CHARS}: ${summary.length}`);
  finishReport(report, opts.onReport);
  return clipSentences(summary, LECTURE_SUMMARY_MAX_CHARS);
}

/**
 * Задача LECTURE_SUMMARY: KEEP/APPEND — пропускает лекции с готовым кратким
 * содержанием, OVERWRITE — заменяет. Возвращает true, если записано.
 */
export async function generateLectureSummary(lectureId: string, strategy: 'OVERWRITE' | 'APPEND' | 'KEEP' = 'KEEP'): Promise<boolean> {
  const lec = await prisma.lecture.findUnique({ where: { id: lectureId }, select: { summary: true, transcriptText: true } });
  if (!lec) throw Errors.notFound('Лекция не найдена');
  if (strategy !== 'OVERWRITE' && lec.summary?.trim()) return false;
  if (!lec.transcriptText?.trim()) return false;
  const summary = await draftLectureSummary(lectureId);
  await prisma.lecture.update({ where: { id: lectureId }, data: { summary } });
  return true;
}

/* ── Описание курса ──────────────────────────────────────────────── */

const pluralRu = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

/** Строка охвата курса — из данных, а не от модели (числа должны быть точными). */
export function courseScopeLine(
  language: Language,
  s: { lectures: number; hours: number; moduleQuizzes: number; hasPractical: boolean },
): string {
  const h = Number.isInteger(s.hours) ? String(s.hours) : s.hours.toFixed(1).replace('.', language === 'en' ? '.' : ',');
  const parts: string[] =
    language === 'kk'
      ? [`${s.lectures} дәріс`, `≈ ${h} сағ бейне`, `${s.moduleQuizzes} бөлім тесті`]
      : language === 'en'
        ? [`${s.lectures} ${s.lectures === 1 ? 'lecture' : 'lectures'}`, `≈ ${h} h of video`, `${s.moduleQuizzes} module ${s.moduleQuizzes === 1 ? 'quiz' : 'quizzes'}`]
        : [
            `${s.lectures} ${pluralRu(s.lectures, 'лекция', 'лекции', 'лекций')}`,
            `≈ ${h} ч видео`,
            `${s.moduleQuizzes} ${pluralRu(s.moduleQuizzes, 'тест', 'теста', 'тестов')} по разделам`,
          ];
  if (s.hasPractical) {
    parts.push(
      language === 'kk'
        ? 'ЖИ-тьютормен қорытынды практикалық тапсырма'
        : language === 'en'
          ? 'final practical task with the AI tutor'
          : 'итоговое практическое задание с ИИ-тьютором',
    );
  }
  parts.push(language === 'kk' ? 'сертификат' : language === 'en' ? 'certificate' : 'сертификат');
  return parts.join(' · ');
}

const OUTCOMES_HEADING: Record<Language, string> = {
  ru: 'Результаты обучения:',
  kk: 'Оқыту нәтижелері:',
  en: 'Learning outcomes:',
};

/**
 * Описание курса для каталога: 3–5 предложений, 4–6 результатов обучения и строка
 * охвата (лекции, часы видео, тесты разделов, итоговое практическое с ИИ-тьютором,
 * сертификат). В БД НЕ пишет (CONTENT применяет после согласования).
 */
export async function draftCourseDescription(versionId: string, opts: { onReport?: (r: DraftReport) => void } = {}): Promise<string> {
  const { version, language, modules } = await loadVersion(versionId);
  const lectures = modules.flatMap((m) => m.lectures);
  const seconds = lectures.reduce((sum, l) => sum + (l.durationSec ?? transcriptEndSeconds(l.transcript) ?? 20 * 60), 0);
  const hours = Math.round((seconds / 3600) * 2) / 2;
  const moduleQuizzes = modules.filter((m) => m.assessmentType === 'QUIZ').length;
  const hasPractical = modules.some((m) => m.assessmentType === 'PRACTICAL');
  const report = emptyReport();
  const data = await callStructured(
    'course_description_gen',
    {
      system: courseDescriptionGenSystemPrompt(language),
      user: courseDescriptionGenUserPrompt({
        courseTitle: version.title,
        modules: modules.map((m) => ({ title: m.title, lectures: m.lectures.map((l) => ({ title: l.title, summary: l.summary })) })),
      }),
      maxTokens: 1500,
      mock: () => mockCourseDescriptionPayload(language, version.title),
    },
    courseDescriptionSchema,
    report,
  );
  const outcomes = data.outcomes.map(cleanText).filter(Boolean).slice(0, 6);
  if (outcomes.length < 4) report.warnings.push(`результатов обучения ${outcomes.length} (нужно 4–6)`);
  finishReport(report, opts.onReport);
  return [
    cleanText(data.description),
    '',
    OUTCOMES_HEADING[language],
    ...outcomes.map((o) => `• ${o}`),
    '',
    courseScopeLine(language, { lectures: lectures.length, hours, moduleQuizzes, hasPractical }),
  ].join('\n');
}
