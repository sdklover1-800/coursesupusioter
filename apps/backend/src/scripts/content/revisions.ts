/**
 * Ревизия контента ПОСЛЕ применения артефакта (чистые функции, без БД и LLM):
 *  - правки текста вопросов рецензентом (`meta.textFixes` артефакта): «было → стало» по точному
 *    якорю. Сам артефакт правится прямо в JSON (для стендов, где он ещё не применён), а на уже
 *    применённых стендах те же правки переносит lib.applyTextFixes. Порядок вариантов и ключ
 *    правка НЕ меняет — она допустима и для вопросов с попытками;
 *  - языковые проверки аудита: кириллица в en-текстах, русские метки «верно/неверно» в kk/en,
 *    вырожденные обоснования;
 *  - незавершённые серии попыток оцениваемого теста (замену банка и правку по смыслу откладываем,
 *    чтобы 1-я и 2-я попытки студента шли по одному инструменту — правило BEST).
 * Импорт lib — только типы (тесты не поднимают Prisma).
 */
import { type Language, type ScoringRule, type SystemReviewReason, quizAttemptState } from '@edu/shared';
import type { QuizLocator } from './lib.js';

/* ── Правки текста вопросов (meta.textFixes) ─────────────────────── */

export type TextField = 'prompt' | 'explanation' | 'options' | 'optionRationales';

export interface TextEdit {
  field: TextField;
  /** Индекс варианта — для options / optionRationales. */
  index?: number;
  from: string;
  to: string;
  /** 'whole' — значение поля целиком равно from; по умолчанию 'part' — ровно одно вхождение from. */
  match?: 'whole' | 'part';
}

export interface TextFix {
  /** Уникален в артефакте; ключ журнала `content:v1:<скрипт>:fix:<id>`. */
  id: string;
  lang: Language;
  quiz: QuizLocator;
  /** Вопрос: по canonicalKey (оцениваемый банк) — или по позиции в тесте. */
  canonicalKey?: string;
  orderIndex?: number;
  /** Снимок формулировки до правки (для поиска по позиции): другая формулировка — «иной стенд». */
  prompt?: string;
  note: string;
  /**
   * Правка по смыслу (переформулировка), а не опечатка/термин: для оцениваемого теста не
   * применяется, пока у кого-то из студентов незавершённая серия попыток (без --force).
   */
  substantive?: boolean;
  /** Системная отметка на проверку после правки (dedupeKey review:v1:<reason>:<id вопроса>:<id правки>). */
  review?: { reason: SystemReviewReason; comment: string };
  edits: TextEdit[];
}

/** Текстовые поля вопроса, которые правит ревизия. */
export interface EditableQuestion {
  prompt: string;
  options: string[];
  explanation: string | null;
  optionRationales: string[] | null;
}

export type FixOutcome =
  | { status: 'apply'; next: EditableQuestion; changedFields: TextField[] }
  | { status: 'already' }
  | { status: 'mismatch'; problems: string[] };

function countOf(text: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) n++;
  return n;
}

const fieldLabel = (e: TextEdit) => (e.index === undefined ? e.field : `${e.field}[${e.index}]`);

function readField(q: EditableQuestion, e: TextEdit): string | null {
  if (e.field === 'prompt') return q.prompt;
  if (e.field === 'explanation') return q.explanation;
  const arr = e.field === 'options' ? q.options : q.optionRationales;
  if (!arr || e.index === undefined || !Number.isInteger(e.index) || e.index < 0 || e.index >= arr.length) return null;
  return arr[e.index] ?? null;
}

function writeField(q: EditableQuestion, e: TextEdit, value: string): void {
  if (e.field === 'prompt') q.prompt = value;
  else if (e.field === 'explanation') q.explanation = value;
  else if (e.field === 'options') q.options[e.index!] = value;
  else q.optionRationales![e.index!] = value;
}

/**
 * Применяет правки к вопросу (без записи). 'already' — все правки уже на месте (стенд получил
 * исправленный артефакт или правка применена раньше); 'mismatch' — якорь не найден ни в виде
 * «было», ни в виде «стало» (иной текст: правка вручную или иной стенд) — ничего не пишем.
 */
export function applyTextEdits(q: EditableQuestion, edits: readonly TextEdit[]): FixOutcome {
  if (!edits.length) return { status: 'mismatch', problems: ['нет правок'] };
  const next: EditableQuestion = {
    prompt: q.prompt,
    options: [...q.options],
    explanation: q.explanation,
    optionRationales: q.optionRationales ? [...q.optionRationales] : null,
  };
  const problems: string[] = [];
  const changed = new Set<TextField>();
  for (const e of edits) {
    if (!e.from || !e.to || e.from === e.to) {
      problems.push(`${fieldLabel(e)}: пустая или тождественная правка`);
      continue;
    }
    const value = readField(next, e);
    if (value === null) {
      problems.push(`${fieldLabel(e)}: поля нет`);
      continue;
    }
    if (e.match === 'whole') {
      if (value === e.to) continue;
      if (value !== e.from) {
        problems.push(`${fieldLabel(e)}: текст отличается и от «было», и от «стало»`);
        continue;
      }
      writeField(next, e, e.to);
      changed.add(e.field);
      continue;
    }
    const nFrom = countOf(value, e.from);
    // «Стало» уже в тексте: правка применена (если «стало» содержит «было» — вхождение «было» тоже ожидаемо).
    if (value.includes(e.to) && (nFrom === 0 || e.to.includes(e.from))) continue;
    if (nFrom !== 1) {
      problems.push(`${fieldLabel(e)}: «${e.from.slice(0, 40)}» найдено ${nFrom} раз(а), ожидалось 1`);
      continue;
    }
    writeField(next, e, value.replace(e.from, e.to));
    changed.add(e.field);
  }
  if (problems.length) return { status: 'mismatch', problems };
  if (!changed.size) return { status: 'already' };
  return { status: 'apply', next, changedFields: [...changed] };
}

/** Проверка списка правок артефакта: уникальные id, адрес вопроса, непустые правки. */
export function validateTextFixes(fixes: readonly TextFix[]): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const f of fixes) {
    if (!f.id) out.push('правка без id');
    else if (ids.has(f.id)) out.push(`${f.id}: повтор id`);
    ids.add(f.id);
    if (!f.canonicalKey && f.orderIndex === undefined) out.push(`${f.id}: нет canonicalKey или orderIndex`);
    if (!f.edits?.length) out.push(`${f.id}: нет правок`);
    for (const e of f.edits ?? []) {
      if ((e.field === 'options' || e.field === 'optionRationales') && e.index === undefined) out.push(`${f.id}: ${e.field} без index`);
    }
  }
  return out;
}

/* ── Языковые проверки аудита ──────────────────────────────────────── */

/** Минимальная длина обоснования варианта: «верно», «неверно», «verно» — вырожденные. */
export const MIN_RATIONALE_CHARS = 25;

const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
/** Русские метки TRUE_FALSE из инструкции генерации, попавшие в kk/en-текст («Верно, because…»). */
const RU_TF_LABEL_RE = /(?<![\p{L}])(?:не)?верно(?![\p{L}])/iu;

export const hasCyrillic = (s: string) => CYRILLIC_RE.test(s);

/** Чужой алфавит/метка в тексте языка lang: en — любая кириллица; kk — русские «верно/неверно». */
export function foreignTextProblem(lang: Language, text: string): string | null {
  if (lang === 'en' && hasCyrillic(text)) return 'кириллица';
  if (lang === 'kk' && RU_TF_LABEL_RE.test(text)) return 'русская метка «верно/неверно»';
  return null;
}

export interface CheckedQuestion extends EditableQuestion {
  type: string;
}

/** Поля вопроса с чужим алфавитом/меткой (формулировка, варианты, пояснение, обоснования). */
export function questionLanguageProblems(lang: Language, q: CheckedQuestion): string[] {
  const fields: [string, string | null][] = [
    ['prompt', q.prompt],
    ...q.options.map((o, i): [string, string] => [`options[${i}]`, o]),
    ['explanation', q.explanation],
    ...(q.optionRationales ?? []).map((r, i): [string, string] => [`optionRationales[${i}]`, r]),
  ];
  const out: string[] = [];
  for (const [name, text] of fields) {
    const p = text ? foreignTextProblem(lang, text) : null;
    if (p) out.push(`${name}: ${p}`);
  }
  return out;
}

/** Вырожденные обоснования: короче MIN_RATIONALE_CHARS (одно слово-метка вместо объяснения). */
export function shortRationales(q: EditableQuestion): number[] {
  return (q.optionRationales ?? []).flatMap((r, i) => (r.trim().length < MIN_RATIONALE_CHARS ? [i] : []));
}

/* ── Расшифровки: заголовок первой строки ─────────────────────────── */

/**
 * Замена первой непустой строки текста по точному якорю (заголовок расшифровки): 'already' —
 * уже исправлено, 'absent' — первая строка другая (иной стенд) — ничего не меняем.
 */
export function replaceFirstLine(
  text: string,
  fix: { from: string; to: string },
): { status: 'apply'; text: string } | { status: 'already' | 'absent'; first: string } {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.trim());
  const first = i === -1 ? '' : lines[i]!.trim();
  if (first === fix.to) return { status: 'already', first };
  if (first !== fix.from) return { status: 'absent', first };
  return { status: 'apply', text: [...lines.slice(0, i), fix.to, ...lines.slice(i + 1)].join('\n') };
}

/* ── Незавершённые серии попыток ──────────────────────────────────── */

export interface SeriesAttempt {
  id: string;
  enrollmentId: string;
  startedAt: Date;
  submittedAt: Date | null;
  score: number;
  passed: boolean;
}

/**
 * Записи, у которых есть отправленная попытка теста, но финал ещё не наступил (не сдан и
 * попытки остались): следующая попытка такого студента должна идти по тому же инструменту.
 */
export function unfinishedSeries(attempts: readonly SeriesAttempt[], rules: { maxAttempts: number; scoringRule: ScoringRule }): string[] {
  const byEnrollment = new Map<string, SeriesAttempt[]>();
  for (const a of attempts) byEnrollment.set(a.enrollmentId, [...(byEnrollment.get(a.enrollmentId) ?? []), a]);
  const out: string[] = [];
  for (const [enrollmentId, list] of byEnrollment) {
    if (!list.some((a) => a.submittedAt !== null)) continue;
    const state = quizAttemptState(list, { maxAttempts: rules.maxAttempts, cooldownMinutes: 0, scoringRule: rules.scoringRule });
    if (!state.finalReached) out.push(enrollmentId);
  }
  return out;
}
