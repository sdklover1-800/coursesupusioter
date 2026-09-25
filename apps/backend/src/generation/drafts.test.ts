import { describe, it, expect, vi } from 'vitest';

/** Чистые помощники draft/write API (без БД и LLM: модули с окружением подменены). */
vi.mock('../config/env.js', () => ({
  env: { NODE_ENV: 'test', LLM_MODEL_GENERATION: 'mock', LLM_PRICE_INPUT_PER_MTOK: 0, LLM_PRICE_OUTPUT_PER_MTOK: 0, LLM_PRICE_CACHED_INPUT_PER_MTOK: 0 },
  isProd: false,
}));
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../llm/gateway.js', () => ({ getGateway: () => ({ completeStructured: vi.fn() }) }));

import { assertDraftQuestion, courseScopeLine, type DraftQuestion } from './drafts.js';
import {
  parseTranscript,
  snapTimecode,
  mapTimecodeBetween,
  stripOptionLabels,
  languageWarnings,
  transcriptEndSeconds,
} from './common.js';

const RU = [
  'ЛЕКЦИЯ № 4',
  'Лекция 4. Политическая власть',
  '[00:00–01:30] Вступление',
  'Текст вступления.',
  '[01:30–06:00] Блок 1. Природа власти',
  'Первый абзац.',
  'Второй абзац.',
  '[06:00–10:30]',
  'Раздел без заголовка.',
].join('\n');

const KK = ['4-дәріс', '[00:00–02:00] Кіріспе', 'Мәтін.', '[02:00–07:00] 1-блок', 'Мәтін.', '[07:00–12:00] 2-блок', 'Мәтін.'].join('\n');

describe('parseTranscript / таймкоды', () => {
  it('разбирает преамбулу и разделы, префикс заголовка — байт-в-байт', () => {
    const p = parseTranscript(RU);
    expect(p.preamble).toBe('ЛЕКЦИЯ № 4\nЛекция 4. Политическая власть');
    expect(p.sections.map((s) => s.headerPrefix)).toEqual(['[00:00–01:30] ', '[01:30–06:00] ', '[06:00–10:30]']);
    expect(p.sections[1]!.title).toBe('Блок 1. Природа власти');
    expect(p.sections[1]!.body).toBe('Первый абзац.\nВторой абзац.');
    expect(p.sections[2]!.start).toBe(360);
  });

  it('терпим к искажённым таймкодам kk-01', () => {
    const p = parseTranscript('[00:00 –01 : 30 ] Кіріспе\nМәтін');
    expect(p.sections[0]!.headerPrefix).toBe('[00:00 –01 : 30 ] ');
    expect(p.sections[0]!.end).toBe(90);
  });

  it('snapTimecode привязывает к началу раздела', () => {
    expect(snapTimecode(RU, '03:10')).toBe('01:30');
    expect(snapTimecode(RU, '06:00')).toBe('06:00');
    expect(snapTimecode(RU, null)).toBeNull();
    expect(snapTimecode('без таймкодов', '03:10')).toBe('03:10');
  });

  it('mapTimecodeBetween: тот же номер раздела в параллельной лекции', () => {
    expect(mapTimecodeBetween(RU, KK, '01:30')).toBe('02:00');
    expect(mapTimecodeBetween(RU, KK, '08:00')).toBe('07:00');
  });

  it('transcriptEndSeconds — конец последнего таймкода', () => {
    expect(transcriptEndSeconds(RU)).toBe(630);
    expect(transcriptEndSeconds('нет')).toBeNull();
  });
});

describe('stripOptionLabels', () => {
  it('снимает разметку, только если она у всех вариантов подряд', () => {
    expect(stripOptionLabels(['A) один', 'B) два', 'C) три', 'D) четыре'])).toEqual(['один', 'два', 'три', 'четыре']);
    expect(stripOptionLabels(['А. один', 'Б. два'])).toEqual(['один', 'два']);
    expect(stripOptionLabels(['A. Gramsci', 'M. Weber'])).toEqual(['A. Gramsci', 'M. Weber']);
  });
});

describe('languageWarnings', () => {
  it('кириллица в английском', () => {
    expect(languageWarnings('The state is власть', 'en')).toHaveLength(1);
    expect(languageWarnings('The state', 'en')).toHaveLength(0);
  });

  it('русские служебные слова в казахском', () => {
    expect(languageWarnings('Саяси билік — это власть и сила, которая', 'kk').length).toBeGreaterThan(0);
    expect(languageWarnings('Саяси билік — қоғамдағы ықпал ету қабілеті.', 'kk')).toHaveLength(0);
  });
});

describe('assertDraftQuestion (проверка перед записью)', () => {
  const ok: DraftQuestion = {
    type: 'SINGLE_CHOICE',
    prompt: 'Вопрос?',
    options: ['a', 'b', 'c', 'd'],
    correctOptionIds: [2],
    explanation: null,
    optionRationales: ['1', '2', '3', '4'],
    sourceLectureId: null,
    sourceTimecode: '05:00',
    difficulty: 'MEDIUM',
  };

  it('валидный черновик проходит', () => {
    expect(() => assertDraftQuestion(ok)).not.toThrow();
  });

  it.each([
    ['ключ вне диапазона', { correctOptionIds: [4] }],
    ['обоснования другой длины', { optionRationales: ['1'] }],
    ['TRUE_FALSE с 3 вариантами', { type: 'TRUE_FALSE', options: ['a', 'b', 'c'], correctOptionIds: [0] }],
    ['кривой таймкод', { sourceTimecode: 'полдень' }],
    ['пустая формулировка', { prompt: '  ' }],
  ])('%s — отказ', (_, patch) => {
    expect(() => assertDraftQuestion({ ...ok, ...(patch as Partial<DraftQuestion>) })).toThrow();
  });
});

describe('courseScopeLine', () => {
  const s = { lectures: 15, hours: 6, moduleQuizzes: 4, hasPractical: true };
  it('ru / kk / en', () => {
    expect(courseScopeLine('ru', s)).toBe('15 лекций · ≈ 6 ч видео · 4 теста по разделам · итоговое практическое задание с ИИ-тьютором · сертификат');
    expect(courseScopeLine('kk', s)).toBe('15 дәріс · ≈ 6 сағ бейне · 4 бөлім тесті · ЖИ-тьютормен қорытынды практикалық тапсырма · сертификат');
    expect(courseScopeLine('en', s)).toBe('15 lectures · ≈ 6 h of video · 4 module quizzes · final practical task with the AI tutor · certificate');
  });
  it('русские формы числа и дробные часы', () => {
    expect(courseScopeLine('ru', { lectures: 21, hours: 5.5, moduleQuizzes: 1, hasPractical: false })).toBe(
      '21 лекция · ≈ 5,5 ч видео · 1 тест по разделам · сертификат',
    );
  });
});
