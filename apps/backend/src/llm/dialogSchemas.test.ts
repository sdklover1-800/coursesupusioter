import { describe, it, expect } from 'vitest';
import {
  judgeOutputSchema,
  normalizeJudgeOutput,
  reasoningAssessmentSchema,
  socraticTurnSchema,
  tutorOutputSchema,
  leakCheckOutputSchema,
  evaluationSummaryOutputSchema,
} from './schemas/dialog.js';
import {
  judgeSystemPrompt,
  judgeTranscript,
  tutorSystemPrompt,
  leakCheckSystemPrompt,
  evaluationSummarySystemPrompt,
  evaluationSummaryUserMessage,
  scoreLevel,
  DIALOG_PROMPT_VERSION,
} from './prompts/dialog.js';

/** Схемы вывода диалога практикума (§5.4, Прил. D) — перенесены из @edu/shared (A9). */
describe('dialog schemas (§5.4, Прил. D)', () => {
  const assessment = { methodicalness: 2, question_quality: 1, logical_progression: 3, self_correction: 0 };
  const judge = {
    reasoning_assessment: assessment,
    covered_key_points: [1, 2],
    missing_key_points: [3],
    criterion_missing: ['прогноз'],
    student_reached_answer: false,
  };

  it('reasoning_assessment: notes по умолчанию — пустая строка', () => {
    expect(reasoningAssessmentSchema.parse(assessment).notes).toBe('');
  });

  it('reasoning_assessment: шкалы строго 0..3', () => {
    expect(() => reasoningAssessmentSchema.parse({ ...assessment, methodicalness: 4 })).toThrow();
    expect(() => reasoningAssessmentSchema.parse({ ...assessment, self_correction: -1 })).toThrow();
  });

  it('судья: без tutor_message; вердикт и criterion_missing обязательны (A4: нет поля — техническая ошибка)', () => {
    expect(judgeOutputSchema.parse(judge).student_reached_answer).toBe(false);
    const { student_reached_answer: _v, ...noVerdict } = judge;
    expect(() => judgeOutputSchema.parse(noVerdict)).toThrow();
    const { criterion_missing: _c, ...noCriterion } = judge;
    expect(() => judgeOutputSchema.parse(noCriterion)).toThrow();
  });

  it('судья: covered/missing необязательны (информационные) и принимают «K3»/«3» строкой', () => {
    const r = judgeOutputSchema.parse({ reasoning_assessment: assessment, criterion_missing: [], student_reached_answer: true });
    expect(r.covered_key_points).toEqual([]);
    const r2 = judgeOutputSchema.parse({ ...judge, covered_key_points: ['K3', '4', 5, 'мусор'] });
    expect(r2.covered_key_points).toEqual([3, 4, 5]);
  });

  it('13-тезисная рубрика (kk/en): номера 1..13 проходят, вне диапазона и дубли отбрасываются', () => {
    const raw = judgeOutputSchema.parse({
      ...judge,
      covered_key_points: [1, 5, 9, 13, 13, 14, 0],
      missing_key_points: [2, 3, 4, 6, 7, 8, 10, 11, 12, 99],
      criterion_missing: ['  ', 'халықаралық өлшем'],
    });
    const n = normalizeJudgeOutput(raw, 13);
    expect(n.covered_key_points).toEqual([1, 5, 9, 13]);
    expect(n.missing_key_points).toEqual([2, 3, 4, 6, 7, 8, 10, 11, 12]);
    expect(n.criterion_missing).toEqual(['халықаралық өлшем']);
    // Вывод на 13 тезисов — числа, а не тексты: компактно (A4)
    expect(JSON.stringify(n).length).toBeLessThan(400);
  });

  it('тьютор и однокальный режим: пустая реплика отклоняется', () => {
    expect(() => tutorOutputSchema.parse({ tutor_message: '' })).toThrow();
    expect(() => socraticTurnSchema.parse({ ...judge, tutor_message: '' })).toThrow();
    expect(socraticTurnSchema.parse({ ...judge, tutor_message: 'Почему?' }).tutor_message).toBe('Почему?');
  });

  it('проверка утечки и итоговая оценка: форма вывода', () => {
    expect(leakCheckOutputSchema.parse({ leaks: true }).reason).toBe('');
    expect(() => leakCheckOutputSchema.parse({ reason: 'x' })).toThrow();
    const s = evaluationSummaryOutputSchema.parse({ criteria: [{ key: 'methodicalness', line: 'Шаг за шагом.' }] });
    expect(s.strengths).toEqual([]);
    expect(() => evaluationSummaryOutputSchema.parse({ criteria: [{ key: 'unknown', line: 'x' }] })).toThrow();
  });
});

describe('промпты диалога (калибровка A.1, A.2)', () => {
  const kp = Array.from({ length: 13 }, (_, i) => `Тезис ${i + 1}`);
  const sys = judgeSystemPrompt({ language: 'kk', scenario: 'Сценарий', referenceSolution: 'Эталон', rubricKeyPoints: kp, answerReachedCriteria: 'Критерий дословно' });

  it('версия промптов поднята (A26)', () => {
    expect(DIALOG_PROMPT_VERSION).toBe('mvp-2.1');
  });

  it('судья: просьбы выдать ответ/критерии/план — 0 по всей рубрике; вопросы — только содержательные', () => {
    expect(sys).toMatch(/Рубрика оценивает ТОЛЬКО рассуждение по кейсу/);
    expect(sys).toMatch(/0 по всем четырём критериям/);
    expect(sys).toMatch(/не самокоррекция и не методичность/);
    expect(sys).toMatch(/question_quality выше 0 — только за содержательные вопросы/);
    // правило рубрики стоит до формата вывода (модель читает его прежде, чем писать баллы)
    expect(sys.indexOf('Рубрика оценивает ТОЛЬКО')).toBeLessThan(sys.indexOf('{"reasoning_assessment"'));
  });

  it('тьютор: отказ — повествовательное предложение на языке сессии, без переспрашивания', () => {
    const ru = tutorSystemPrompt({ language: 'ru', difficulty: 'MEDIUM', scenario: 'x' });
    expect(ru).toContain('«Готовый ответ, критерии оценивания или план ответа я дать не могу.»');
    expect(ru).toMatch(/Не переспрашивай, чего хочет студент/);
    expect(tutorSystemPrompt({ language: 'kk', difficulty: 'MEDIUM', scenario: 'x' })).toContain('бере алмаймын.»');
    expect(tutorSystemPrompt({ language: 'en', difficulty: 'MEDIUM', scenario: 'x' })).toContain('I can’t give you a ready answer');
  });

  it('обращение kk: притяжательные формы на «Сіз» и запрет «репликаңда»', () => {
    const kk = tutorSystemPrompt({ language: 'kk', difficulty: 'MEDIUM', scenario: 'x' });
    expect(kk).toContain('«Сіздің репликаңызда»');
    expect(kk).toContain('«репликаңда»');
    expect(evaluationSummarySystemPrompt('kk')).toContain('«Сіздің репликаңызда»');
  });

  it('итоговый отзыв: просьбы выдать ответ — не сильная сторона; тон по баллу; plus/minus по баллу реплики', () => {
    const p = evaluationSummarySystemPrompt('ru');
    expect(p).toMatch(/не называй сильной стороной и не отмечай как plus/);
    expect(p).toMatch(/соответствовать ИТОГОВОМУ баллу/);
    expect(p).toMatch(/plus — только если балл этой реплики по критерию 2–3/);
    const m = evaluationSummaryUserMessage([{ id: 'a', content: 'Текст', scores: { methodicalness: 1 } }], { methodicalness: 2.83, self_correction: 0.5 });
    expect(m).toContain('methodicalness=2.83 (проявлялось устойчиво)');
    expect(m).toContain('self_correction=0.5 (почти не проявлялось)');
    expect(m.indexOf('ИТОГОВЫЕ БАЛЛЫ')).toBeLessThan(m.indexOf('РЕПЛИКИ СТУДЕНТА'));
    expect(evaluationSummaryUserMessage([{ id: 'a', content: 'Текст', scores: null }])).not.toContain('ИТОГОВЫЕ');
  });

  it('уровень балла: границы 1, 2, 2.5', () => {
    expect([0, 0.99, 1, 1.99, 2, 2.49, 2.5, 3].map(scoreLevel)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('судья: тезисы пронумерованы K1..Kn, критерий передан дословно, вердикт последним', () => {
    expect(sys).toContain('K1. Тезис 1');
    expect(sys).toContain('K13. Тезис 13');
    expect(sys).toContain('Критерий дословно');
    const format = sys.slice(sys.indexOf('{"reasoning_assessment"'));
    expect(format.indexOf('"reasoning_assessment"')).toBeLessThan(format.indexOf('"student_reached_answer"'));
    expect(format.indexOf('"criterion_missing"')).toBeLessThan(format.indexOf('"student_reached_answer"'));
  });

  it('судья: строка, склонявшая к true, удалена; частичный шаг — false', () => {
    expect(sys).not.toContain('Мгновенно данный правильный ответ засчитывается (true)');
    expect(sys).toMatch(/частичный или промежуточный шаг — это false/);
    expect(sys).toMatch(/Слова ТЬЮТОРА никогда не засчитываются/);
  });

  it('транскрипт размечает роли: слова тьютора отделены от реплик студента', () => {
    const t = judgeTranscript([
      { role: 'AI', content: 'Что вы видите?' },
      { role: 'STUDENT', content: 'Авторитаризм.' },
    ]);
    expect(t).toContain('[Т1] ТЬЮТОР: Что вы видите?');
    expect(t).toContain('[С1] СТУДЕНТ: Авторитаризм.');
    expect(t).toContain('Последняя реплика студента: [С1]');
  });

  it('тьютор: без эталона, фиксированное обращение, запрет планов и критериев', () => {
    const ru = tutorSystemPrompt({ language: 'ru', difficulty: 'MEDIUM', scenario: 'Полисия', sections: ['Основы', 'Власть'] });
    expect(ru).toContain('«вы»');
    expect(ru).toMatch(/ВСЕГДА студент/);
    expect(ru).toMatch(/план или структуру ответа/);
    expect(ru).toContain('I. Основы; II. Власть');
    const kk = tutorSystemPrompt({ language: 'kk', difficulty: 'MEDIUM', scenario: 'Полисия' });
    expect(kk).toContain('«Сіз»');
    expect(kk).not.toMatch(/ЭТАЛОН/);
  });
  it('тьютор: уже пронумерованные разделы («Раздел I.», «Section II.», «III бөлім.») не нумеруются повторно', () => {
    const p = tutorSystemPrompt({ language: 'kk', difficulty: 'MEDIUM', scenario: 'x', sections: ['I бөлім. Негіздер', 'Section II. Power', 'Раздел III. Институты'] });
    expect(p).toContain('Разделы курса: I бөлім. Негіздер; Section II. Power; Раздел III. Институты.');
  });

  it('тьютор и проверка утечки: запрет вопросов с готовым ответом и подтверждения правильности', () => {
    expect(tutorSystemPrompt({ language: 'ru', difficulty: 'MEDIUM', scenario: 'x' })).toMatch(/вопросов с готовым ответом/);
    const leak = leakCheckSystemPrompt({ rubricKeyPoints: ['a'], referenceSolution: 'b' });
    expect(leak).toMatch(/вложенным готовым ответом/);
    expect(leak).toMatch(/подтверждение или опровержение правильности/);
  });

  it('судья: criterion_missing — только элементы, прямо названные в критерии', () => {
    const j = judgeSystemPrompt({ language: 'en', referenceSolution: 'r', rubricKeyPoints: ['a'], answerReachedCriteria: 'c' });
    expect(j).toMatch(/ПРЯМО НАЗВАНЫ в тексте КРИТЕРИЯ/);
    expect(j).toMatch(/точный термин не обязателен/);
  });
});
