import { describe, it, expect } from 'vitest';
import {
  quizGenerationSchema,
  practicalGenerationSchema,
  normalizeTimecode,
  distractorRepairSchema,
  rationaleBackfillSchema,
  questionTranslationSchema,
  transcriptSectionSchema,
  practicalTranslationSchema,
} from './schemas/generation.js';

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

describe('quizGenerationSchema gen-2.0: обоснования и источник (необязательны)', () => {
  const base = { type: 'SINGLE_CHOICE', prompt: 'Q?', options: ['A', 'B', 'C', 'D'], correct_option_indexes: [2], difficulty: 'MEDIUM' };

  it('старый ответ без новых полей валиден, поля отсутствуют', () => {
    const q = quizGenerationSchema.parse({ questions: [base] }).questions[0]!;
    expect(q.option_rationales).toBeUndefined();
    expect(q.source_lecture_index).toBeUndefined();
    expect(q.source_timecode).toBeUndefined();
  });

  it('новые поля разбираются и нормализуются', () => {
    const q = quizGenerationSchema.parse({
      questions: [{ ...base, option_rationales: ['a', 'b', 'c', 'd'], source_lecture_index: '#2', source_timecode: '[5:30–9:00]' }],
    }).questions[0]!;
    expect(q.option_rationales).toEqual(['a', 'b', 'c', 'd']);
    expect(q.source_lecture_index).toBe(2);
    expect(q.source_timecode).toBe('05:30');
  });

  it('null в необязательных полях трактуется как пропуск (в т. ч. explanation)', () => {
    const q = quizGenerationSchema.parse({
      questions: [{ ...base, explanation: null, option_rationales: null, source_lecture_index: null, source_timecode: null }],
    }).questions[0]!;
    expect(q.explanation).toBeUndefined();
    expect(q.option_rationales).toBeUndefined();
  });

  it('обоснования другой длины отбрасываются, а не валят весь ответ', () => {
    const q = quizGenerationSchema.parse({ questions: [{ ...base, option_rationales: ['a', 'b'] }] }).questions[0]!;
    expect(q.option_rationales).toBeUndefined();
    expect(q.prompt).toBe('Q?');
  });

  it('TRUE_FALSE: 2 обоснования («верно», «неверно») без options', () => {
    const q = quizGenerationSchema.parse({
      questions: [{ type: 'TRUE_FALSE', prompt: 'X.', correct_option_indexes: [1], difficulty: 'EASY', option_rationales: ['r1', 'r2'] }],
    }).questions[0]!;
    expect(q.option_rationales).toEqual(['r1', 'r2']);
  });

  it('некорректные таймкод и индекс лекции — пропуск, а не отказ', () => {
    const q = quizGenerationSchema.parse({
      questions: [{ ...base, source_lecture_index: -1, source_timecode: 'начало лекции' }],
    }).questions[0]!;
    expect(q.source_lecture_index).toBeUndefined();
    expect(q.source_timecode).toBeUndefined();
  });
});

describe('normalizeTimecode', () => {
  it.each([
    ['05:30', '05:30'],
    ['5:30', '05:30'],
    ['[12:30–15:00]', '12:30'],
    ['1:02:05', '62:05'],
    ['72:10', '72:10'],
  ])('%s → %s', (input, out) => expect(normalizeTimecode(input)).toBe(out));

  it.each(['5:75', 'abc', ''])('%s → undefined', (input) => expect(normalizeTimecode(input)).toBeUndefined());
  it('не строка → undefined', () => expect(normalizeTimecode(330)).toBeUndefined());
});

describe('вспомогательные схемы gen-2.0', () => {
  it('ремонт дистракторов: ключи-строки коэрсятся', () => {
    const r = distractorRepairSchema.parse({ items: [{ key: '0', distractors: ['x', 'y', 'z'], distractor_rationales: null }] });
    expect(r.items[0]!.key).toBe(0);
    expect(r.items[0]!.distractor_rationales).toBeUndefined();
  });

  it('обоснования существующих вопросов: минимум 2', () => {
    expect(() => rationaleBackfillSchema.parse({ items: [{ key: 0, option_rationales: ['one'] }] })).toThrow();
    const r = rationaleBackfillSchema.parse({ items: [{ key: 1, option_rationales: ['a', 'b'], source_timecode: '9:00' }] });
    expect(r.items[0]!.source_timecode).toBe('09:00');
  });

  it('перевод вопросов: TRUE_FALSE без options', () => {
    const r = questionTranslationSchema.parse({ items: [{ key: 0, prompt: 'Мәлімдеме.', option_rationales: ['a', 'b'] }] });
    expect(r.items[0]!.options).toBeUndefined();
  });

  it('раздел расшифровки и перевод практического', () => {
    expect(transcriptSectionSchema.parse({ text: 'Мәтін', notes: null }).notes).toBeUndefined();
    expect(() => practicalTranslationSchema.parse({ scenario_prompt: 's', reference_solution: 'r', key_points: [], answer_reached_criteria: 'c' })).toThrow();
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
  it('рекомендации, вложенные в rubric (GPT-5.x), поднимаются на верхний уровень', () => {
    const { recommended_token_budget: _b, recommended_max_ai_messages: _m, difficulty: _d, ...rest } = valid;
    const r = practicalGenerationSchema.parse({
      ...rest,
      rubric: { ...valid.rubric, recommended_token_budget: 3200, recommended_max_ai_messages: 24, difficulty: 'HARD' },
    });
    expect(r.recommended_token_budget).toBe(3200);
    expect(r.recommended_max_ai_messages).toBe(24);
    expect(r.difficulty).toBe('HARD');
    expect(Object.keys(r.rubric).sort()).toEqual(['answer_reached_criteria', 'key_points']);
  });
  it('значения верхнего уровня важнее вложенных в rubric', () => {
    const r = practicalGenerationSchema.parse({ ...valid, rubric: { ...valid.rubric, recommended_token_budget: 1 } });
    expect(r.recommended_token_budget).toBe(valid.recommended_token_budget);
  });
});
