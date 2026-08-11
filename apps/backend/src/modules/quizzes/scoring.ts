/**
 * Чистая логика оценивания теста (FR-5.4). Вынесена из маршрута, чтобы
 * авторитетный серверный подсчёт балла можно было тестировать без БД.
 */

export interface ScorableQuestion {
  id: string;
  correctOptionIds: number[];
  explanation?: string | null;
}

export interface QuestionReview {
  questionId: string;
  isCorrect: boolean;
  correctOptionIds: number[];
  explanation?: string | null;
}

export interface QuizScore {
  score: number; // доля 0..1
  passed: boolean;
  correctCount: number;
  total: number;
  review: QuestionReview[];
}

/** Совпадение множеств выбранных и правильных индексов (порядок не важен). */
export function isAnswerCorrect(given: number[], correct: number[]): boolean {
  if (given.length !== correct.length) return false;
  const g = [...given].sort((a, b) => a - b);
  const c = [...correct].sort((a, b) => a - b);
  return g.every((v, i) => v === c[i]);
}

/**
 * Оценивает попытку. `answers` — { questionId: number[] }.
 * Балл = доля верных вопросов; passed по порогу (>=).
 */
export function scoreQuiz(
  questions: ScorableQuestion[],
  answers: Record<string, number[]>,
  passThreshold: number,
): QuizScore {
  let correctCount = 0;
  const review: QuestionReview[] = questions.map((q) => {
    const isCorrect = isAnswerCorrect(answers[q.id] ?? [], q.correctOptionIds);
    if (isCorrect) correctCount++;
    return { questionId: q.id, isCorrect, correctOptionIds: q.correctOptionIds, explanation: q.explanation };
  });
  const total = questions.length;
  const score = total ? correctCount / total : 0;
  return { score, passed: score >= passThreshold, correctCount, total, review };
}
