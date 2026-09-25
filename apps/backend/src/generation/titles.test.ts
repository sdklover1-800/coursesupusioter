import { describe, it, expect } from 'vitest';
import type { Language } from '@edu/shared';
import { localizedTitle, titleLabels, type TitleKind } from './titles.js';

const KINDS: TitleKind[] = ['MODULE_FINAL', 'LECTURE_MINI', 'COURSE_FINAL', 'PRACTICAL'];
const LANGS: Language[] = ['ru', 'kk', 'en'];

// Русские префиксы, которые аудит нашёл в kk/en-заголовках (service.ts до gen-2.0).
const RU_PREFIXES = /^(Тест:|Итоговый|Итоговое|Практическое задание)/;

describe('localizedTitle (аудит: русские префиксы в kk/en)', () => {
  it.each([
    ['MODULE_FINAL', 'ru', 'Раздел II. Власть', 'Тест: Раздел II. Власть'],
    ['MODULE_FINAL', 'kk', 'II бөлім. Билік', 'Бөлім тесті: II бөлім. Билік'],
    ['MODULE_FINAL', 'en', 'Section II. Power', 'Quiz: Section II. Power'],
    ['LECTURE_MINI', 'ru', '4. Политическая власть', 'Мини-квиз: 4. Политическая власть'],
    ['LECTURE_MINI', 'kk', '4. Саяси билік', 'Мини-квиз: 4. Саяси билік'],
    ['LECTURE_MINI', 'en', '4. Political Power', 'Mini-quiz: 4. Political Power'],
    ['COURSE_FINAL', 'ru', 'Введение в политологию', 'Итоговый мини-квиз'],
    ['COURSE_FINAL', 'kk', 'Саясаттануға кіріспе', 'Қорытынды мини-квиз'],
    ['COURSE_FINAL', 'en', 'Introduction to Political Science', 'Final mini-quiz'],
    ['PRACTICAL', 'ru', undefined, 'Итоговое практическое задание'],
    ['PRACTICAL', 'kk', undefined, 'Қорытынды практикалық тапсырма'],
    ['PRACTICAL', 'en', undefined, 'Final practical task'],
  ] as [TitleKind, Language, string | undefined, string][])('%s × %s', (kind, lang, name, expected) => {
    expect(localizedTitle(kind, lang, name)).toBe(expected);
  });

  it('практическое модуля V — только метка (null/пустое имя)', () => {
    expect(localizedTitle('PRACTICAL', 'ru', null)).toBe('Итоговое практическое задание');
    expect(localizedTitle('PRACTICAL', 'kk', '  ')).toBe('Қорытынды практикалық тапсырма');
  });

  it('практическое обычного модуля — с названием модуля', () => {
    expect(localizedTitle('PRACTICAL', 'ru', 'Раздел III')).toBe('Практическое задание: Раздел III');
    expect(localizedTitle('PRACTICAL', 'kk', 'III бөлім')).toBe('Практикалық тапсырма: III бөлім');
    expect(localizedTitle('PRACTICAL', 'en', 'Section III')).toBe('Practical task: Section III');
  });

  it('kk/en-заголовки всех видов без русских префиксов', () => {
    for (const lang of ['kk', 'en'] as Language[]) {
      for (const kind of KINDS) {
        for (const name of [undefined, 'X']) {
          const t = localizedTitle(kind, lang, name);
          expect(t).not.toMatch(RU_PREFIXES);
          if (lang === 'en') expect(t).not.toMatch(/^Мини/);
        }
      }
    }
  });

  it('en-заголовки без кириллицы в метках', () => {
    for (const kind of KINDS) expect(localizedTitle(kind, 'en', 'Name')).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('kk-метки итоговых материалов — казахские (есть казахские буквы)', () => {
    expect(localizedTitle('COURSE_FINAL', 'kk')).toMatch(/[әғқңөұүһі]/i);
    expect(localizedTitle('PRACTICAL', 'kk')).toMatch(/[әғқңөұүһі]/i);
    expect(localizedTitle('MODULE_FINAL', 'kk', 'M')).toMatch(/[әғқңөұүһі]/i);
  });

  it('у каждого языка свой набор меток', () => {
    for (const lang of LANGS) expect(titleLabels(lang).length).toBe(5);
    expect(titleLabels('kk')).not.toEqual(titleLabels('ru'));
  });
});
