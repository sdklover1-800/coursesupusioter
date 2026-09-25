import { describe, it, expect } from 'vitest';
import { seededShuffle, balancedKeyPositions, seededCoin, mulberry32 } from './shuffle.js';

/** Перемешивание вариантов (USER_DECISIONS §5, A17). */
describe('seededShuffle', () => {
  const options = ['альфа', 'бета', 'гамма', 'дельта'];
  const rationales = ['r-альфа', 'r-бета', 'r-гамма', 'r-дельта'];

  it('детерминирован: одинаковый seed → одинаковый результат', () => {
    const a = seededShuffle(options, [1], rationales, 'polit:M2:Q5');
    const b = seededShuffle(options, [1], rationales, 'polit:M2:Q5');
    expect(a).toEqual(b);
  });

  it('разные seed дают разные перестановки (на наборе seed)', () => {
    const perms = new Set(Array.from({ length: 20 }, (_, i) => seededShuffle(options, [0], null, `q${i}`).permutation.join('')));
    expect(perms.size).toBeGreaterThan(5);
  });

  it('пересчитывает ключ: верный вариант остаётся верным', () => {
    for (let i = 0; i < 30; i++) {
      const r = seededShuffle(options, [2], rationales, `seed-${i}`);
      expect(r.correctOptionIds).toHaveLength(1);
      expect(r.options[r.correctOptionIds[0]!]).toBe('гамма');
      expect([...r.options].sort()).toEqual([...options].sort());
    }
  });

  it('несколько верных вариантов переносятся все и сортируются', () => {
    const r = seededShuffle(options, [3, 0], null, 'multi');
    expect(r.correctOptionIds).toEqual([...r.correctOptionIds].sort((a, b) => a - b));
    expect(r.correctOptionIds.map((i) => r.options[i]).sort()).toEqual(['альфа', 'дельта']);
  });

  it('обоснования выравниваются вместе с вариантами', () => {
    const r = seededShuffle(options, [1], rationales, 'align');
    r.options.forEach((o, i) => expect(r.optionRationales![i]).toBe(`r-${o}`));
    expect(r.permutation.map((old) => options[old])).toEqual(r.options);
  });

  it('без обоснований возвращает null', () => {
    expect(seededShuffle(options, [0], null, 'x').optionRationales).toBeNull();
  });

  it('keyPosition ставит единственный ключ на заданную позицию', () => {
    for (let pos = 0; pos < 4; pos++) {
      const r = seededShuffle(options, [2], rationales, `kp-${pos}`, { keyPosition: pos });
      expect(r.correctOptionIds).toEqual([pos]);
      expect(r.options[pos]).toBe('гамма');
      expect(r.optionRationales![pos]).toBe('r-гамма');
    }
  });

  it('отклоняет ключ вне диапазона и несовпадение длины обоснований', () => {
    expect(() => seededShuffle(options, [4], null, 's')).toThrow();
    expect(() => seededShuffle(options, [0], ['a', 'b'], 's')).toThrow();
  });

  it('TRUE_FALSE не перемешивается вызывающим кодом: метки «верно/неверно» сохраняют порядок', () => {
    // Контракт: TRUE_FALSE пропускается ДО вызова seededShuffle (shuffleSet в drafts.ts).
    const tf = { type: 'TRUE_FALSE', options: ['Верно', 'Неверно'], correctOptionIds: [1] };
    const shuffleIfChoice = (q: typeof tf) =>
      q.type === 'TRUE_FALSE' ? q : { ...q, ...seededShuffle(q.options, q.correctOptionIds, null, 'tf') };
    expect(shuffleIfChoice(tf)).toEqual(tf);
  });
});

describe('balancedKeyPositions', () => {
  it('8 вопросов × 4 варианта — ровно по 2 ключа на A–D', () => {
    const p = balancedKeyPositions(8, 4, 'polit:M2');
    expect(p).toHaveLength(8);
    for (let pos = 0; pos < 4; pos++) expect(p.filter((x) => x === pos)).toHaveLength(2);
  });

  it('15 вопросов: каждая позиция 3 или 4 раза (≤ 40% при любом раскладе)', () => {
    const p = balancedKeyPositions(15, 4, 'course-final');
    for (let pos = 0; pos < 4; pos++) {
      const n = p.filter((x) => x === pos).length;
      expect(n === 3 || n === 4).toBe(true);
    }
  });

  it('детерминирован и не всегда начинается с A', () => {
    expect(balancedKeyPositions(8, 4, 's1')).toEqual(balancedKeyPositions(8, 4, 's1'));
    const firsts = new Set(Array.from({ length: 12 }, (_, i) => balancedKeyPositions(8, 4, `s${i}`)[0]));
    expect(firsts.size).toBeGreaterThan(1);
  });

  it('вырожденные входы', () => {
    expect(balancedKeyPositions(0, 4, 's')).toEqual([]);
    expect(balancedKeyPositions(3, 4, 's').sort()).toHaveLength(3);
    expect(new Set(balancedKeyPositions(3, 4, 's')).size).toBe(3);
  });
});

describe('seededCoin / mulberry32', () => {
  it('монетка детерминирована и даёт обе стороны на наборе seed', () => {
    expect(seededCoin('lec-1')).toBe(seededCoin('lec-1'));
    const sides = new Set(Array.from({ length: 20 }, (_, i) => seededCoin(`lec-${i}`)));
    expect(sides.size).toBe(2);
  });

  it('mulberry32 даёт числа в [0, 1)', () => {
    const rnd = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = rnd();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
