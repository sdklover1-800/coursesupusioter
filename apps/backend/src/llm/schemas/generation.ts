import { z } from 'zod';

/**
 * Схемы структурированного вывода LLM для ГЕНЕРАЦИИ контента (Приложения B, C).
 * Ответ модели ВСЕГДА валидируется по этим схемам (FR-7.1, §5.7);
 * при невалидности — повтор/ремонт запроса.
 * Перенесено из @edu/shared (critique A9): фронтенду схемы не нужны.
 * gen-2.0: у вопроса необязательные option_rationales / source_lecture_index /
 * source_timecode (старые ответы по-прежнему валидны) и схемы вспомогательных
 * вызовов цикла качества и переводов (generation/drafts.ts).
 * Схемы диалога практикума — в ./dialog.ts.
 */

/**
 * Модели устойчиво возвращают enum'ы в свободном регистре («medium», «very easy»).
 * Нормализуем перед проверкой — это не ослабляет контракт, а снимает ложные
 * отказы валидации на верном по смыслу ответе.
 */
const normalizeEnum = (v: unknown) =>
  typeof v === 'string' ? v.trim().toUpperCase().replace(/[\s-]+/g, '_') : v;

type DifficultyValue = 'VERY_EASY' | 'EASY' | 'MEDIUM' | 'HARD';
type QuestionTypeValue = 'SINGLE_CHOICE' | 'TRUE_FALSE';

// Тип аннотирован явно: без этого выводимый тип схлопывается до string
// при генерации .d.ts, и потребители теряют строгий enum.
const difficultyEnum: z.ZodType<DifficultyValue, z.ZodTypeDef, unknown> = z.preprocess(
  normalizeEnum,
  z.enum(['VERY_EASY', 'EASY', 'MEDIUM', 'HARD']),
);

const questionTypeEnum: z.ZodType<QuestionTypeValue, z.ZodTypeDef, unknown> = z.preprocess(
  normalizeEnum,
  z.enum(['SINGLE_CHOICE', 'TRUE_FALSE']),
);

/* ── Приложение B: генерация теста ─────────────────────────────── */

/** Модели часто пишут null вместо пропуска необязательного поля — трактуем как пропуск. */
const nullToUndefined = (v: unknown) => (v === null ? undefined : v);

/**
 * Таймкод источника → 'mm:ss' (минуты могут быть > 59). Принимает 'm:ss', 'h:mm:ss'
 * и диапазон '[mm:ss–mm:ss]' (берётся начало). Нераспознанное — пропуск, а не отказ:
 * источник вспомогателен и не должен ронять всю генерацию (gen-2.0).
 */
export function normalizeTimecode(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /(?:(\d{1,2})\s*:\s*)?(\d{1,3})\s*:\s*(\d{2})/.exec(v);
  if (!m) return undefined;
  const hours = m[1] === undefined ? 0 : Number(m[1]);
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  if (seconds > 59 || (m[1] !== undefined && minutes > 59)) return undefined;
  const total = hours * 60 + minutes;
  return `${String(total).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const optionalTimecode = z.preprocess(normalizeTimecode, z.string().optional());

// Индекс лекции-источника: число или строка «#2»/«2»; иначе — пропуск.
const optionalIndex = z.preprocess((v) => {
  if (typeof v === 'string') v = Number(v.replace(/[^\d]/g, '') || NaN);
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined;
}, z.number().int().nonnegative().optional());

const optionalStringList = z.preprocess(
  (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : String(x ?? ''))) : undefined),
  z.array(z.string()).optional(),
);

/** Явный выходной тип: иначе при сборке .d.ts enum-поля схлопываются до unknown. */
export interface GeneratedQuestion {
  type: QuestionTypeValue;
  prompt: string;
  /**
   * Для SINGLE_CHOICE обязателен. Для TRUE_FALSE необязателен: метки
   * «верно/неверно» принадлежат платформе и подставляются локализованно
   * (модели устойчиво опускают это поле, считая варианты подразумеваемыми).
   */
  options?: string[];
  /** Индексы правильных вариантов (в MVP — ровно один, но массив на будущее) */
  correct_option_indexes: number[];
  explanation?: string;
  difficulty: DifficultyValue;
  /**
   * gen-2.0: по одному предложению на вариант — почему он верен/неверен. Той же
   * длины, что options (для TRUE_FALSE — 2: «верно», «неверно»). При несовпадении
   * длины поле отбрасывается (генерация дозапросит обоснования отдельно).
   */
  option_rationales?: string[];
  /** gen-2.0: индекс лекции-источника в переданном списке лекций (метки «#N»). */
  source_lecture_index?: number;
  /** gen-2.0: 'mm:ss' — начало раздела расшифровки, на который опирается вопрос. */
  source_timecode?: string;
}

export const generatedQuestionSchema: z.ZodType<GeneratedQuestion, z.ZodTypeDef, unknown> = z
  .object({
    type: questionTypeEnum,
    prompt: z.string().min(1),
    options: z.preprocess(nullToUndefined, z.array(z.string().min(1)).min(2).max(6).optional()),
    correct_option_indexes: z.array(z.number().int().nonnegative()).min(1),
    explanation: z.preprocess(nullToUndefined, z.string().optional()),
    difficulty: difficultyEnum,
    option_rationales: optionalStringList,
    source_lecture_index: optionalIndex,
    source_timecode: optionalTimecode,
  })
  .superRefine((q, ctx) => {
    if (q.type === 'SINGLE_CHOICE' && (!q.options || q.options.length < 2)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SINGLE_CHOICE требует минимум 2 варианта' });
      return;
    }
    if (q.type === 'TRUE_FALSE') {
      // Варианты подставит платформа; проверяем только корректность индекса.
      if (q.correct_option_indexes.some((i) => i > 1)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'TRUE_FALSE: индекс должен быть 0 (верно) или 1 (неверно)' });
      }
      return;
    }
    for (const idx of q.correct_option_indexes) {
      if (idx >= (q.options?.length ?? 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `correct_option_index ${idx} вне диапазона options` });
      }
    }
  })
  .transform((q) => {
    const expected = q.type === 'TRUE_FALSE' ? 2 : (q.options?.length ?? 0);
    const rationalesOk = q.option_rationales && q.option_rationales.length === expected && q.option_rationales.every(Boolean);
    const out: GeneratedQuestion = {
      type: q.type,
      prompt: q.prompt,
      correct_option_indexes: q.correct_option_indexes,
      difficulty: q.difficulty,
    };
    if (q.options !== undefined) out.options = q.options;
    if (q.explanation !== undefined) out.explanation = q.explanation;
    if (rationalesOk) out.option_rationales = q.option_rationales;
    if (q.source_lecture_index !== undefined) out.source_lecture_index = q.source_lecture_index;
    if (q.source_timecode !== undefined) out.source_timecode = q.source_timecode;
    return out;
  });
export interface QuizGeneration {
  questions: GeneratedQuestion[];
}

export const quizGenerationSchema: z.ZodType<QuizGeneration, z.ZodTypeDef, unknown> = z.object({
  questions: z.array(generatedQuestionSchema).min(1),
});

/* ── gen-2.0: вспомогательные вызовы цикла качества и переводов ──── */

const keyField = z.coerce.number().int().nonnegative();

/** Ремонт дистракторов (подсказка длиной): только новые дистракторы, ключ не трогаем. */
export interface DistractorRepair {
  items: { key: number; distractors: string[]; distractor_rationales?: string[] }[];
}
export const distractorRepairSchema: z.ZodType<DistractorRepair, z.ZodTypeDef, unknown> = z.object({
  items: z.array(
    z.object({
      key: keyField,
      distractors: z.array(z.string().min(1)).min(1),
      distractor_rationales: optionalStringList,
    }),
  ),
});

/** Обоснования и источник для СУЩЕСТВУЮЩИХ вопросов (текст/варианты/ключ не меняются). */
export interface RationaleBackfill {
  items: { key: number; option_rationales: string[]; source_lecture_index?: number; source_timecode?: string }[];
}
export const rationaleBackfillSchema: z.ZodType<RationaleBackfill, z.ZodTypeDef, unknown> = z.object({
  items: z.array(
    z.object({
      key: keyField,
      option_rationales: z.array(z.string().min(1)).min(2),
      source_lecture_index: optionalIndex,
      source_timecode: optionalTimecode,
    }),
  ),
});

/** Перевод канонических вопросов: порядок вариантов и ключ сохраняются вызывающим кодом. */
export interface QuestionTranslation {
  items: { key: number; prompt: string; options?: string[]; option_rationales?: string[]; explanation?: string }[];
}
export const questionTranslationSchema: z.ZodType<QuestionTranslation, z.ZodTypeDef, unknown> = z.object({
  items: z.array(
    z.object({
      key: keyField,
      prompt: z.string().min(1),
      options: optionalStringList,
      option_rationales: optionalStringList,
      explanation: z.preprocess(nullToUndefined, z.string().optional()),
    }),
  ),
});

/** Краткое содержание лекции. */
export interface LectureSummaryGen {
  summary: string;
}
export const lectureSummarySchema: z.ZodType<LectureSummaryGen, z.ZodTypeDef, unknown> = z.object({
  summary: z.string().min(1),
});

/** Перевод/корректура одного раздела расшифровки (таймкод раздела вызывающий код не передаёт). */
export interface TranscriptSectionGen {
  title?: string;
  text: string;
  notes?: string[];
}
export const transcriptSectionSchema: z.ZodType<TranscriptSectionGen, z.ZodTypeDef, unknown> = z.object({
  title: z.preprocess(nullToUndefined, z.string().optional()),
  text: z.string().min(1),
  notes: optionalStringList,
});

/** Перевод канонического практического задания (ключевые тезисы — 1:1). */
export interface PracticalTranslation {
  scenario_prompt: string;
  reference_solution: string;
  key_points: string[];
  answer_reached_criteria: string;
  agenda?: string[];
  intro_message?: string;
}
export const practicalTranslationSchema: z.ZodType<PracticalTranslation, z.ZodTypeDef, unknown> = z.object({
  scenario_prompt: z.string().min(1),
  reference_solution: z.string().min(1),
  key_points: z.array(z.string().min(1)).min(1),
  answer_reached_criteria: z.string().min(1),
  agenda: optionalStringList,
  intro_message: z.preprocess(nullToUndefined, z.string().optional()),
});

/** Описание курса для каталога: абзац + результаты обучения. */
export interface CourseDescriptionGen {
  description: string;
  outcomes: string[];
}
export const courseDescriptionSchema: z.ZodType<CourseDescriptionGen, z.ZodTypeDef, unknown> = z.object({
  description: z.string().min(1),
  outcomes: z.array(z.string().min(1)).min(1),
});

/* ── Приложение C: генерация практического задания ─────────────── */

export interface PracticalRubric {
  key_points: string[];
  answer_reached_criteria: string;
}

// Модель естественно варьирует формат: key_points могут быть объектами,
// answer_reached_criteria — массивом критериев. Приводим к строкам, а не отвергаем.
const toStringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean) : [];
const toText = (v: unknown): string => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('; ') : String(v ?? ''));

export const practicalRubricSchema: z.ZodType<PracticalRubric, z.ZodTypeDef, unknown> = z.object({
  key_points: z.preprocess((v) => (Array.isArray(v) ? toStringList(v) : v), z.array(z.string().min(1)).min(1)),
  answer_reached_criteria: z.preprocess((v) => (typeof v === 'string' ? v : toText(v)), z.string().min(1)),
});

export interface PracticalGeneration {
  student_facing_scenario: string;
  /** Эталонное решение — СКРЫТО от студента (§5.3) */
  reference_solution: string;
  rubric: PracticalRubric;
  recommended_token_budget: number;
  recommended_max_ai_messages: number;
  difficulty?: DifficultyValue;
}

// Уровень сложности задаёт менеджер (§16), поэтому в выводе модели он необязателен
// и толерантен к формату (иногда приходит объектом) — тогда игнорируется.
const optionalDifficulty = z.preprocess(
  (v) => (typeof v === 'string' ? normalizeEnum(v) : undefined),
  z.enum(['VERY_EASY', 'EASY', 'MEDIUM', 'HARD']).optional(),
);
// Числа иногда приходят строками — коэрсим.
const coerceIntPositive = z.coerce.number().int().positive();

// Модель иногда вкладывает рекомендации внутрь rubric (GPT-5.x) — поднимаем их на верхний уровень.
const HOISTED_FROM_RUBRIC = ['recommended_token_budget', 'recommended_max_ai_messages', 'difficulty'] as const;
const hoistFromRubric = (v: unknown): unknown => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  const obj = v as Record<string, unknown>;
  const rubric = obj.rubric;
  if (!rubric || typeof rubric !== 'object' || Array.isArray(rubric)) return v;
  const out: Record<string, unknown> = { ...obj };
  for (const k of HOISTED_FROM_RUBRIC) {
    if (out[k] === undefined && (rubric as Record<string, unknown>)[k] !== undefined) out[k] = (rubric as Record<string, unknown>)[k];
  }
  return out;
};

export const practicalGenerationSchema: z.ZodType<PracticalGeneration, z.ZodTypeDef, unknown> = z.preprocess(
  hoistFromRubric,
  z.object({
    student_facing_scenario: z.string().min(1),
    reference_solution: z.string().min(1),
    rubric: practicalRubricSchema,
    recommended_token_budget: coerceIntPositive,
    recommended_max_ai_messages: coerceIntPositive,
    difficulty: optionalDifficulty,
  }),
);
