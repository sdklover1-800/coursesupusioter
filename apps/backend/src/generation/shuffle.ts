import { createHash } from 'node:crypto';

/**
 * Детерминированное перемешивание вариантов ответа (USER_DECISIONS §5, аудит:
 * ключ стоял на A/B в 50 из 54 оцениваемых вопросов).
 *
 * Политика seed (critique A17):
 *  - новые вопросы — canonicalKey, иначе `${quizId}:${orderIndex}`;
 *  - уже существующие вопросы (контент-скрипты) — id вопроса: он стабилен между
 *    запусками, а текст вопроса может меняться (правки атрибуции и т. п.).
 * TRUE_FALSE НЕ перемешивается: порядок «верно/неверно» задаёт платформа —
 * вызывающий код пропускает такие вопросы.
 */

export interface ShuffleResult {
  options: string[];
  /** Индексы правильных вариантов в НОВОМ порядке (по возрастанию). */
  correctOptionIds: number[];
  /** Обоснования в новом порядке; null — если на входе их не было. */
  optionRationales: string[] | null;
  /** permutation[новая позиция] = старый индекс варианта. */
  permutation: number[];
}

export interface ShuffleOptions {
  /**
   * Куда поставить ЕДИНСТВЕННЫЙ правильный вариант (0-based). Дистракторы
   * при этом перемешиваются по seed. Нужен для равномерного распределения
   * позиций ключа внутри теста (см. balancedKeyPositions).
   */
  keyPosition?: number;
}

/** 32-битный seed из sha256(seed) — первые 4 байта. */
function seedToUint32(seed: string): number {
  return createHash('sha256').update(seed, 'utf8').digest().readUInt32BE(0);
}

/** mulberry32 — компактный детерминированный ГПСЧ. */
export function mulberry32(a: number): () => number {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ГПСЧ по строковому seed. */
export function seededRandom(seed: string): () => number {
  return mulberry32(seedToUint32(seed));
}

/** Фишер–Йетс по заданному ГПСЧ; возвращает новый массив. */
function fisherYates<T>(items: readonly T[], rnd: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Перемешивает варианты, пересчитывает ключ(и) и выравнивает обоснования.
 * Детерминирован: одинаковые входы и seed → одинаковый результат.
 */
export function seededShuffle(
  options: readonly string[],
  correct: readonly number[],
  rationales: readonly string[] | null | undefined,
  seed: string,
  opts: ShuffleOptions = {},
): ShuffleResult {
  const n = options.length;
  for (const c of correct) {
    if (!Number.isInteger(c) || c < 0 || c >= n) throw new Error(`seededShuffle: индекс ключа ${c} вне диапазона 0..${n - 1}`);
  }
  if (rationales && rationales.length !== n) {
    throw new Error(`seededShuffle: обоснований ${rationales.length}, вариантов ${n}`);
  }

  const rnd = seededRandom(seed);
  const identity = options.map((_, i) => i);
  let permutation: number[];

  const key = correct.length === 1 ? correct[0]! : undefined;
  if (opts.keyPosition !== undefined && key !== undefined && n > 0) {
    const pos = Math.min(Math.max(0, Math.floor(opts.keyPosition)), n - 1);
    const distractors = fisherYates(identity.filter((i) => i !== key), rnd);
    permutation = [...distractors.slice(0, pos), key, ...distractors.slice(pos)];
  } else {
    permutation = fisherYates(identity, rnd);
  }

  const oldToNew = new Map(permutation.map((oldIdx, newIdx) => [oldIdx, newIdx]));
  return {
    options: permutation.map((i) => options[i]!),
    correctOptionIds: [...new Set(correct)].map((c) => oldToNew.get(c)!).sort((a, b) => a - b),
    optionRationales: rationales ? permutation.map((i) => rationales[i]!) : null,
    permutation,
  };
}

/**
 * Равномерные позиции ключа для набора из `count` вопросов с `optionCount`
 * вариантами: каждая позиция встречается ⌊count/optionCount⌋ или на 1 больше раз,
 * порядок детерминированно перемешан по seed. Так 8 вопросов × 4 варианта дают
 * ровно по 2 ключа на A–D (критерий CONTENT: ни одна позиция не выше 40%).
 */
export function balancedKeyPositions(count: number, optionCount: number, seed: string): number[] {
  if (count <= 0 || optionCount <= 0) return [];
  const rnd = seededRandom(`${seed}:key-positions`);
  // Остаток распределяем по случайно выбранным позициям, а не всегда по A, B…
  const base = Array.from({ length: count }, (_, i) => i % optionCount);
  const fullRounds = Math.floor(count / optionCount) * optionCount;
  const extra = fisherYates(
    Array.from({ length: optionCount }, (_, i) => i),
    rnd,
  ).slice(0, count - fullRounds);
  const positions = [...base.slice(0, fullRounds), ...extra];
  return fisherYates(positions, rnd);
}

/** Детерминированная «монетка» по seed — напр. истинность TRUE_FALSE-утверждения. */
export function seededCoin(seed: string): boolean {
  return seededRandom(`${seed}:coin`)() < 0.5;
}
