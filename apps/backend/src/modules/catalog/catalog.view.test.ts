import { describe, it, expect } from 'vitest';
import { sortVersions, toCatalogSummary, toCatalogDetail, catalogDetailSelect, catalogListSelect } from './catalog.view.js';

/** Ключи, которых НЕ должно быть в DTO каталога (контент и скрытые части). */
const FORBIDDEN = ['youtubeVideoId', 'transcriptText', 'quiz', 'questions', 'miniQuiz', 'practicalTask', 'scenarioPrompt', 'referenceSolution', 'rubricSpec', 'correctOptionIds', 'prompt'];
/** Колонки с учебным контентом — не выбираются из БД вовсе. */
const CONTENT_COLUMNS = [
  'youtubeVideoId', 'transcriptText', 'prompt', 'options', 'correctOptionIds', 'explanation', 'optionRationales',
  'scenarioPrompt', 'referenceSolution', 'rubricSpec', 'agenda', 'introMessage', 'summary',
];

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

const lectures = (n: number, durationSec: number | null = null) => Array.from({ length: n }, () => ({ durationSec }));

describe('toCatalogSummary', () => {
  it('считает модули/лекции и наличие практического задания', () => {
    const r = toCatalogSummary({
      id: 'c1',
      defaultLanguage: 'ru',
      languageVersions: [
        {
          id: 'v-en', language: 'en', title: 'Intro', description: null,
          modules: [{ assessmentType: 'QUIZ', lectures: lectures(5), quiz: { id: 'q' } }],
        },
        {
          id: 'v-ru', language: 'ru', title: 'Введение', description: 'Описание',
          modules: [
            { assessmentType: 'QUIZ', lectures: lectures(5), quiz: { id: 'q1' } },
            { assessmentType: 'QUIZ', lectures: lectures(4), quiz: { id: 'q2' } },
            { assessmentType: 'PRACTICAL', lectures: lectures(6), quiz: null },
          ],
        },
      ],
    });
    expect(r).toEqual({
      id: 'c1',
      versions: [
        {
          id: 'v-ru', language: 'ru', title: 'Введение', description: 'Описание', moduleCount: 3, lectureCount: 15, hasPractical: true,
          durationSec: null, moduleQuizCount: 2, hasCertificate: true,
        },
        {
          id: 'v-en', language: 'en', title: 'Intro', description: null, moduleCount: 1, lectureCount: 5, hasPractical: false,
          durationSec: null, moduleQuizCount: 1, hasCertificate: true,
        },
      ],
    });
  });

  it('длительность версии — сумма лекций; null, если хоть у одной не задана', () => {
    const version = (a: number | null) => ({
      id: 'v', language: 'ru', title: 'T', description: null,
      modules: [
        { assessmentType: 'QUIZ' as const, lectures: [{ durationSec: 600 }, { durationSec: 900 }], quiz: null },
        { assessmentType: 'PRACTICAL' as const, lectures: [{ durationSec: a }], quiz: null },
      ],
    });
    expect(toCatalogSummary({ id: 'c', defaultLanguage: 'ru', languageVersions: [version(300)] }).versions[0]!.durationSec).toBe(1800);
    expect(toCatalogSummary({ id: 'c', defaultLanguage: 'ru', languageVersions: [version(null)] }).versions[0]!.durationSec).toBeNull();
  });
});

/** Строка страницы курса с одним модулем-тестом и модулем-практикумом. */
function detailRow() {
  return {
    id: 'c1',
    defaultLanguage: 'ru',
    languageVersions: [
      {
        id: 'v1', language: 'ru', title: 'Курс', description: null,
        finalMiniQuiz: { _count: { questions: 3 } },
        modules: [
          {
            id: 'm1', orderIndex: 0, title: 'Модуль 1', assessmentType: 'QUIZ' as const,
            quiz: { _count: { questions: 8 } }, practicalTask: null,
            lectures: [
              { id: 'l1', orderIndex: 0, title: 'Лекция 1', durationSec: 1200, miniQuiz: { _count: { questions: 3 } } },
              { id: 'l2', orderIndex: 1, title: 'Лекция 2', durationSec: 900, miniQuiz: { _count: { questions: 0 } } },
            ],
          },
          {
            id: 'm2', orderIndex: 1, title: 'Модуль 2', assessmentType: 'PRACTICAL' as const,
            quiz: null, practicalTask: { id: 'p1' },
            lectures: [{ id: 'l3', orderIndex: 0, title: 'Лекция 3', durationSec: 600, miniQuiz: null }],
          },
        ],
      },
    ],
  };
}

describe('toCatalogDetail — программа с типами элементов', () => {
  it('длительности, число вопросов теста, мини-квизы, практикум и итоговый мини-квиз', () => {
    const v = toCatalogDetail(detailRow()).versions[0]!;
    expect(v.durationSec).toBe(2700);
    expect(v.hasFinalMiniQuiz).toBe(true);
    expect(v.modules[0]).toMatchObject({ quizQuestionCount: 8, hasPractical: false });
    expect(v.modules[1]).toMatchObject({ quizQuestionCount: null, hasPractical: true });
    expect(v.modules[0]!.lectures).toEqual([
      { id: 'l1', orderIndex: 0, title: 'Лекция 1', durationSec: 1200, hasMiniQuiz: true },
      { id: 'l2', orderIndex: 1, title: 'Лекция 2', durationSec: 900, hasMiniQuiz: false },
    ]);
  });

  it('лекция без длительности → длительность версии null', () => {
    const row = detailRow();
    row.languageVersions[0]!.modules[1]!.lectures[0]!.durationSec = null as unknown as number;
    expect(toCatalogDetail(row).versions[0]!.durationSec).toBeNull();
  });
});

describe('toCatalogDetail — без учебного контента', () => {
  it('даже если в строку попали лишние поля, в DTO их нет (явный белый список)', () => {
    const leaky = {
      id: 'c1',
      defaultLanguage: 'ru',
      languageVersions: [
        {
          id: 'v1', language: 'ru', title: 'Курс', description: null, finalMiniQuiz: null,
          modules: [
            {
              id: 'm1', orderIndex: 0, title: 'Модуль 1', assessmentType: 'PRACTICAL' as const,
              practicalTask: { id: 'p1', scenarioPrompt: 's', referenceSolution: 'r', rubricSpec: {} },
              quiz: { _count: { questions: 1 }, questions: [{ correctOptionIds: [1] }] },
              lectures: [
                {
                  id: 'l1', orderIndex: 0, title: 'Лекция 1', durationSec: 60, youtubeVideoId: 'abcdefghijk', transcriptText: 'секрет',
                  miniQuiz: { _count: { questions: 2 }, questions: [{ prompt: 'p' }] },
                },
              ],
            },
          ],
        },
      ],
    };
    const dto = toCatalogDetail(leaky as unknown as Parameters<typeof toCatalogDetail>[0]);
    const keys = deepKeys(dto);
    for (const k of FORBIDDEN) expect(keys.has(k)).toBe(false);
    expect(dto.versions[0]!.modules[0]!.lectures[0]).toEqual({ id: 'l1', orderIndex: 0, title: 'Лекция 1', durationSec: 60, hasMiniQuiz: true });
  });

  it('выборки из БД не запрашивают контент (видео, расшифровки, вопросы, практическое)', () => {
    const keys = new Set([...deepKeys(catalogDetailSelect), ...deepKeys(catalogListSelect)]);
    for (const k of CONTENT_COLUMNS) expect(keys.has(k)).toBe(false);
  });

  it('из тестов/мини-квизов/практикума выбираются только id и счётчик вопросов', () => {
    const allowed = new Set(['select', 'id', '_count', 'questions', 'where', 'archivedAt']);
    const nested = [
      catalogListSelect.languageVersions.select.modules.select.quiz,
      catalogDetailSelect.languageVersions.select.modules.select.quiz,
      catalogDetailSelect.languageVersions.select.modules.select.practicalTask,
      catalogDetailSelect.languageVersions.select.modules.select.lectures.select.miniQuiz,
      catalogDetailSelect.languageVersions.select.finalMiniQuiz,
    ];
    for (const sel of nested) for (const k of deepKeys(sel)) expect(allowed.has(k)).toBe(true);
  });
});
