import { describe, it, expect } from 'vitest';
import { quizGenerationSchema, practicalGenerationSchema } from '@edu/shared';

/**
 * Регресс-тесты на реальные дефекты, найденные в пилоте генерации:
 * модель отдаёт enum'ы в нижнем регистре и опускает options у TRUE_FALSE.
 */
describe('quizGenerationSchema (§5.2, Прил. B)', () => {
  it('нормализует difficulty в свободном регистре («medium» → MEDIUM)', () => {
    const r = quizGenerationSchema.parse({
      questions: [
        { type: 'SINGLE_CHOICE', prompt: 'Q?', options: ['A', 'B'], correct_option_indexes: [0], difficulty: 'medium' },
      ],
    });
    expect(r.questions[0]!.difficulty).toBe('MEDIUM');
  });

  it('нормализует type и «very easy» → VERY_EASY', () => {
    const r = quizGenerationSchema.parse({
      questions: [
        { type: 'single_choice', prompt: 'Q?', options: ['A', 'B'], correct_option_indexes: [1], difficulty: 'very easy' },
      ],
    });
    expect(r.questions[0]!.type).toBe('SINGLE_CHOICE');
    expect(r.questions[0]!.difficulty).toBe('VERY_EASY');
  });

  it('TRUE_FALSE без options валиден (метки подставит платформа)', () => {
    const r = quizGenerationSchema.parse({
      questions: [{ type: 'TRUE_FALSE', prompt: 'Верно ли X?', correct_option_indexes: [0], difficulty: 'EASY' }],
    });
    expect(r.questions[0]!.type).toBe('TRUE_FALSE');
    expect(r.questions[0]!.options).toBeUndefined();
  });

  it('TRUE_FALSE с индексом > 1 отклоняется', () => {
    expect(() =>
      quizGenerationSchema.parse({
        questions: [{ type: 'TRUE_FALSE', prompt: 'X?', correct_option_indexes: [2], difficulty: 'EASY' }],
      }),
    ).toThrow();
  });

  it('SINGLE_CHOICE без options отклоняется', () => {
    expect(() =>
      quizGenerationSchema.parse({
        questions: [{ type: 'SINGLE_CHOICE', prompt: 'X?', correct_option_indexes: [0], difficulty: 'EASY' }],
      }),
    ).toThrow();
  });

  it('индекс правильного ответа вне диапазона options отклоняется', () => {
    expect(() =>
      quizGenerationSchema.parse({
        questions: [{ type: 'SINGLE_CHOICE', prompt: 'X?', options: ['A', 'B'], correct_option_indexes: [5], difficulty: 'MEDIUM' }],
      }),
    ).toThrow();
  });

  it('пустой список вопросов отклоняется', () => {
    expect(() => quizGenerationSchema.parse({ questions: [] })).toThrow();
  });
});

describe('practicalGenerationSchema (§5.3, Прил. C)', () => {
  const valid = {
    student_facing_scenario: 'Разберите утверждение критически.',
    reference_solution: 'Скрытый эталон.',
    rubric: { key_points: ['тезис 1'], answer_reached_criteria: 'критерий' },
    recommended_token_budget: 9000,
    recommended_max_ai_messages: 22,
    difficulty: 'medium',
  };

  it('валиден и нормализует difficulty', () => {
    const r = practicalGenerationSchema.parse(valid);
    expect(r.difficulty).toBe('MEDIUM');
    expect(r.rubric.key_points).toHaveLength(1);
  });

  it('отклоняет пустую рубрику', () => {
    expect(() => practicalGenerationSchema.parse({ ...valid, rubric: { key_points: [], answer_reached_criteria: 'x' } })).toThrow();
  });

  it('отклоняет неположительный бюджет', () => {
    expect(() => practicalGenerationSchema.parse({ ...valid, recommended_token_budget: 0 })).toThrow();
  });

  // Регресс на дефекты, найденные в живом прогоне практической генерации:
  it('answer_reached_criteria массивом → склеивается в строку', () => {
    const r = practicalGenerationSchema.parse({ ...valid, rubric: { key_points: ['a'], answer_reached_criteria: ['крит 1', 'крит 2'] } });
    expect(typeof r.rubric.answer_reached_criteria).toBe('string');
    expect(r.rubric.answer_reached_criteria).toContain('крит 1');
  });
  it('difficulty объектом → игнорируется (не падает)', () => {
    const r = practicalGenerationSchema.parse({ ...valid, difficulty: { level: 'HARD', why: '...' } });
    expect(r.difficulty).toBeUndefined();
  });
  it('recommended_* строками → коэрсятся в числа', () => {
    const r = practicalGenerationSchema.parse({ ...valid, recommended_token_budget: '9000', recommended_max_ai_messages: '22' });
    expect(r.recommended_token_budget).toBe(9000);
    expect(r.recommended_max_ai_messages).toBe(22);
  });
});
