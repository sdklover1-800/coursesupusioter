/**
 * Пост-проверка реплики тьютора на утечку ответа (§5.4, третий уровень защиты).
 * Эвристика: если реплика содержит длинные дословные фрагменты эталонного
 * решения — вероятна утечка, требуется регенерация.
 *
 * ВНИМАНИЕ: детектор слабее на казахском; его работоспособность на kk —
 * обязательная проверка пилота (§5.1, §5.4). Он не единственный барьер:
 * главный — изоляция эталона (тьютор его не видит в двухвызовном режиме).
 */

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ngrams(tokens: string[], n: number): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++) {
    set.add(tokens.slice(i, i + n).join(' '));
  }
  return set;
}

export interface LeakCheck {
  leaked: boolean;
  overlapRatio: number;
  reason?: string;
}

/**
 * @param tutorMessage реплика, отправляемая студенту
 * @param referenceSolution скрытый эталон
 */
export function detectAnswerLeak(tutorMessage: string, referenceSolution: string): LeakCheck {
  const msgTokens = normalize(tutorMessage).split(' ').filter(Boolean);
  const refTokens = normalize(referenceSolution).split(' ').filter(Boolean);
  if (msgTokens.length < 4 || refTokens.length < 4) return { leaked: false, overlapRatio: 0 };

  // Пересечение по 4-граммам (дословные совпадения)
  const n = 4;
  const msgGrams = ngrams(msgTokens, n);
  const refGrams = ngrams(refTokens, n);
  if (msgGrams.size === 0) return { leaked: false, overlapRatio: 0 };

  let shared = 0;
  for (const g of msgGrams) if (refGrams.has(g)) shared++;
  const overlapRatio = shared / msgGrams.size;

  // Порог консервативный: даже небольшое дословное совпадение фраз эталона подозрительно.
  const leaked = shared >= 2 || overlapRatio >= 0.15;
  return {
    leaked,
    overlapRatio,
    reason: leaked ? `Совпадение ${shared} 4-грамм(ы) с эталоном (доля ${overlapRatio.toFixed(2)})` : undefined,
  };
}
