import { describe, it, expect } from 'vitest';
import {
  lengthCue,
  lengthRatio,
  tfBalance,
  normalizeTokens,
  jaccard,
  charTrigramSimilarity,
  overlapsWith,
  testwiseScore,
  keyPositionHistogram,
} from './quality.js';

describe('lengthCue (подсказка длиной, > 1.5× медианы дистракторов)', () => {
  it('ключ заметно длиннее — подсказка', () => {
    const opts = ['Коротко', 'Кратко', 'Очень подробный и развёрнутый верный вариант ответа', 'Сжато'];
    expect(lengthCue(opts, [2])).toBe(true);
    expect(lengthRatio(opts, [2])!).toBeGreaterThan(1.5);
  });

  it('варианты сопоставимой длины — подсказки нет', () => {
    const opts = ['Легитимность власти', 'Легальность власти', 'Суверенитет народа', 'Авторитет лидера'];
    expect(lengthCue(opts, [0])).toBe(false);
  });

  it('ровно 1.5× — ещё не подсказка (строго больше)', () => {
    expect(lengthCue(['aaa', 'aa', 'aa', 'aa'], [0])).toBe(false);
    expect(lengthCue(['aaaa', 'aa', 'aa', 'aa'], [0])).toBe(true);
  });

  it('без ключа или дистракторов оценить нельзя', () => {
    expect(lengthRatio(['a'], [0])).toBeNull();
    expect(lengthCue(['a', 'b'], [])).toBe(false);
  });
});

describe('tfBalance', () => {
  it('считает долю «верно» только по TRUE_FALSE', () => {
    const r = tfBalance([
      { type: 'TRUE_FALSE', correctOptionIds: [0] },
      { type: 'TRUE_FALSE', correctOptionIds: [0] },
      { type: 'TRUE_FALSE', correctOptionIds: [1] },
      { type: 'SINGLE_CHOICE', correctOptionIds: [0] },
    ]);
    expect(r).toEqual({ total: 3, trueCount: 2, falseCount: 1, trueRatio: 2 / 3 });
  });

  it('без TRUE_FALSE — trueRatio null', () => {
    expect(tfBalance([{ type: 'SINGLE_CHOICE', correctOptionIds: [1] }]).trueRatio).toBeNull();
  });
});

describe('normalizeTokens / jaccard', () => {
  it('нижний регистр, ё→е, без пунктуации', () => {
    expect(normalizeTokens('Ещё раз: «Власть» — это ВЛАСТЬ!')).toEqual(['еще', 'раз', 'власть', 'это', 'власть']);
  });

  it('жаккар по множествам токенов', () => {
    expect(jaccard('власть и легитимность', 'легитимность и власть')).toBe(1);
    expect(jaccard('a b', 'c d')).toBe(0);
    expect(jaccard('a b c', 'a b d')).toBeCloseTo(2 / 4);
  });
});

describe('charTrigramSimilarity — второй сигнал для казахского (A11)', () => {
  const a = 'Саяси партия мен мүдделі топтың негізгі айырмашылығы неде?';
  const b = 'Мүдделі топтың саяси партиядан негізгі айырмашылығы қандай?';

  it('казахские формулировки с разными окончаниями: жаккар занижен, триграммы ловят', () => {
    expect(jaccard(a, b)).toBeLessThanOrEqual(0.5);
    expect(charTrigramSimilarity(a, b)).toBeGreaterThan(0.5);
  });

  it('разные по смыслу вопросы — низкое сходство', () => {
    const c = 'Дэвид Истонның моделінде кері байланыс қандай рөл атқарады?';
    expect(charTrigramSimilarity(a, c)).toBeLessThan(0.3);
  });

  it('идентичные тексты — 1', () => {
    expect(charTrigramSimilarity(a, a)).toBe(1);
  });
});

describe('overlapsWith', () => {
  const graded = [
    'Согласно Максу Веберу, чем господство отличается от власти?',
    'Мажоритарлық сайлау жүйесінің негізгі қағидаты қайсы?',
  ];

  it('находит почти дословный повтор по жаккару', () => {
    const hit = overlapsWith('Чем, по Максу Веберу, господство отличается от власти?', graded);
    expect(hit?.index).toBe(0);
    expect(hit!.jaccard).toBeGreaterThan(0.35);
  });

  it('находит казахский повтор по триграммам', () => {
    const hit = overlapsWith('Мажоритарлық сайлау жүйесінің негізгі қағидаты қай нұсқада дұрыс берілген?', graded);
    expect(hit?.index).toBe(1);
  });

  it('новая тема — нет пересечения', () => {
    expect(overlapsWith('Какие функции выполняют политические партии в демократии?', graded)).toBeNull();
  });

  it('триграммы можно отключить', () => {
    const q = 'Мажоритарлық сайлау жүйесінің негізгі қағидаты қай нұсқада дұрыс берілген?';
    const hit = overlapsWith(q, graded, { jaccard: 0.6, trigram: null });
    expect(hit).toBeNull();
  });
});

describe('testwiseScore — стратегия «самый длинный + всегда верно» (A12)', () => {
  it('считает долю угаданных', () => {
    const qs = [
      { type: 'SINGLE_CHOICE', options: ['a', 'bbbbbb', 'c', 'd'], correctOptionIds: [1] }, // угадан (самый длинный)
      { type: 'SINGLE_CHOICE', options: ['aaaaaa', 'b', 'c', 'd'], correctOptionIds: [2] }, // нет
      { type: 'TRUE_FALSE', options: ['Верно', 'Неверно'], correctOptionIds: [0] }, // угадан («верно»)
      { type: 'TRUE_FALSE', options: ['Верно', 'Неверно'], correctOptionIds: [1] }, // нет
    ];
    expect(testwiseScore(qs)).toBe(0.5);
  });

  it('при равной длине берёт первый самый длинный', () => {
    expect(testwiseScore([{ type: 'SINGLE_CHOICE', options: ['aa', 'bb'], correctOptionIds: [0] }])).toBe(1);
    expect(testwiseScore([{ type: 'SINGLE_CHOICE', options: ['aa', 'bb'], correctOptionIds: [1] }])).toBe(0);
  });

  it('пустой набор — 0', () => {
    expect(testwiseScore([])).toBe(0);
  });
});

describe('keyPositionHistogram', () => {
  it('гистограмма позиций ключа без TRUE_FALSE', () => {
    expect(
      keyPositionHistogram([
        { type: 'SINGLE_CHOICE', options: ['a', 'b', 'c'], correctOptionIds: [2] },
        { type: 'SINGLE_CHOICE', options: ['a', 'b', 'c'], correctOptionIds: [0] },
        { type: 'SINGLE_CHOICE', options: ['a', 'b', 'c'], correctOptionIds: [2] },
        { type: 'TRUE_FALSE', options: ['a', 'b'], correctOptionIds: [0] },
      ]),
    ).toEqual([1, 0, 2]);
  });
});
