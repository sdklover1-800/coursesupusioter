import { z } from 'zod';

/**
 * Схемы структурированного вывода LLM (Приложения B, C, D).
 * Ответ модели ВСЕГДА валидируется по этим схемам (FR-7.1, §5.7);
 * при невалидности — повтор/ремонт запроса.
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
}

export const generatedQuestionSchema: z.ZodType<GeneratedQuestion, z.ZodTypeDef, unknown> = z
  .object({
    type: questionTypeEnum,
    prompt: z.string().min(1),
    options: z.array(z.string().min(1)).min(2).max(6).optional(),
    correct_option_indexes: z.array(z.number().int().nonnegative()).min(1),
    explanation: z.string().optional(),
    difficulty: difficultyEnum,
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
  });
export interface QuizGeneration {
  questions: GeneratedQuestion[];
}

export const quizGenerationSchema: z.ZodType<QuizGeneration, z.ZodTypeDef, unknown> = z.object({
  questions: z.array(generatedQuestionSchema).min(1),
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

export const practicalGenerationSchema: z.ZodType<PracticalGeneration, z.ZodTypeDef, unknown> = z.object({
  student_facing_scenario: z.string().min(1),
  reference_solution: z.string().min(1),
  rubric: practicalRubricSchema,
  recommended_token_budget: coerceIntPositive,
  recommended_max_ai_messages: coerceIntPositive,
  difficulty: optionalDifficulty,
});

/* ── Приложение D: per-turn вывод сократического цикла ─────────── */

/** Оценка хода рассуждений (рубрика §5.5), шкалы 0..3 */
export const reasoningAssessmentSchema = z.object({
  methodicalness: z.number().int().min(0).max(3),
  question_quality: z.number().int().min(0).max(3),
  logical_progression: z.number().int().min(0).max(3),
  self_correction: z.number().int().min(0).max(3),
  notes: z.string().default(''),
});
export type ReasoningAssessment = z.infer<typeof reasoningAssessmentSchema>;

/** Полный per-turn результат (однокальный режим возвращает всё сразу) */
export const socraticTurnSchema = z.object({
  student_reached_answer: z.boolean(),
  reasoning_assessment: reasoningAssessmentSchema,
  tutor_message: z.string().min(1),
});
export type SocraticTurn = z.infer<typeof socraticTurnSchema>;

/** Вывод «судьи» в двухвызовном режиме (без tutor_message) */
export const judgeOutputSchema = z.object({
  student_reached_answer: z.boolean(),
  reasoning_assessment: reasoningAssessmentSchema,
});
export type JudgeOutput = z.infer<typeof judgeOutputSchema>;

/** Вывод «тьютора» в двухвызовном режиме (только реплика, эталон не в контексте) */
export const tutorOutputSchema = z.object({
  tutor_message: z.string().min(1),
});
export type TutorOutput = z.infer<typeof tutorOutputSchema>;

/** Агрегат рубрики по завершении сессии (сохраняется в PracticalSession.evaluationResult) */
export const rubricAggregateSchema = z.object({
  turns: z.number().int().nonnegative(),
  avg_methodicalness: z.number(),
  avg_question_quality: z.number(),
  avg_logical_progression: z.number(),
  avg_self_correction: z.number(),
  /** Достижение ответа — отдельная метрика (§5.5): «сдал» ≠ «качество мышления» */
  reached_answer: z.boolean(),
  reached_at_turn: z.number().int().nullable(),
});
export type RubricAggregate = z.infer<typeof rubricAggregateSchema>;
