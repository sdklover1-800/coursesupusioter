import { describe, it, expect } from 'vitest';
import { sortVersions, toCatalogSummary, toCatalogDetail, catalogDetailSelect, catalogListSelect } from './catalog.view.js';

const FORBIDDEN = ['youtubeVideoId', 'transcriptText', 'quiz', 'questions', 'practicalTask', 'scenarioPrompt', 'referenceSolution', 'rubricSpec'];

/** Все ключи объекта на любой глубине. */
function deepKeys(value: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => deepKeys(v, acc));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      acc.add(k);
      deepKeys(v, acc);
    }
  }
  return acc;
}

describe('sortVersions', () => {
  it('базовый язык курса первым, дальше — по перечню LANGUAGES (kk, ru, en)', () => {
    const vs = [{ language: 'en' }, { language: 'ru' }, { language: 'kk' }];
    expect(sortVersions(vs, 'ru').map((v) => v.language)).toEqual(['ru', 'kk', 'en']);
    expect(sortVersions(vs, 'en').map((v) => v.language)).toEqual(['en', 'kk', 'ru']);
  });
  it('неизвестный язык — в конец', () => {
    expect(sortVersions([{ language: 'xx' }, { language: 'en' }], 'ru').map((v) => v.language)).toEqual(['en', 'xx']);
  });
});

describe('toCatalogSummary', () => {
  it('считает модули/лекции и наличие практического задания', () => {
    const r = toCatalogSummary({
      id: 'c1',
      defaultLanguage: 'ru',
      languageVersions: [
        {
          id: 'v-en', language: 'en', title: 'Intro', description: null,
          modules: [{ assessmentType: 'QUIZ', _count: { lectures: 5 } }],
        },
        {
          id: 'v-ru', language: 'ru', title: 'Введение', description: 'Описание',
          modules: [
            { assessmentType: 'QUIZ', _count: { lectures: 5 } },
            { assessmentType: 'QUIZ', _count: { lectures: 4 } },
            { assessmentType: 'PRACTICAL', _count: { lectures: 6 } },
          ],
        },
      ],
    });
    expect(r).toEqual({
      id: 'c1',
      versions: [
        { id: 'v-ru', language: 'ru', title: 'Введение', description: 'Описание', moduleCount: 3, lectureCount: 15, hasPractical: true },
        { id: 'v-en', language: 'en', title: 'Intro', description: null, moduleCount: 1, lectureCount: 5, hasPractical: false },
      ],
    });
  });
});

describe('toCatalogDetail — без учебного контента', () => {
  it('даже если в строку попали лишние поля, в DTO их нет (явный белый список)', () => {
    const leaky = {
      id: 'c1',
      defaultLanguage: 'ru',
      languageVersions: [
        {
          id: 'v1', language: 'ru', title: 'Курс', description: null,
          modules: [
            {
              id: 'm1', orderIndex: 0, title: 'Модуль 1', assessmentType: 'PRACTICAL' as const,
              practicalTask: { scenarioPrompt: 's', referenceSolution: 'r', rubricSpec: {} },
              quiz: { questions: [{ correctOptionIds: [1] }] },
              lectures: [{ id: 'l1', orderIndex: 0, title: 'Лекция 1', youtubeVideoId: 'abcdefghijk', transcriptText: 'секрет' }],
            },
          ],
        },
      ],
    };
    const dto = toCatalogDetail(leaky as unknown as Parameters<typeof toCatalogDetail>[0]);
    const keys = deepKeys(dto);
    for (const k of FORBIDDEN) expect(keys.has(k)).toBe(false);
    expect(dto.versions[0]!.modules[0]!.lectures[0]).toEqual({ id: 'l1', orderIndex: 0, title: 'Лекция 1' });
  });

  it('выборки из БД не запрашивают контент (видео, расшифровки, тесты, практическое)', () => {
    const keys = new Set([...deepKeys(catalogDetailSelect), ...deepKeys(catalogListSelect)]);
    for (const k of FORBIDDEN) expect(keys.has(k)).toBe(false);
  });
});
