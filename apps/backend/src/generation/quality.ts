/**
 * Проверки качества вопросов (USER_DECISIONS §5, critique A11/A12).
 * Чистые функции без БД и LLM: их переиспользуют генерация (цикл качества)
 * и аудит контент-скриптов (CONTENT).
 */

/** Минимальный вид вопроса для метрик качества. */
export interface QualityQuestion {
  type: string;
  options: readonly string[];
  correctOptionIds: readonly number[];
}

/** Порог «подсказки длиной»: ключ длиннее медианы дистракторов более чем в 1.5 раза. */
export const LENGTH_CUE_RATIO = 1.5;

/** Пороги пересечения формулировок по умолчанию (A11). */
export const OVERLAP_THRESHOLDS = { jaccard: 0.35, trigram: 0.5 } as const;

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

const len = (s: string | undefined) => (s ?? '').trim().length;

/**
 * Отношение длины ключа к медиане длин дистракторов (для отчётов).
 * null — если оценить нельзя (нет ключа или дистракторов).
 */
export function lengthRatio(options: readonly string[], correct: readonly number[]): number | null {
  const key = correct[0];
  if (key === undefined || key < 0 || key >= options.length) return null;
  const distractors = options.filter((_, i) => !correct.includes(i)).map((o) => len(o));
  if (!distractors.length) return null;
  const m = median(distractors);
  if (m === 0) return Number.POSITIVE_INFINITY;
  return len(options[key]) / m;
}

/** true — ключ заметно длиннее дистракторов (> 1.5× медианы): тестовая «подсказка». */
export function lengthCue(options: readonly string[], correct: readonly number[]): boolean {
  const r = lengthRatio(options, correct);
  return r !== null && r > LENGTH_CUE_RATIO;
}

export interface TfBalance {
  total: number;
  trueCount: number;
  falseCount: number;
  /** Доля утверждений с ключом «верно»; null — TRUE_FALSE нет. */
  trueRatio: number | null;
}

/** Баланс ключей TRUE_FALSE (индекс 0 = «верно»). Аудит: 18 из 24 были «верно». */
export function tfBalance(questions: readonly Pick<QualityQuestion, 'type' | 'correctOptionIds'>[]): TfBalance {
  const tf = questions.filter((q) => q.type === 'TRUE_FALSE');
  const trueCount = tf.filter((q) => q.correctOptionIds[0] === 0).length;
  return {
    total: tf.length,
    trueCount,
    falseCount: tf.length - trueCount,
    trueRatio: tf.length ? trueCount / tf.length : null,
  };
}

/** Токены для сравнения: нижний регистр, ё→е, без пунктуации. */
export function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

const toTokens = (x: string | readonly string[]) => (typeof x === 'string' ? normalizeTokens(x) : x);

/** Коэффициент Жаккара по множествам токенов (0..1). */
export function jaccard(a: string | readonly string[], b: string | readonly string[]): number {
  const A = new Set(toTokens(a));
  const B = new Set(toTokens(b));
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const token of normalizeTokens(text)) {
    const padded = ` ${token} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

/**
 * Сходство по символьным триграммам (Жаккар по множествам триграмм слов,
 * дополненных пробелами). Второй сигнал для казахского (A11): агглютинативные
 * окончания («билік» / «биліктің» / «билігі») ломают совпадение целых токенов,
 * а основы слов сохраняют общие триграммы.
 */
export function charTrigramSimilarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface OverlapMatch {
  /** Индекс совпавшей формулировки в списке doNotReuse. */
  index: number;
  text: string;
  jaccard: number;
  trigram: number;
}

export interface OverlapThresholds {
  jaccard?: number;
  /** null — не проверять триграммы. */
  trigram?: number | null;
}

/**
 * Пересекается ли формулировка с запрещёнными к повтору (A11): Жаккар по токенам
 * > порога ИЛИ сходство триграмм > порога. Возвращает самое сильное совпадение
 * либо null.
 */
export function overlapsWith(
  prompt: string,
  doNotReuse: readonly string[],
  thresholds: OverlapThresholds = OVERLAP_THRESHOLDS,
): OverlapMatch | null {
  const jThr = thresholds.jaccard ?? OVERLAP_THRESHOLDS.jaccard;
  const tThr = thresholds.trigram === undefined ? OVERLAP_THRESHOLDS.trigram : thresholds.trigram;
  const tokens = normalizeTokens(prompt);
  let best: OverlapMatch | null = null;
  doNotReuse.forEach((text, index) => {
    const j = jaccard(tokens, normalizeTokens(text));
    const t = tThr === null ? 0 : charTrigramSimilarity(prompt, text);
    const hit = j > jThr || (tThr !== null && t > tThr);
    if (hit && (!best || Math.max(j, t) > Math.max(best.jaccard, best.trigram))) {
      best = { index, text, jaccard: j, trigram: t };
    }
  });
  return best;
}

/**
 * Балл стратегии «угадывателя» (A12): в SINGLE_CHOICE выбирать самый длинный
 * вариант, в TRUE_FALSE всегда отвечать «верно». Доля верных ответов 0..1.
 * Цель контент-аудита: ни один оцениваемый тест не достигает порога 0.7.
 */
export function testwiseScore(questions: readonly QualityQuestion[]): number {
  if (!questions.length) return 0;
  let hits = 0;
  for (const q of questions) {
    let pick = 0;
    if (q.type !== 'TRUE_FALSE') {
      q.options.forEach((o, i) => {
        if (len(o) > len(q.options[pick])) pick = i;
      });
    }
    if (q.correctOptionIds.includes(pick)) hits++;
  }
  return hits / questions.length;
}

/** Гистограмма позиций ключа (для отчётов CONTENT): позиция → число вопросов. */
export function keyPositionHistogram(questions: readonly QualityQuestion[]): number[] {
  const hist: number[] = [];
  for (const q of questions) {
    if (q.type === 'TRUE_FALSE') continue;
    for (const c of q.correctOptionIds) hist[c] = (hist[c] ?? 0) + 1;
  }
  return Array.from(hist, (v) => v ?? 0);
}
