import { describe, it, expect } from 'vitest';
import { detectAnswerLeak } from './leakDetector.js';

describe('detectAnswerLeak (§5.4 — пост-проверка на утечку)', () => {
  const reference =
    'Верный вывод: утверждение некорректно, поскольку подменяет корреляцию причинностью и игнорирует необходимость проверки методологии и выборки.';

  it('нормальная наводящая реплика — утечки нет', () => {
    const r = detectAnswerLeak('А что произойдёт, если рассмотреть противоположный случай? Какой признак это подтвердит?', reference);
    expect(r.leaked).toBe(false);
  });

  it('дословный фрагмент эталона → утечка', () => {
    const r = detectAnswerLeak('подменяет корреляцию причинностью и игнорирует необходимость проверки методологии', reference);
    expect(r.leaked).toBe(true);
    expect(r.reason).toBeTruthy();
  });

  it('очень короткие тексты не срабатывают (мало сигнала)', () => {
    expect(detectAnswerLeak('Да?', reference).leaked).toBe(false);
  });

  it('пустой эталон — без утечки', () => {
    expect(detectAnswerLeak('любая реплика тут', '').leaked).toBe(false);
  });

  it('overlapRatio растёт при большем совпадении', () => {
    const partial = detectAnswerLeak('проверки методологии и выборки при анализе', reference).overlapRatio;
    const none = detectAnswerLeak('Подумайте о следующем шаге внимательно и спокойно', reference).overlapRatio;
    expect(partial).toBeGreaterThan(none);
  });
});
