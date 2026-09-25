import { describe, it, expect } from 'vitest';
import { informalAddress } from './addressForm.js';

/** Фиксированная форма обращения в тексте для студента (калибровка A.2): ru «вы», kk «Сіз». */
describe('informalAddress', () => {
  it('kk: форма на «Сіз», в том числе притяжательная, — без нарушений', () => {
    for (const s of [
      'Сіз бір репликаңызда өтінішті қайта құрып, тек құрылым сұрауға көштіңіз.',
      'Жауабыңызды дәлелмен бекітуге тырысыңыз.',
      'Сіздің ойыңызды түсіндіріңізші.',
      'Бұл Сіздің репликаларыңыздың көбінде байқалды.',
      'Бүгінгі таңда теңге бағамы маңызды; жаңа кезеңде мың түрлі себеп бар.',
      'Талдаудың әр кезеңінде Сіз нақты мысал келтірдіңіз.',
    ]) {
      expect(informalAddress(s, 'kk'), s).toEqual([]);
    }
  });

  it('kk: «сен», глаголы на -сың/-сің и притяжательные формы на «сен» с падежом — нарушение', () => {
    expect(informalAddress('Сен бұл жерде дұрыс ойладың.', 'kk')).toContain('Сен');
    expect(informalAddress('Сен мұны білесің.', 'kk')).toEqual(expect.arrayContaining(['Сен', 'білесің']));
    expect(informalAddress('Сіз бір репликаңда өтінішті қайта құрдыңыз.', 'kk')).toEqual(['репликаңда']);
    expect(informalAddress('Жауабыңды дәлелде.', 'kk')).toEqual(['Жауабыңды']);
    expect(informalAddress('Ойыңа сүйен.', 'kk')).toEqual(['Ойыңа']);
    expect(informalAddress('Пікіріңнен бас тартпа.', 'kk')).toEqual(['Пікіріңнен']);
  });

  it('ru: «вы» — без нарушений; «ты», «твой», глаголы и повелительные на «ты» — нарушение', () => {
    expect(informalAddress('Вы рассуждали последовательно и лишь однажды отвлеклись.', 'ru')).toEqual([]);
    expect(informalAddress('Попробуйте объяснить, почему вы так считаете.', 'ru')).toEqual([]);
    expect(informalAddress('Ты рассуждал последовательно, твой вывод понятен.', 'ru')).toEqual(['Ты', 'твой']);
    expect(informalAddress('Ты знаешь ответ — попробуй его обосновать.', 'ru')).toEqual(expect.arrayContaining(['Ты', 'знаешь', 'попробуй']));
  });

  it('en: нейтральное "you" — без нарушений, фамильярные обращения — нарушение', () => {
    expect(informalAddress('You compared the options step by step.', 'en')).toEqual([]);
    expect(informalAddress('Nice try, dude, u almost got it.', 'en')).toEqual(['dude', 'u']);
  });
});
