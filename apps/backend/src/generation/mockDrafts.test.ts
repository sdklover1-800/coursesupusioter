import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Офлайн-заглушки черновиков (LLM_PROVIDER=mock): ответ проходит ту же Zod-схему,
 * что и ответ реальной модели, а цикл качества gen-2.0 на нём сходится.
 */
const gw = vi.hoisted(() => ({ provider: 'mock', completeStructured: vi.fn() }));
vi.mock('../config/env.js', () => ({
  env: { NODE_ENV: 'test', LLM_MODEL_GENERATION: 'mock', LLM_PRICE_INPUT_PER_MTOK: 0, LLM_PRICE_OUTPUT_PER_MTOK: 0, LLM_PRICE_CACHED_INPUT_PER_MTOK: 0 },
  isProd: false,
}));
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../llm/gateway.js', () => ({ getGateway: () => gw }));

import { quizGenerationSchema, questionTranslationSchema, lectureSummarySchema } from '../llm/schemas/generation.js';
import { mockQuizPayload, mockQuestionTranslationPayload, mockSummaryPayload } from './mockDrafts.js';
import { callStructured } from './common.js';
import { overlapsWith, lengthCue } from './quality.js';

// Разнообразные предложения (как в настоящих расшифровках): шаблонные почти совпадали бы.
const POOL = [
  'Макс Вебер связывал легитимность господства с верой подчинённых в его правомерность.',
  'Роберт Даль определял власть через способность заставить другого сделать то, чего он иначе не сделал бы.',
  'Мишель Фуко описывал власть как сеть отношений, пронизывающую повседневные практики.',
  'Экономические ресурсы включают собственность, бюджетные средства и контроль над занятостью населения.',
  'Информационные ресурсы дают возможность формировать повестку и интерпретацию событий в медиа.',
  'Авторитет опирается на добровольное признание компетентности и морального права отдавать распоряжения.',
  'Суверенитет государства означает верховенство внутри страны и независимость во внешних делах.',
  'Налоговая система обеспечивает казну средствами для исполнения публичных функций и обязательств.',
  'Территориальная организация населения отличает государство от родовых и племенных объединений.',
  'Монополия на легитимное насилие считается ключевым признаком современного государства.',
  'Правовое государство подчиняет органы власти закону и гарантирует права граждан судом.',
  'Социальное государство перераспределяет доходы ради смягчения неравенства и бедности.',
];
const transcript = (from: number) =>
  ['ЛЕКЦИЯ', '[00:00–05:00] Вступление', ...POOL.slice(from, from + 3), '[05:00–10:00] Основная часть', ...POOL.slice(from + 3, from + 6)].join('\n');

const lectures = [
  { index: 0, title: '1. Власть', transcript: transcript(0) },
  { index: 1, title: '2. Государство', transcript: transcript(6) },
];

describe('mockQuizPayload', () => {
  it('ровно sc + tf вопросов, проходит схему, без подсказки длиной', () => {
    const data = quizGenerationSchema.parse(mockQuizPayload({ language: 'ru', lectures, sc: 6, tf: 2, tfTrue: 1, optionCount: 4, avoid: [] }));
    expect(data.questions).toHaveLength(8);
    expect(data.questions.filter((q) => q.type === 'TRUE_FALSE').map((q) => q.correct_option_indexes[0]).sort()).toEqual([0, 1]);
    for (const q of data.questions.filter((x) => x.type === 'SINGLE_CHOICE')) {
      expect(q.options).toHaveLength(4);
      expect(q.option_rationales).toHaveLength(4);
      expect(lengthCue(q.options!, q.correct_option_indexes)).toBe(false);
    }
  });

  it('формулировки не пересекаются между собой и с avoid; источник — по плану лекций', () => {
    const avoid = [`[MOCK] ${POOL[0]}`];
    const data = quizGenerationSchema.parse(
      mockQuizPayload({ language: 'kk', lectures, sc: 4, tf: 0, optionCount: 4, perLecture: [{ index: 0, count: 1 }, { index: 1, count: 3 }], avoid }),
    );
    const prompts = data.questions.map((q) => q.prompt);
    prompts.forEach((p, i) => {
      expect(overlapsWith(p, avoid)).toBeNull();
      expect(overlapsWith(p, prompts.filter((_, j) => j !== i))).toBeNull();
    });
    expect(data.questions.map((q) => q.source_lecture_index)).toEqual([0, 1, 1, 1]);
    expect(data.questions.every((q) => /^\d{2}:\d{2}$/.test(q.source_timecode ?? ''))).toBe(true);
  });

  it('короткая расшифровка без фрагментов — всё равно различимые заглушки', () => {
    const tiny = [{ index: 0, title: 'Лекция QA', transcript: '[00:00–01:00] Блок\nТекст.' }];
    const data = quizGenerationSchema.parse(mockQuizPayload({ language: 'ru', lectures: tiny, sc: 3, tf: 0, optionCount: 4, avoid: [] }));
    const prompts = data.questions.map((q) => q.prompt);
    prompts.forEach((p, i) => expect(overlapsWith(p, prompts.filter((_, j) => j !== i))).toBeNull());
  });
});

describe('прочие заглушки проходят свои схемы', () => {
  it('перевод вопросов сохраняет число вариантов и обоснований', () => {
    const data = questionTranslationSchema.parse(
      mockQuestionTranslationPayload('en', [{ key: 3, prompt: 'Вопрос', options: ['a', 'b', 'c', 'd'], option_rationales: ['1', '2', '3', '4'] }]),
    );
    expect(data.items[0]!.key).toBe(3);
    expect(data.items[0]!.options).toHaveLength(4);
    expect(data.items[0]!.option_rationales).toHaveLength(4);
  });

  it('краткое содержание ≤ 400 символов на языке лекции', () => {
    const { summary } = lectureSummarySchema.parse(mockSummaryPayload('kk', '4. Саяси билік'));
    expect(summary.length).toBeLessThanOrEqual(400);
    expect(summary).toMatch(/дәрісінің/);
  });
});

describe('callStructured: заглушка только для mock-провайдера', () => {
  beforeEach(() => {
    gw.completeStructured.mockReset();
  });

  it('mock-провайдер — берёт заглушку, шлюз не вызывается', async () => {
    gw.provider = 'mock';
    const data = await callStructured('t', { system: '', user: '', maxTokens: 10, mock: () => ({ summary: 'ok' }) }, lectureSummarySchema);
    expect(data.summary).toBe('ok');
    expect(gw.completeStructured).not.toHaveBeenCalled();
  });

  it('реальный провайдер — всегда шлюз, заглушка игнорируется', async () => {
    gw.provider = 'openai';
    gw.completeStructured.mockResolvedValue({ data: { summary: 'llm' }, result: { usage: { inputTokens: 1, outputTokens: 1 } } });
    const data = await callStructured('t', { system: '', user: '', maxTokens: 10, mock: () => ({ summary: 'stub' }) }, lectureSummarySchema);
    expect(data.summary).toBe('llm');
    expect(gw.completeStructured).toHaveBeenCalledTimes(1);
  });

  it('заглушка, не прошедшая схему, — ошибка, а не молчаливая запись', async () => {
    gw.provider = 'mock';
    await expect(callStructured('t', { system: '', user: '', maxTokens: 10, mock: () => ({ nope: 1 }) }, lectureSummarySchema)).rejects.toThrow();
  });
});
