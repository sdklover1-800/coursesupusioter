/**
 * Разбор расшифровки лекции (FR-4.5, screen_specs «Transcript») — чистые функции без React.
 *
 * Исходные тексты — выгрузки .docx заказчика и машинные переводы: таймкоды вида
 * «[00:00–01:30] Вступление» (бывают и битые — «[00:00 –01 : 30 ]»), служебная шапка
 * до первого таймкода, заголовок секции иногда стоит СТРОКОЙ ВЫШЕ «голого» таймкода,
 * повторённые секции, «одно предложение — одна строка», хвосты «End of Lecture N»
 * и приложение «Материалы для закрепления» (ключевые понятия, литература, вопросы).
 * Парсер оборонительный: CONTENT чистит тексты параллельно, но UI не должен ломаться
 * ни на одной версии. Проверка — SCRATCH/FE2-lecture-player/check-transcripts.ts (npx tsx).
 */
import { timecodeToSeconds } from '@edu/shared';

/** Блок текста секции: абзац, подзаголовок или пункт списка. */
export interface TranscriptBlock {
  type: 'p' | 'h' | 'li';
  text: string;
}

export interface TranscriptSection {
  /** Порядковый номер секции (0…n-1) — якорь и нумерация «1. Введение» */
  index: number;
  /** Начало по таймкоду; null — секция без таймкода (текст без разметки) */
  startSec: number | null;
  /** Конец: из диапазона таймкода, иначе начало следующей секции; null — неизвестен */
  endSec: number | null;
  heading: string | null;
  /** Тексты блоков по порядку (абзацы, подзаголовки, пункты) — совместимость и поиск */
  paragraphs: string[];
  blocks: TranscriptBlock[];
  /** Секция на монотонной шкале времени (полоса разделов, «Сейчас»); повторы/откаты — нет */
  onTimeline: boolean;
}

export type AppendixKind = 'terms' | 'reading' | 'questions' | 'assignment' | 'other';

/** Раздел приложения «Материалы для закрепления». */
export interface TranscriptAppendix {
  kind: AppendixKind;
  title: string;
  items: string[];
}

/** Термин из «Ключевых понятий» (A28, вкладка «Термины»). */
export interface TranscriptTerm {
  term: string;
  definition: string | null;
}

export interface ParsedTranscript {
  sections: TranscriptSection[];
  appendices: TranscriptAppendix[];
  terms: TranscriptTerm[];
  /** Есть хотя бы один таймкод */
  hasTimecodes: boolean;
  /** Слов в показываемом тексте — для «≈ N мин чтения» */
  wordCount: number;
}

/* ── Регулярные выражения ───────────────────────────────────────────── */

const TC = String.raw`\d{1,2}(?:\s*:\s*\d{1,2}){1,2}`;
/** Граница слова для кириллицы/казахского: \b в JS понимает только ASCII-«слова» */
const WB = String.raw`(?![\p{L}\p{N}])`;
const re = (src: string, flags = 'iu') => new RegExp(src.replace(/\\b/g, WB), flags);
/** «[00:00–01:30] Заголовок», «[00:00 –01 : 30 ]», «[12:30]» — терпимо к пробелам и тире */
const TIMECODE_RE = new RegExp(String.raw`^\[\s*(${TC})\s*(?:[–—-]+\s*(${TC})\s*)?\]\s*[.:–—-]?\s*(.*)$`);

/** Служебная шапка перед первым таймкодом: заголовки «ЛЕКЦИЯ N», курс, хронометраж, формат… */
const META_RE: RegExp[] = [
  re(String.raw`^(?:№\s*\d+\s*)?(?:ЛЕКЦИЯ|ДӘРІС|LECTURE)\b`),
  re(String.raw`^\d+\s*-\s*(?:ЛЕКЦИЯ|ДӘРІС)`),
  re(
    String.raw`^(?:Курс|Course|Пән|Video\s+(?:Duration|length)|Format|Runtime|Хронометраж|Формат\S*|Тіл|Язык|Language|Бейнедәріс\S*|Бейненің|Видео\s+хронометраж\S*|Объ[её]м|Көлемі|Мәтін\s+көлемі|Word\s+count|Length)\b`,
  ),
  re(String.raw`^(?:Раздел|Section|Бөлім)\s+[IVXLC\d]+\b`),
  re(String.raw`^[IVXLC]+\s+бөлім\b`),
];

/** Хвост «End of Lecture 3», «Конец лекции», «№4 дәрістің аяқталуы» */
const END_RE = re(
  String.raw`^(?:End\s+of\s+(?:the\s+)?Lecture\b|Конец\s+лекции\b|Лекция\s+\d+\s+(?:окончена|завершена)\b|(?:№\s*)?\d*\s*-?\s*дәрістің\s+(?:аяқталуы|соңы)\b|Дәріс\s+соңы\b)`,
);

/** Обёртка приложения: «Материалы для закрепления (для описания к видео / методички)» */
const MATERIALS_RE = re(
  String.raw`^(?:Материалы\s+для\s+закрепления|Дополнительные\s+материалы|Бекіт\S*\s+арналған\s+материалдар|Бекіту\s+материалдары|Қосымша\s+материалдар|Materials\s+for\s+reinforcement|Reinforcement\s+materials|Supplementary\s+materials)\b`,
);

/** Заголовки разделов приложения; хвост после «:» — инлайн-список */
const APPENDIX_HEADS: { kind: AppendixKind; re: RegExp }[] = [
  { kind: 'terms', re: re(String.raw`^(Ключевые\s+понятия|Основные\s+понятия|Негізгі\s+ұғымдар|Key\s+concepts|Key\s+terms)\s*(?::\s*(.*))?$`) },
  {
    kind: 'reading',
    re: re(
      String.raw`^(Рекомендуемая\s+литература|Литература|Ұсынылатын\s+әдебиет(?:тер)?|Әдебиеттер(?:\s+тізімі)?|Recommended\s+reading|Further\s+reading|References)\s*(?::\s*(.*))?$`,
    ),
  },
  {
    kind: 'questions',
    re: re(
      String.raw`^(Контрольные\s+вопросы(?:\s+к\s+лекции)?|Вопросы\s+для\s+(?:повторения|самопроверки|обсуждения)|(?:Дәріс(?:ке)?\s+(?:бойынша\s+)?)?(?:арналған\s+)?бақылау\s+сұрақтары|Қайталау(?:ға\s+арналған)?\s+сұрақтар(?:ы)?|Өзін-өзі\s+тексеру(?:ге\s+арналған)?\s+сұрақтар(?:ы)?|Талқылау(?:ға\s+арналған)?\s+сұрақтар(?:ы)?|Review\s+questions(?:\s+for\s+the\s+lecture)?|Discussion\s+questions|Self-check\s+questions|Questions\s+for\s+(?:self-?review|review|discussion))\s*(?::\s*(.*))?$`,
    ),
  },
  { kind: 'assignment', re: re(String.raw`^(Практическое\s+задание|Практикалық\s+тапсырма|Practical\s+assignment)\s*(?::\s*(.*))?$`) },
];

/** Библиографическая запись: «Фамилия И.», «Фамилия И.О.», «Surname, I.» в начале строки */
const BIBLIO_RE = /^[\p{Lu}][\p{L}’'-]+,?\s+(?:[\p{Lu}]\.\s*){1,2}(?:,|\s|$)/u;
const BULLET_RE = /^(?:[●•▪◦∙·*]|[-–—](?=\s))\s*/;
const TERMINAL_RE = /[.!?…»"”)\]]$/;
const CONTINUES_RE = /[,;:–—-]$/;
/** Подзаголовок не кончается знаком предложения; кавычка/скобка допустимы («…темір заңы») */
const SENTENCE_END_RE = /[.!?…]$/;
/** Префиксы нумерации источника — нумеруем сами: «Блок 4.», «1-блок.», «Section 2.», «2-бөлім.», «1.» */
const HEADING_PREFIX_RE = [
  re(String.raw`^(?:Блок|Block|Section|Раздел|Бөлім|Часть|Part)\s*\d+\s*[.:)]?\s*`),
  re(String.raw`^\d+\s*-\s*(?:блок|бөлім|бөлік)\s*[.:)]?\s*`),
  /^\d+\s*[.)]\s+(?=\S)/,
];

/** Аббревиатуры, которые не опускаем при переводе ЗАГЛАВНОГО заголовка в обычный регистр */
const KEEP_UPPER = new Set(['SWOT', 'TOWS', 'STEEP', 'PEST', 'NATO', 'OSCE', 'EU', 'UN', 'USA', 'USSR', 'ООН', 'ЕС', 'СССР', 'США', 'НАТО', 'ОБСЕ', 'ШОС', 'ЕАЭС', 'СНГ', 'ҚР', 'РК', 'АҚШ', 'БҰҰ', 'КСРО', 'ЕО']);

/* ── Мелкие помощники ───────────────────────────────────────────────── */

const isUpperLetter = (ch: string | undefined): boolean => !!ch && ch !== ch.toLowerCase() && ch === ch.toUpperCase();
const isLowerLetter = (ch: string | undefined): boolean => !!ch && ch !== ch.toUpperCase() && ch === ch.toLowerCase();

function firstLetter(s: string): string | undefined {
  for (const ch of s) if (/\p{L}/u.test(ch)) return ch;
  return undefined;
}

/** Строка начинается со строчной буквы (продолжение предложения с прошлой строки). */
function startsLower(s: string): boolean {
  const ch = s.trimStart()[0];
  return isLowerLetter(ch);
}

function upperRatio(s: string): number {
  const letters = s.replace(/[^\p{L}]/gu, '');
  if (letters.length < 4) return 0;
  return letters.replace(/[^\p{Lu}]/gu, '').length / letters.length;
}

/** «РЕАЛИЗМ: ГОСУДАРСТВО, СИЛА И АНАРХИЯ» → «Реализм: государство, сила и анархия» (аббревиатуры — как есть). */
export function toSentenceCase(s: string): string {
  if (upperRatio(s) < 0.8) return s;
  let first = true;
  return s.replace(/\p{L}+/gu, (word) => {
    const keep = KEEP_UPPER.has(word);
    const out = keep ? word : word.toLowerCase();
    if (first) {
      first = false;
      return keep ? out : out.charAt(0).toUpperCase() + out.slice(1);
    }
    return out;
  });
}

function cleanHeading(raw: string): string {
  let h = raw.replace(/\s+/g, ' ').trim();
  for (const re of HEADING_PREFIX_RE) h = h.replace(re, '');
  h = h.replace(/[\s:–—-]+$/, '').trim();
  return toSentenceCase(h);
}

/**
 * Заголовок, в который «приклеился» абзац (кривой экспорт): режем на первой границе
 * «строчная буква, пробел, Заглавная» после третьего слова. Только для длинных строк.
 */
function splitRunOnHeading(h: string): { heading: string; rest: string | null } {
  if (h.length <= 100) return { heading: h, rest: null };
  const words = h.split(' ');
  let pos = 0;
  for (let i = 0; i < words.length - 1; i += 1) {
    pos += words[i]!.length + 1;
    if (i < 2) continue;
    const last = words[i]!.slice(-1);
    if (isLowerLetter(last) && isUpperLetter(words[i + 1]![0])) {
      return { heading: h.slice(0, pos - 1).trim(), rest: h.slice(pos).trim() };
    }
  }
  // Нет явной границы — отрезаем по первой точке
  const dot = h.indexOf('. ', 20);
  if (dot > 0) return { heading: h.slice(0, dot).trim(), rest: h.slice(dot + 2).trim() };
  return { heading: h, rest: null };
}

/** Строка похожа на подзаголовок: короткая, без знака конца/продолжения, дальше — новая мысль. */
function isHeadingCandidate(line: string, next: string | undefined): boolean {
  if (!next) return false;
  if (line.length > 110 || BULLET_RE.test(line)) return false;
  if (SENTENCE_END_RE.test(line) || CONTINUES_RE.test(line)) return false;
  if (line.split(/\s+/).length > 14) return false;
  if (!firstLetter(line)) return false;
  const startsUpperOrDigit = isUpperLetter(line.trimStart()[0]) || /^\d/.test(line);
  if (!startsUpperOrDigit) return false;
  if (startsLower(next)) return false;
  return true;
}

function stripBullet(s: string): string {
  return s.replace(BULLET_RE, '').trim();
}

function matchAppendixHead(line: string): { kind: AppendixKind; title: string; inline: string | null } | null {
  const clean = stripBullet(line);
  for (const { kind, re } of APPENDIX_HEADS) {
    const m = re.exec(clean);
    if (m) return { kind, title: m[1]!.replace(/\s+/g, ' '), inline: m[2]?.trim() || null };
  }
  return null;
}

/** «Монтескьё Ш. О духе законов. Контрольные вопросы к лекции:» — заголовок в хвосте строки. */
function splitTrailingHead(line: string): [string, string] | null {
  for (const { re } of APPENDIX_HEADS) {
    const src = re.source.replace(/^\^/, '');
    const m = new RegExp(String.raw`^(.*?[.!?])\s+(${src})`, re.flags).exec(line);
    if (m && m[1] && m[1].length > 3) return [m[1].trim(), line.slice(m[1].length).trim()];
  }
  return null;
}

function isMeta(line: string): boolean {
  return META_RE.some((re) => re.test(line));
}

/** Список через запятую/точку с запятой, не разрывая скобки: «суверенитет (de jure, de facto), власть». */
function splitInlineList(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === ';') && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim().replace(/[.;,]+$/, '').trim()).filter(Boolean);
}

function toTerm(item: string): TranscriptTerm {
  const clean = stripBullet(item).replace(/[;.]+$/, '').trim();
  const m = /^(.{2,80}?)\s+[—–]\s+(.+)$/.exec(clean);
  if (m) return { term: m[1]!.trim(), definition: m[2]!.trim() };
  return { term: clean.charAt(0).toUpperCase() + clean.slice(1), definition: null };
}

const countWords = (s: string): number => (s.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) ?? []).length;

/* ── Сборка блоков секции ───────────────────────────────────────────── */

function buildBlocks(lines: string[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const next = lines[i + 1];
    const prev = blocks[blocks.length - 1];
    if (BULLET_RE.test(line) && stripBullet(line)) {
      blocks.push({ type: 'li', text: stripBullet(line) });
      continue;
    }
    // Склейка «одно предложение — одна строка»: строка без точки + строчная буква дальше,
    // либо предыдущая строка оборвалась на запятой/двоеточии/тире.
    if (prev && prev.type === 'p' && !TERMINAL_RE.test(prev.text) && (startsLower(line) || CONTINUES_RE.test(prev.text))) {
      prev.text = `${prev.text} ${line}`;
      continue;
    }
    if (isHeadingCandidate(line, next)) {
      blocks.push({ type: 'h', text: toSentenceCase(line) });
      continue;
    }
    blocks.push({ type: 'p', text: line });
  }
  // Подзаголовок в самом конце секции без текста после него — это обычный абзац
  const last = blocks[blocks.length - 1];
  if (last?.type === 'h') last.type = 'p';
  return blocks;
}

/* ── Приложение ─────────────────────────────────────────────────────── */

function parseAppendix(lines: string[]): { appendices: TranscriptAppendix[]; terms: TranscriptTerm[] } {
  const appendices: TranscriptAppendix[] = [];
  let current: TranscriptAppendix | null = null;
  let afterMaterials = false;
  const expanded: string[] = [];
  for (const l of lines) {
    const split = matchAppendixHead(l) ? null : splitTrailingHead(l);
    if (split) expanded.push(split[0], split[1]);
    else expanded.push(l);
  }
  for (const raw of expanded) {
    const line = raw.trim();
    if (!line) continue;
    if (MATERIALS_RE.test(stripBullet(line))) {
      afterMaterials = true;
      continue;
    }
    // «(для описания к видео / методички)» сразу после обёртки
    if (afterMaterials && /^\(.*\)$/.test(line)) continue;
    afterMaterials = false;
    const head = matchAppendixHead(line);
    if (head) {
      current = { kind: head.kind, title: head.title, items: [] };
      appendices.push(current);
      if (head.inline) {
        if (head.kind === 'terms') current.items.push(...splitInlineList(head.inline));
        else current.items.push(head.inline);
      }
      continue;
    }
    if (!current) {
      current = { kind: 'other', title: '', items: [] };
      appendices.push(current);
    }
    // Хвост-повтор названия курса капсом («INTRODUCTION TO POLITICAL SCIENCE»)
    if (upperRatio(line) > 0.8 && line.length < 80 && !/\d/.test(line)) continue;
    // Выпал заголовок «Литература»: «Дюверже М. …», «Morgenthau, H. …» внутри терминов
    if (current.kind === 'terms' && BIBLIO_RE.test(stripBullet(line))) {
      current = { kind: 'reading', title: '', items: [] };
      appendices.push(current);
    }
    let item = stripBullet(line);
    if (current.kind === 'terms') item = item.replace(/[;.]+$/, '').trim();
    if (current.kind === 'questions') item = item.replace(/^\d+\s*[.)]\s*/, '');
    if (item) current.items.push(item);
  }
  const nonEmpty = appendices.filter((a) => a.items.length > 0);
  const terms: TranscriptTerm[] = [];
  const seen = new Set<string>();
  for (const a of nonEmpty) {
    if (a.kind !== 'terms') continue;
    for (const it of a.items) {
      const t = toTerm(it);
      const key = searchNormalize(t.term);
      if (!t.term || seen.has(key)) continue;
      seen.add(key);
      terms.push(t);
    }
  }
  return { appendices: nonEmpty, terms };
}

/* ── Главная функция ────────────────────────────────────────────────── */

interface RawSection {
  startSec: number | null;
  endSec: number | null;
  heading: string | null;
  lines: string[];
}

export function parseTranscript(text: string | null | undefined): ParsedTranscript {
  const lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[   ]/g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const firstTc = lines.findIndex((l) => TIMECODE_RE.test(l));
  const hasTimecodes = firstTc >= 0;
  const raw: RawSection[] = [];

  // Шапка до первого таймкода скрыта: заголовок лекции уже в H1, «Курс/Хронометраж/Формат»
  // студенту не нужны. Оставляем только длинные абзацы прозы (≥ 200 символов) без служебных меток.
  const preamble = hasTimecodes ? lines.slice(0, firstTc) : [];
  const body = hasTimecodes ? lines.slice(firstTc) : lines;
  const intro = preamble.filter((l) => l.length >= 200 && !isMeta(l));
  if (intro.length) raw.push({ startSec: null, endSec: null, heading: null, lines: intro });

  let current: RawSection | null = hasTimecodes ? null : { startSec: null, endSec: null, heading: null, lines: [] };
  if (current) raw.push(current);
  let skippingLeadMeta = !hasTimecodes;

  for (let i = 0; i < body.length; i += 1) {
    const line = body[i]!;
    const tc = TIMECODE_RE.exec(line);
    if (tc) {
      let heading = tc[3]?.trim() || null;
      // «Голый» таймкод: заголовок строкой выше (лекции 11–15) или строкой ниже
      if (!heading && current && current.lines.length) {
        const prevLine = current.lines[current.lines.length - 1]!;
        if (isHeadingCandidate(prevLine, body[i + 1])) {
          heading = prevLine;
          current.lines.pop();
        }
      }
      if (!heading && body[i + 1] && !TIMECODE_RE.test(body[i + 1]!) && isHeadingCandidate(body[i + 1]!, body[i + 2])) {
        heading = body[i + 1]!;
        i += 1;
      }
      current = {
        startSec: timecodeToSeconds(tc[1]),
        endSec: tc[2] ? timecodeToSeconds(tc[2]) : null,
        heading,
        lines: [],
      };
      raw.push(current);
      continue;
    }
    if (END_RE.test(line)) {
      // Хвост «End of Lecture 3» + повтор названия — отбрасываем; если дальше ещё много текста — только строку
      if (body.length - i - 1 <= 3) break;
      continue;
    }
    if (skippingLeadMeta) {
      if (isMeta(line) || (upperRatio(line) > 0.8 && line.length < 80)) continue;
      skippingLeadMeta = false;
    }
    current?.lines.push(line);
  }

  // Приложение «Материалы для закрепления» — в последней секции, с первого его заголовка
  // (при кривом экспорте после него бывают повторы секций — ищем с конца)
  let appendixLines: string[] = [];
  for (let k = raw.length - 1; k >= 0; k -= 1) {
    const r = raw[k]!;
    const at = r.lines.findIndex((l) => MATERIALS_RE.test(stripBullet(l)) || !!matchAppendixHead(l));
    if (at >= 0) {
      appendixLines = r.lines.slice(at);
      r.lines = r.lines.slice(0, at);
      break;
    }
  }
  // Висящий в конце повтор названия курса капсом
  for (const s of raw) {
    while (s.lines.length && upperRatio(s.lines[s.lines.length - 1]!) > 0.8 && s.lines[s.lines.length - 1]!.length < 80) s.lines.pop();
  }

  // Секции: заголовок, блоки, слияние повторов
  const merged: TranscriptSection[] = [];
  for (const r of raw) {
    let heading: string | null = r.heading ? cleanHeading(r.heading) : null;
    const lines = [...r.lines];
    if (heading) {
      const split = splitRunOnHeading(heading);
      heading = split.heading || null;
      if (split.rest) lines.unshift(split.rest);
    }
    // Первая строка дублирует заголовок — убираем
    if (heading && lines[0] && cleanHeading(lines[0]).toLowerCase() === heading.toLowerCase()) lines.shift();
    const blocks = buildBlocks(lines);
    const prev = merged[merged.length - 1];
    const same =
      prev &&
      prev.startSec === r.startSec &&
      (prev.heading ?? '').toLowerCase() === (heading ?? '').toLowerCase();
    if (same && prev) {
      // Подряд идущие одинаковые заголовки (повтор блока при экспорте) — одна секция
      prev.blocks.push(...blocks);
      if (prev.endSec === null) prev.endSec = r.endSec;
      continue;
    }
    if (!heading && !blocks.length) continue;
    merged.push({ index: merged.length, startSec: r.startSec, endSec: r.endSec, heading, paragraphs: [], blocks, onTimeline: false });
  }

  // Шкала времени: только строго возрастающие начала (откаты/повторы — вне шкалы)
  let lastStart = -1;
  for (const s of merged) {
    if (s.startSec !== null && s.startSec > lastStart) {
      s.onTimeline = true;
      lastStart = s.startSec;
    }
  }
  const timeline = merged.filter((s) => s.onTimeline);
  timeline.forEach((s, k) => {
    const nextStart = timeline[k + 1]?.startSec ?? null;
    if (s.endSec === null || s.endSec <= (s.startSec ?? 0)) s.endSec = nextStart;
    // Диапазон источника может перекрываться со следующей секцией — конец не позже её начала
    if (nextStart !== null && s.endSec !== null && s.endSec > nextStart) s.endSec = nextStart;
  });
  merged.forEach((s, k) => {
    s.index = k;
    s.paragraphs = s.blocks.map((b) => b.text);
  });

  const { appendices, terms } = parseAppendix(appendixLines);
  let wordCount = 0;
  for (const s of merged) {
    if (s.heading) wordCount += countWords(s.heading);
    for (const b of s.blocks) wordCount += countWords(b.text);
  }
  for (const a of appendices) for (const it of a.items) wordCount += countWords(it);

  return { sections: merged, appendices, terms, hasTimecodes, wordCount };
}

/* ── Поиск ──────────────────────────────────────────────────────────── */

/**
 * Нормализация для поиска: нижний регистр и ё→е; казахские буквы сохраняются.
 * Посимвольно и 1:1 по длине — позиции совпадений совпадают с исходным текстом.
 */
export function searchNormalize(s: string): string {
  let out = '';
  for (const ch of s) {
    let c = ch.toLowerCase();
    if (c.length !== ch.length) c = ch; // редкие буквы с «длинным» lowercase (İ) — как есть
    if (c === 'ё') c = 'е';
    out += c;
  }
  return out;
}

/** Все вхождения запроса в текст: [start, end) по исходной строке. */
export function findMatches(text: string, query: string): [number, number][] {
  const q = searchNormalize(query.trim());
  if (q.length < 2) return [];
  const hay = searchNormalize(text);
  const out: [number, number][] = [];
  let from = 0;
  for (;;) {
    const at = hay.indexOf(q, from);
    if (at < 0) break;
    out.push([at, at + q.length]);
    from = at + q.length;
  }
  return out;
}

/**
 * Запрос для поиска термина в тексте: основа до «;» или «(» и — для длинных слов — без
 * окончаний, чтобы «власть» находила «власти», «билік» — «биліктің».
 */
export function termQuery(term: string): string {
  const head = term.split(/[;(]/)[0]!.trim();
  return head;
}

export function termStem(term: string): string {
  const head = termQuery(term);
  const words = head.split(/\s+/);
  if (words.length !== 1) return head;
  const w = words[0]!;
  return w.length > 6 ? w.slice(0, w.length - 2) : w;
}

/** Секция шкалы, в которую попадает момент t: [start, end). */
export function activeSectionAt(sections: TranscriptSection[], t: number | null | undefined): TranscriptSection | null {
  if (t === null || t === undefined || !Number.isFinite(t)) return null;
  let found: TranscriptSection | null = null;
  for (const s of sections) {
    if (!s.onTimeline || s.startSec === null) continue;
    if (s.startSec <= t + 0.25) found = s;
    else break;
  }
  return found;
}

/** Время чтения при ≈ 180 слов/мин (минимум 1 мин). */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 180));
}
