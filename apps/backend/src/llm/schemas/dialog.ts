import { z } from 'zod';

/**
 * Схемы структурированного вывода LLM для ДИАЛОГА практикума (Приложение D).
 * Ответ модели ВСЕГДА валидируется по этим схемам (FR-7.1, §5.7);
 * при невалидности — повтор/ремонт запроса.
 * Перенесено из @edu/shared (critique A9): фронтенду схемы не нужны.
 * Схемы генерации контента — в ./generation.ts.
 */

/* ── Приложение D: per-turn вывод сократического цикла ─────────── */

/** Критерии рубрики хода рассуждений (§5.5) — порядок фиксирован. */
export const RUBRIC_CRITERIA = ['methodicalness', 'question_quality', 'logical_progression', 'self_correction'] as const;
export type RubricCriterionKey = (typeof RUBRIC_CRITERIA)[number];

/** Оценка хода рассуждений (рубрика §5.5), шкалы 0..3 */
export const reasoningAssessmentSchema = z.object({
  methodicalness: z.number().int().min(0).max(3),
  question_quality: z.number().int().min(0).max(3),
  logical_progression: z.number().int().min(0).max(3),
  self_correction: z.number().int().min(0).max(3),
  notes: z.string().default(''),
});
export type ReasoningAssessment = z.infer<typeof reasoningAssessmentSchema>;

/**
 * Номер ключевого тезиса K1..Kn (A4): судья возвращает НОМЕРА, а не тексты тезисов —
 * иначе на kk/en (13 тезисов) вывод раздувается на сотни токенов и обрывается по лимиту.
 * Модель иногда пишет «K3» или «3» строкой — приводим к числу; мусор отбрасываем.
 */
function toKeyPointIndex(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string') {
    const m = /^\s*[KkКк]?\s*(\d{1,3})\s*$/.exec(v);
    return m ? Number(m[1]) : null;
  }
  return null;
}
const keyPointList = z
  .preprocess(
    (v) => (Array.isArray(v) ? v.map(toKeyPointIndex).filter((x): x is number => x !== null) : v),
    z.array(z.number().int()),
  )
  .default([]);

/**
 * Вывод «судьи» в двухвызовном режиме (без tutor_message). Порядок полей = порядок
 * генерации: сначала рассуждение, вердикт ПОСЛЕДНИМ (калибровка A.1). Информационные
 * covered/missing — по тезисам; criterion_missing — элементы, которых ТРЕБУЕТ критерий
 * достижения ответа и которые студент ещё не установил (A2). Пустой criterion_missing —
 * обязательное условие PASS (страж в rules.ts).
 */
export const judgeOutputSchema = z.object({
  reasoning_assessment: reasoningAssessmentSchema,
  covered_key_points: keyPointList,
  missing_key_points: keyPointList,
  criterion_missing: z.array(z.string()),
  student_reached_answer: z.boolean(),
});
export type JudgeOutput = z.infer<typeof judgeOutputSchema>;

/**
 * Нормализация вывода судьи под конкретную рубрику: номера тезисов вне 1..n
 * отбрасываются (дубликаты — тоже), пустые метки criterion_missing — убираются.
 */
export function normalizeJudgeOutput(data: JudgeOutput, keyPointCount: number): JudgeOutput {
  const clean = (xs: number[]) => [...new Set(xs.filter((i) => i >= 1 && i <= keyPointCount))].sort((a, b) => a - b);
  return {
    ...data,
    covered_key_points: clean(data.covered_key_points),
    missing_key_points: clean(data.missing_key_points),
    criterion_missing: data.criterion_missing.map((s) => s.trim()).filter(Boolean),
  };
}

/** Полный per-turn результат однокального режима: вывод судьи + реплика тьютора. */
export const socraticTurnSchema = judgeOutputSchema.extend({
  tutor_message: z.string().min(1),
});
export type SocraticTurn = z.infer<typeof socraticTurnSchema>;

/** Вывод «тьютора» в двухвызовном режиме (только реплика, эталон не в контексте) */
export const tutorOutputSchema = z.object({
  tutor_message: z.string().min(1),
});
export type TutorOutput = z.infer<typeof tutorOutputSchema>;

/* ── Проверка реплики на раскрытие ответа (A21) ─────────────────── */

/** Семантическая проверка реплики тьютора: раскрывает ли она тезисы/вывод/критерии. */
export const leakCheckOutputSchema = z.object({
  leaks: z.boolean(),
  reason: z.string().default(''),
});
export type LeakCheckOutput = z.infer<typeof leakCheckOutputSchema>;

/** Проверка текста итоговой оценки: номера строк, раскрывающих содержание ответа (A6). */
export const summaryLeakCheckOutputSchema = z.object({
  leaks: z.boolean(),
  lines: z.array(z.coerce.number().int()).default([]),
  reason: z.string().default(''),
});
export type SummaryLeakCheckOutput = z.infer<typeof summaryLeakCheckOutputSchema>;

/* ── Итоговая оценка сессии для студента (A6) ───────────────────── */

const criterionKey = z.enum(RUBRIC_CRITERIA);

/**
 * Вывод модели для SessionEvaluation: строки по критериям, 2 сильные стороны,
 * 2 «что развивать», до 6 отмеченных реплик СТУДЕНТА (по id). Баллы критериев
 * модель не пишет — их считает сервер по пошаговым оценкам.
 */
export const evaluationSummaryOutputSchema = z.object({
  criteria: z.array(z.object({ key: criterionKey, line: z.string() })).default([]),
  strengths: z.array(z.string()).default([]),
  to_develop: z.array(z.string()).default([]),
  highlights: z
    .array(
      z.object({
        message_id: z.string(),
        criterion: criterionKey,
        polarity: z.enum(['plus', 'minus']),
        note: z.string(),
      }),
    )
    .default([]),
});
export type EvaluationSummaryOutput = z.infer<typeof evaluationSummaryOutputSchema>;

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
