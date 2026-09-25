import { describe, it, expect } from 'vitest';
import { courseStatusFrom, healthItemText, publishProblemItems, publishProblems, publishWarningItems, publishWarnings, ruTitlePrefixesFor, type VersionForPublish } from './publishValidation.js';

/** Предупреждения публикации (не блокеры) и статус курса по версиям. */

function version(lang: string, over: { quizQuestions?: number; quizTitle?: string; practicalTitle?: string; miniTitle?: string; lectureMiniTitle?: string; durationSec?: number | null; videoId?: string | null } = {}) {
  const q = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `q${i}` }));
  return {
    id: `v-${lang}`,
    language: lang,
    title: 'Курс',
    finalMiniQuiz: { id: 'fm', title: over.miniTitle ?? 'Final quiz' },
    modules: [
      {
        orderIndex: 0, title: 'Модуль 1', assessmentType: 'QUIZ',
        quiz: { title: over.quizTitle ?? 'Module test', questions: q(over.quizQuestions ?? 8) },
        practicalTask: null,
        lectures: [
          {
            title: 'Лекция 1', youtubeVideoId: over.videoId === undefined ? 'abcdefghijk' : over.videoId, transcriptText: 'текст',
            durationSec: over.durationSec === undefined ? 1200 : over.durationSec,
            miniQuiz: over.lectureMiniTitle ? { id: 'mq1', title: over.lectureMiniTitle, _count: { questions: 3 } } : null,
          },
        ],
      },
      {
        orderIndex: 1, title: 'Модуль 2', assessmentType: 'PRACTICAL',
        quiz: null,
        practicalTask: { title: over.practicalTitle ?? 'Practical' },
        lectures: [{ title: 'Лекция 2', youtubeVideoId: 'abcdefghijk', transcriptText: 'текст', durationSec: 900, miniQuiz: null }],
      },
    ],
  } as unknown as VersionForPublish;
}

describe('publishWarnings', () => {
  it('чистая версия — без предупреждений, и без блокеров', () => {
    const ru = version('ru');
    expect(publishWarnings(ru, [ru, version('kk')])).toEqual([]);
    expect(publishProblems(ru)).toEqual([]);
  });

  it('разное число вопросов в параллельных версиях', () => {
    const kk = version('kk', { quizQuestions: 7 });
    const w = publishWarnings(version('ru'), [kk]);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('KK');
    expect(w[0]).toContain('7');
  });

  it('русские префиксы в kk/en-названиях тестов и практикума; в ru-версии — не предупреждение', () => {
    const kk = version('kk', { quizTitle: 'Тест: Билік', practicalTitle: 'Практическое задание: Полисия', miniTitle: 'Итоговый мини-квиз' });
    const w = publishWarnings(kk, []);
    expect(w.filter((x) => x.includes('русский префикс'))).toHaveLength(3);
    expect(publishWarnings(version('ru', { quizTitle: 'Тест: Власть' }), [])).toEqual([]);
  });

  it('«Мини-квиз» в kk — казахский термин, не предупреждение; в en — русский префикс', () => {
    const kk = version('kk', { lectureMiniTitle: 'Мини-квиз: 1. Саясаттану ғылым ретінде', miniTitle: 'Қорытынды мини-квиз', quizTitle: 'Бөлім тесті: I бөлім' });
    expect(publishWarnings(kk, [])).toEqual([]);
    const en = version('en', { lectureMiniTitle: 'Мини-квиз: 1. Political Science' });
    expect(publishWarningItems(en, [])).toEqual([
      { code: 'RU_TITLE_PREFIX', params: { kind: 'MINI_QUIZ', title: 'Мини-квиз: 1. Political Science', prefix: 'Мини-квиз', language: 'en' } },
    ]);
    // «Итоговый мини-квиз» и «Тест:» в kk по-прежнему русские
    expect(ruTitlePrefixesFor('kk')).toEqual(['Тест:', 'Итоговый мини-квиз', 'Практическое задание']);
    expect(ruTitlePrefixesFor('ru')).toEqual([]);
  });

  it('пункты — код + параметры для перевода на клиенте; русский текст совпадает со строкой', () => {
    const kk = version('kk', { quizQuestions: 7 });
    const items = publishWarningItems(version('ru'), [kk], { openReviewIssues: 2 });
    expect(items).toEqual([
      { code: 'QUESTION_COUNT_MISMATCH', params: { module: 'Модуль 1', count: 8, otherLanguage: 'kk', otherCount: 7 } },
      { code: 'REVIEW_PENDING', params: { count: 2 } },
    ]);
    expect(items.map(healthItemText)).toEqual(publishWarnings(version('ru'), [kk], { openReviewIssues: 2 }));
    expect(items.map(healthItemText)[0]).toBe('Модуль «Модуль 1»: вопросов в тесте — 8, а в версии KK — 7');
  });

  it('без openReviewIssues экспертная проверка в предупреждения не попадает (у редактора свой счётчик)', () => {
    expect(publishWarningItems(version('ru'), [])).toEqual([]);
  });

  it('лекции без длительности и открытые системные отметки', () => {
    const w = publishWarnings(version('ru', { durationSec: null }), [], { openReviewIssues: 3 });
    expect(w).toContain('Не задана длительность видео у 1 из 2 лекций — оставшееся время не рассчитывается');
    expect(w).toContain('3 вопроса ждут экспертной проверки');
    expect(publishWarnings(version('ru'), [], { openReviewIssues: 21 })).toEqual(['21 вопрос ждёт экспертной проверки']);
  });
});

describe('publishProblemItems', () => {
  it('блокер — код + параметры, текст для CLI прежний', () => {
    const v = version('ru', { videoId: null });
    expect(publishProblemItems(v)).toEqual([{ code: 'LECTURE_NO_VIDEO', params: { lecture: 'Лекция 1' } }]);
    expect(publishProblems(v)).toEqual(['Лекция «Лекция 1»: не задано видео']);
  });
});

describe('courseStatusFrom', () => {
  it('PUBLISHED при хоть одной опубликованной, ARCHIVED — если все в архиве, иначе DRAFT', () => {
    expect(courseStatusFrom(['DRAFT', 'PUBLISHED'])).toBe('PUBLISHED');
    expect(courseStatusFrom(['ARCHIVED', 'ARCHIVED'])).toBe('ARCHIVED');
    expect(courseStatusFrom(['ARCHIVED', 'DRAFT'])).toBe('DRAFT');
    expect(courseStatusFrom([])).toBe('DRAFT');
  });
});
