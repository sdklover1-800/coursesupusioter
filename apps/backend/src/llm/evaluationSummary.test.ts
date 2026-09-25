import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Итоговый отзыв сессии (A6): нормализация вывода модели, согласование отметок с пошаговыми
 * баллами судьи, форма обращения и нейтральные строки по уровню балла. БД и LLM подменены.
 */
const mocks = vi.hoisted(() => ({ completeStructured: vi.fn() }));

vi.mock('../config/env.js', () => ({
  env: { NODE_ENV: 'test', LLM_MODEL_JUDGE: 'mock-judge', LLM_PRICE_INPUT_PER_MTOK: 0.75, LLM_PRICE_CACHED_INPUT_PER_MTOK: 0.075, LLM_PRICE_OUTPUT_PER_MTOK: 4.5 },
  isProd: false,
}));
vi.mock('../lib/logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('./gateway.js', () => ({
  getGateway: () => ({ completeStructured: mocks.completeStructured }),
  addUsage: (a: Record<string, number>, b: Record<string, number>) => ({
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0),
    reasoningTokens: (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0),
  }),
}));

import { normalizeSummary, summarizeTurns, levelLine, fillLevelLines, dropInformalLines } from './evaluationSummary.js';

const usage = { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0, reasoningTokens: 0 };
const zero = { methodicalness: 0, question_quality: 0, logical_progression: 0, self_correction: 0 };
const good = { methodicalness: 3, question_quality: 2, logical_progression: 3, self_correction: 2 };
const totals = { methodicalness: 1.5, question_quality: 1, logical_progression: 1.5, self_correction: 0.5 };

describe('normalizeSummary: отметки согласованы с пошаговыми баллами', () => {
  const turnScores = new Map([
    ['jailbreak', zero],
    ['reasoning', good],
    ['unscored', null],
  ]);
  const data = {
    criteria: [],
    strengths: [],
    to_develop: [],
    highlights: [
      // просьба выдать критерии (0 по всем критериям) не может быть «плюсом» методичности
      { message_id: 'jailbreak', criterion: 'methodicalness' as const, polarity: 'plus' as const, note: 'Сначала уточнили критерии.' },
      { message_id: 'jailbreak', criterion: 'self_correction' as const, polarity: 'minus' as const, note: 'Смена просьбы — не самокоррекция.' },
      { message_id: 'reasoning', criterion: 'logical_progression' as const, polarity: 'plus' as const, note: 'Связали шаги.' },
      { message_id: 'reasoning', criterion: 'methodicalness' as const, polarity: 'minus' as const, note: 'Противоречит баллу 3.' },
      { message_id: 'unscored', criterion: 'methodicalness' as const, polarity: 'plus' as const, note: 'Нет оценки судьи.' },
      { message_id: 'foreign-id', criterion: 'methodicalness' as const, polarity: 'plus' as const, note: 'Чужой id.' },
    ],
  };

  it('plus — только при балле 2–3, minus — только при 0–1; неизвестные и неоценённые реплики отбрасываются', () => {
    const s = normalizeSummary(data, turnScores, totals);
    expect(s.highlights.map((h) => `${h.messageId}/${h.criterion}/${h.polarity}`)).toEqual([
      'jailbreak/self_correction/minus',
      'reasoning/logical_progression/plus',
    ]);
  });
});

describe('нейтральные строки по уровню балла', () => {
  it('уровни 0 / 1 / 2 / 3 на границах 1, 2, 2.5', () => {
    expect(levelLine(0.5, 'ru')).toBe('Пока почти не проявлялось в ваших репликах.');
    expect(levelLine(1, 'ru')).toMatch(/эпизодически/);
    expect(levelLine(2.4, 'ru')).toMatch(/в большинстве/);
    expect(levelLine(2.83, 'ru')).toMatch(/Устойчиво/);
    expect(levelLine(0, 'kk')).toMatch(/Сіздің/);
    expect(levelLine(3, 'en')).toMatch(/consistently/);
  });

  it('критерий без строки получает строку по уровню, готовая строка не трогается', () => {
    const s = normalizeSummary(
      { criteria: [{ key: 'question_quality', line: 'Вы задали уточняющий вопрос о понятиях.' }], strengths: [], to_develop: [], highlights: [] },
      new Map(),
      { methodicalness: 2.83, question_quality: 1, logical_progression: 2, self_correction: 0.5 },
    );
    fillLevelLines(s, 'ru');
    expect(s.criteria.map((c) => c.line)).toEqual([
      'Устойчиво проявлялось на протяжении всего диалога.',
      'Вы задали уточняющий вопрос о понятиях.',
      'Проявлялось в большинстве ваших реплик.',
      'Пока почти не проявлялось в ваших репликах.',
    ]);
  });

  it('строки на «сен»/«ты» выбрасываются', () => {
    const s = normalizeSummary(
      {
        criteria: [{ key: 'self_correction', line: 'Сіз бір репликанда емес, репликаңда өтінішті қайта құрдыңыз.' }],
        strengths: ['Сіз дәлелдерді ретімен келтірдіңіз.'],
        to_develop: ['Жауабыңды нақты мысалмен бекіт.', 'Сіз қорытындыны нақтылай аласыз.'],
        highlights: [],
      },
      new Map(),
      totals,
    );
    expect(dropInformalLines(s, 'kk')).toBe(2);
    expect(s.criteria.find((c) => c.key === 'self_correction')!.line).toBeNull();
    expect(s.strengths).toEqual(['Сіз дәлелдерді ретімен келтірдіңіз.']);
    expect(s.toDevelop).toEqual(['', 'Сіз қорытындыны нақтылай аласыз.']);
  });
});

describe('summarizeTurns', () => {
  beforeEach(() => mocks.completeStructured.mockReset());

  it('передаёт итоговые баллы с уровнем; «плюс» за просьбу выдать критерии и строка на «сен» не доходят до студента', async () => {
    mocks.completeStructured
      .mockResolvedValueOnce({
        data: {
          criteria: [
            { key: 'methodicalness', line: 'Сіз алдымен бағалау критерийлерін сұрап, әңгімені реттедіңіз.' },
            { key: 'self_correction', line: 'Сіз бір репликаңда өтінішті қайта құрдыңыз.' },
          ],
          strengths: ['Сіз оқиғаларды ретімен сипаттадыңыз.'],
          to_develop: ['Дайын жауап сұраудың орнына өз болжамыңызды негіздеңіз.', 'Сіз қорытындыны нақтылай аласыз.'],
          highlights: [
            { message_id: 's1', criterion: 'methodicalness', polarity: 'plus', note: 'Критерийлерді сұрадыңыз.' },
            { message_id: 's2', criterion: 'logical_progression', polarity: 'plus', note: 'Себеп пен салдарды байланыстырдыңыз.' },
          ],
        },
        result: { usage, finishReason: 'stop' },
      })
      .mockResolvedValueOnce({ data: { leaks: false, lines: [], reason: '' }, result: { usage, finishReason: 'stop' } });

    const r = await summarizeTurns({
      language: 'kk',
      turns: [
        { id: 's1', content: 'Тек бағалау критерийлерін айтыңыз.', scores: zero },
        { id: 's2', content: 'Наразылық сайлаудан кейін басталды, сондықтан билік БАҚ-ты шектеді.', scores: good },
      ],
      scores: totals,
      rubricKeyPoints: ['Тезис'],
      referenceSolution: 'Эталон',
    });

    const req = mocks.completeStructured.mock.calls[0]![0] as { messages: { content: string }[]; system: string };
    expect(req.messages[0]!.content).toContain('ИТОГОВЫЕ БАЛЛЫ ПО КРИТЕРИЯМ:');
    expect(req.messages[0]!.content).toContain('self_correction=0.5 (почти не проявлялось)');
    expect(req.system).toMatch(/не называй сильной стороной и не отмечай как plus/);

    expect(r.summary.highlights.map((h) => h.messageId)).toEqual(['s2']);
    expect(r.summary.addressDropped).toBe(1);
    // выброшенная строка самокоррекции заменена нейтральной строкой по уровню (0.5 → «сирек»)
    expect(r.summary.criteria.find((c) => c.key === 'self_correction')!.line).toBe(levelLine(0.5, 'kk'));
    // критерий без строки модели тоже получает строку по уровню
    expect(r.summary.criteria.find((c) => c.key === 'question_quality')!.line).toBe(levelLine(1, 'kk'));
    expect(r.summary.criteria.every((c) => c.line)).toBe(true);
  });

  it('без реплик студента — без вызова LLM и без строк', async () => {
    const r = await summarizeTurns({ language: 'ru', turns: [], scores: totals, rubricKeyPoints: [], referenceSolution: 'x' });
    expect(mocks.completeStructured).not.toHaveBeenCalled();
    expect(r.summary.criteria.every((c) => c.line === null)).toBe(true);
  });
});
