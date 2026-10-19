/**
 * Перевод недостающих расшифровок с русского (решение пользователя 19.10.2026 по курсу «Введение в
 * философию»: kk/en-тексты лекций 4 и 14 автор не прислал — переводим сами). Единица — лекция
 * языковой версии kk/en с ПУСТОЙ расшифровкой при непустой ru-расшифровке на той же позиции
 * (модуль, лекция); код единицы — «kk-04».
 *  - `--draft` (только локально, LLM): ru-текст переводится по разделам BE4 translateTranscript
 *    (mode translate, effort medium, глоссарий из параллельных лекций курса). Таймкоды — байт-в-байт
 *    как в ru (другой разметки у видео этого языка нет); первая строка шапки — «N-дәріс. …» /
 *    «Lecture N. …» по названию лекции версии; метка раздела («БӨЛІМ 1.» / «SECTION 1.»), регистр
 *    заголовка и заголовки приложения («Негізгі ұғымдар», «Key Concepts», …) — детерминированно по
 *    ru, в формах, которые распознаёт плеер. Раздел, потерявший строки (абзацы, пункты приложения),
 *    переводится повторно. Артефакт content-data/<курс>/translations.v1.json: текст построчно
 *    (`lines`, текст = lines.join('\n')), sha256 ru-оригинала, таймкоды, длительность, пометки
 *    переводчика и проверок. Черновик читает и правит человек (правки — в `meta.reviewEdits`).
 *  - `--from translations.v1.json [--apply --i-have-a-backup]`: без LLM пишет расшифровку — только в
 *    пустую или в записанную ранее этим скриптом и не правленную после (исправленный артефакт);
 *    иначе (автор прислал текст, правка менеджера) — пропуск, `--force` — перезаписать. Вместе с ней —
 *    durationSec (конец последнего таймкода), если длительность не задана вручную, и отметка
 *    NATIVE_PROOFREAD (origin SYSTEM) на вычитку носителем.
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/translate-transcripts.ts --course "Введение в философию" --draft [--lang kk,en] [--only kk-04,en-14]
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/translate-transcripts.ts --course "Введение в философию" --from translations.v1.json [--apply --i-have-a-backup] [--force]
 */
import type { Prisma } from '@prisma/client';
import type { Language } from '@edu/shared';
import { type DraftUsage, getDraftUsage, parseTranscript, translateTranscript } from '../../generation/drafts.js';
import {
  type LectureCtx,
  type VersionCtx,
  Report,
  courseProfile,
  fail,
  flagForReview,
  lectureByPos,
  lectureCode,
  ledgerGet,
  ledgerKey,
  ledgerPut,
  loadCourse,
  parseArgs,
  prisma,
  readArtifact,
  recordSpend,
  round,
  run,
  sha256,
  timecodeRanges,
  version,
  writeArtifact,
} from './lib.js';

const SCRIPT = 'translate-transcripts';
const ARTIFACT = 'translations.v1.json';
const SOURCE: Language = 'ru';
/** Единицы (лекция × язык) переводятся параллельно, разделы одной лекции — по порядку. */
const CONCURRENCY = 3;
/** Попыток на раздел: повтор, если перевод потерял строки или вызов упал. */
const SECTION_ATTEMPTS = 3;

type Target = Exclude<Language, 'ru'>;

interface Item {
  /** «kk-04» — код единицы в отчётах и ключе журнала. */
  code: string;
  lang: Target;
  /** Сквозной номер лекции курса. */
  lecture: number;
  module: number;
  lectureOrder: number;
  /** Название лекции в версии на момент черновика (для чтения человеком). */
  title: string;
  source: { code: string; title: string; sha256: string; chars: number };
  /** Таймкоды разделов — те же, что у ru-оригинала. */
  timecodes: string[];
  /** Конец последнего таймкода, сек. */
  durationSec: number | null;
  /** Текст расшифровки построчно. */
  lines: string[];
  /** Пометки переводчика (термины) и автоматических проверок («ПРОВЕРКА …»). */
  notes: string[];
}

interface ReviewEdit {
  code: string;
  from: string;
  to: string;
  note: string;
}

interface Artifact {
  meta: {
    version: 1;
    /** Название ru-версии курса — защита от применения к чужому курсу. */
    course: string;
    createdAt: string;
    model: string;
    effort: 'medium';
    sourceLanguage: Language;
    glossaryEntries: Partial<Record<Target, number>>;
    llm: DraftUsage;
    /** Правки рецензента «было → стало» (по коду единицы). */
    reviewEdits?: ReviewEdit[];
    reviewNotes?: string[];
    /** Дата вычитки человеком. */
    reviewedAt?: string;
  };
  items: Item[];
}

/** Что пишется в журнал ContentMigration (по нему узнаём «наш» текст при исправлении артефакта). */
interface LedgerDetail {
  lectureId: string;
  afterSha256: string;
  durationSec: number | null;
  beforeSha256?: string;
  forced?: boolean;
  revisions?: { at: string; beforeSha256: string; afterSha256: string }[];
}

/* ── Шапка, метки разделов, приложение ──────────────────────────── */

/** Первая строка шапки «Лекция N. …» (её не переводим, а строим по названию лекции версии). */
const LECTURE_LINE_RE = /^\s*(?:Лекция|Lecture)\s*№?\s*\d+\s*[.:]|^\s*\d+\s*-\s*дәріс\s*[.:]/iu;

/** «4-дәріс. …» / «Lecture 4. …» — как у расшифровок автора; название — без префикса «N. ». */
function lectureLine(lang: Target, n: number, title: string): string {
  const t = title.replace(/^\s*\d+\.\s*/u, '').trim();
  return lang === 'kk' ? `${n}-дәріс. ${t}` : `Lecture ${n}. ${t}`;
}

/** Метка раздела ru: «РАЗДЕЛ 1.», «Блок 1.» (политология, философия л.5) или «1.». */
const SECTION_LABEL_RE = /^(РАЗДЕЛ|Раздел|БЛОК|Блок)\s+(\d+)\s*[.:]\s*/u;
const NUMBER_LABEL_RE = /^(\d+)\.\s+/u;
/** Любая метка в начале переведённого заголовка — модель могла записать её по-своему. */
const ANY_LABEL_RE =
  /^(?:(?:БӨЛІМ|Бөлім|SECTION|Section|PART|Part|РАЗДЕЛ|Раздел|БЛОК|Блок|BLOCK|Block)\s*\d+\s*[.:]\s*|\d+\s*-\s*(?:БӨЛІМ|бөлім|БЛОК|блок)\s*[.:]\s*|\d+\.\s+)/u;

/** Метка раздела на языке перевода — как у лекций автора: «БӨЛІМ 1.» / «SECTION 1.», «Блок» → «1-бөлім.» / «Part 1.». */
function targetLabel(srcTitle: string, lang: Target): string {
  const m = SECTION_LABEL_RE.exec(srcTitle);
  if (m) {
    const n = m[2]!;
    if (/^блок/iu.test(m[1]!)) return lang === 'kk' ? `${n}-бөлім. ` : `Part ${n}. `;
    return lang === 'kk' ? `Бөлім ${n}. ` : `Section ${n}. `;
  }
  const k = NUMBER_LABEL_RE.exec(srcTitle);
  return k ? `${k[1]}. ` : '';
}

/** Однословные заголовки разделов — переводятся без модели. */
const FIXED_TITLES: Record<string, Record<Target, string>> = {
  введение: { kk: 'Кіріспе', en: 'Introduction' },
  заключение: { kk: 'Қорытынды', en: 'Conclusion' },
};

/** Заголовки приложения «Материалы для закрепления» — в формах, которые распознаёт плеер (frontend lib/transcript.ts). */
const APPENDIX_HEADINGS: { re: RegExp; to: Record<Target, string> }[] = [
  { re: /^\s*Материалы\s+для\s+закрепления\s*:?\s*$/iu, to: { kk: 'Бекітуге арналған материалдар', en: 'Materials for Reinforcement' } },
  { re: /^\s*Ключевые\s+понятия\s*:?\s*$/iu, to: { kk: 'Негізгі ұғымдар', en: 'Key Concepts' } },
  { re: /^\s*Рекомендуемая\s+литература\s*:?\s*$/iu, to: { kk: 'Ұсынылатын әдебиет', en: 'Recommended Reading' } },
  { re: /^\s*Вопросы\s+для\s+самопроверки\s*:?\s*$/iu, to: { kk: 'Өзін-өзі тексеру сұрақтары', en: 'Self-Check Questions' } },
  { re: /^\s*Контрольные\s+вопросы\s*:?\s*$/iu, to: { kk: 'Бақылау сұрақтары', en: 'Review Questions' } },
];

/** Текст набран заглавными (заголовки «ВВЕДЕНИЕ», «РАЗДЕЛ 1. …», «МАТЕРИАЛЫ …»). */
const isUpper = (s: string) => /\p{L}/u.test(s) && s === s.toUpperCase();
const sameCase = (src: string, s: string) => (isUpper(src) ? s.toUpperCase() : s);

/** Заголовок раздела на языке перевода: фиксированный, иначе перевод модели с меткой и регистром как у ru. */
function sectionTitle(srcTitle: string, translated: string, lang: Target): string {
  const fixed = FIXED_TITLES[srcTitle.trim().toLowerCase()];
  if (fixed) return sameCase(srcTitle, fixed[lang]);
  const label = targetLabel(srcTitle, lang);
  const body = label ? translated.replace(ANY_LABEL_RE, '').trim() : translated.trim();
  return sameCase(srcTitle, `${label}${body}`);
}

/** Строки текста без пустых и хвостовых пробелов (у расшифровок курса абзац — строка). */
const textLines = (s: string) =>
  s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());

/** Конец последнего таймкода, сек (как generation/common transcriptEndSeconds). */
function transcriptEndSeconds(text: string): number | null {
  const { sections } = parseTranscript(text);
  return sections.length ? Math.max(...sections.map((s) => s.end)) : null;
}

const fmt = (s: number | null) => (s === null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

/* ── Глоссарий ru → kk/en из параллельных лекций курса ─────────────── */

const TERMS_RE = /^\s*(?:Ключевые\s+понятия|Негізгі\s+ұғымдар|Key\s+Concepts)\s*:?\s*$/iu;
const APPENDIX_NEXT_RE =
  /^\s*(?:Рекомендуемая\s+литература|Литература|Вопросы\s+для|Контрольные\s+вопросы|Ұсынылатын\s+әдебиет|Әдебиет|Өзін-өзі\s+тексеру|Бақылау\s+сұрақтары|Recommended\s+Reading|Further\s+Reading|Self-Check\s+Questions|Review\s+Questions)/iu;

/** Строки блока «Ключевые понятия» (до следующего заголовка приложения). */
function conceptLines(text: string): string[] {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => TERMS_RE.test(l));
  if (i === -1) return [];
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (!l.trim() || APPENDIX_NEXT_RE.test(l)) break;
    out.push(l.trim());
  }
  return out;
}

/** Делит перечень по запятым/точкам с запятой вне скобок. */
function splitList(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === ';') && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.replace(/^[\s•●\-–]+|[\s.;,]+$/gu, '').trim()).filter(Boolean);
}

/** «Стоицизм: логос, апатия» → ['Стоицизм', 'логос, апатия']; без короткой метки — [null, строка]. */
function splitLabel(s: string): [string | null, string] {
  const i = s.indexOf(': ');
  return i > 0 && i < 60 ? [s.slice(0, i).trim(), s.slice(i + 2).trim()] : [null, s.trim()];
}

function addPair(g: Record<string, string>, a: string, b: string, max = 120): void {
  const x = a.trim();
  const y = b.trim();
  if (x && y && x !== y && x.length <= max && y.length <= max && !(x in g)) g[x] = y;
}

/**
 * Соответствия ru → язык перевода по лекциям, где есть оба текста: названия лекций, заголовки
 * разделов (при равном числе разделов) и пункты «Ключевых понятий» (при равном числе строк/пунктов).
 */
function buildGlossary(ru: VersionCtx, tgt: VersionCtx): Record<string, string> {
  const g: Record<string, string> = {};
  for (const r of ru.lectures) {
    const t = tgt.lectures.find((x) => x.moduleOrder === r.moduleOrder && x.lectureOrder === r.lectureOrder);
    if (!t || !r.transcriptText.trim() || !t.transcriptText.trim()) continue;
    addPair(g, r.title.replace(/^\s*\d+\.\s*/u, ''), t.title.replace(/^\s*\d+\.\s*/u, ''));
    const rs = parseTranscript(r.transcriptText).sections;
    const ts = parseTranscript(t.transcriptText).sections;
    if (rs.length === ts.length) {
      rs.forEach((s, i) => addPair(g, s.title.replace(ANY_LABEL_RE, ''), ts[i]!.title.replace(ANY_LABEL_RE, ''), 90));
    }
    const rc = conceptLines(r.transcriptText);
    const tc = conceptLines(t.transcriptText);
    if (rc.length !== tc.length) continue;
    rc.forEach((line, i) => {
      const [la, ra] = splitLabel(line);
      const [lb, rb] = splitLabel(tc[i]!);
      if (la && lb) addPair(g, la, lb, 60);
      const ia = splitList(ra);
      const ib = splitList(rb);
      // Пункты — попарно, только если перечни совпали по числу и «форме» (перевод мог переставить
      // слова через запятую: «основания бытия, познания» ↔ «болмыстың, танымның … негіздері»).
      const aligned = ia.length === ib.length && ia.every((x, k) => x.length / ib[k]!.length >= 0.4 && x.length / ib[k]!.length <= 2.5);
      if (aligned) ia.forEach((x, k) => addPair(g, x, ib[k]!, 80));
      else addPair(g, ra, rb, 160);
    });
  }
  return g;
}

/* ── Черновик ───────────────────────────────────────────────────── */

interface Unit {
  code: string;
  lang: Target;
  tgt: LectureCtx;
  src: LectureCtx;
}

/** Перевод одного раздела (заголовок с таймкодом + текст); повтор, если строки потерялись или вызов упал. */
async function translateSection(
  code: string,
  header: { prefix: string; title: string },
  body: string[],
  lang: Target,
  glossary: Record<string, string>,
): Promise<{ title: string; lines: string[]; notes: string[] }> {
  const label = header.prefix.trim() || 'шапка';
  const src = header.prefix ? [`${header.prefix}${header.title}`.trimEnd(), ...body].join('\n') : body.join('\n');
  let best: { title: string; lines: string[]; notes: string[] } | null = null;
  for (let attempt = 1; attempt <= SECTION_ATTEMPTS; attempt++) {
    let r: Awaited<ReturnType<typeof translateTranscript>>;
    try {
      r = await translateTranscript(src, lang, { mode: 'translate', effort: 'medium', glossary, sourceLanguage: SOURCE });
    } catch (e) {
      console.log(`   ⚠ ${code} ${label}: ${(e as Error).message} — попытка ${attempt}/${SECTION_ATTEMPTS}`);
      if (attempt === SECTION_ATTEMPTS) throw e;
      continue;
    }
    const out = textLines(r.text);
    let title = '';
    if (header.prefix) {
      const head = out.shift() ?? '';
      // Префикс таймкода переносит translateTranscript (модель его не видит) — проверяем на всякий случай.
      if (!head.startsWith(header.prefix.trimEnd())) {
        console.log(`   ⚠ ${code} ${label}: заголовок без таймкода «${head.slice(0, 60)}» — попытка ${attempt}/${SECTION_ATTEMPTS}`);
        if (attempt === SECTION_ATTEMPTS) throw new Error(`${code} ${label}: перевод потерял таймкод заголовка`);
        continue;
      }
      title = head.slice(header.prefix.trimEnd().length).trim();
    }
    const cur = { title, lines: out, notes: r.notes };
    if (out.length === body.length) return cur;
    console.log(`   ⚠ ${code} ${label}: строк ${out.length} вместо ${body.length} — попытка ${attempt}/${SECTION_ATTEMPTS}`);
    if (!best || Math.abs(out.length - body.length) < Math.abs(best.lines.length - body.length)) best = cur;
  }
  return { ...best!, notes: [...best!.notes, `ПРОВЕРКА ${label}: строк ${best!.lines.length} вместо ${body.length} (абзацы/пункты приложения) — сверить с ru вручную`] };
}

async function translateUnit(u: Unit, glossary: Record<string, string>): Promise<Item> {
  const parsed = parseTranscript(u.src.transcriptText);
  const lines: string[] = [];
  const notes: string[] = [];

  // Шапка: строка «Лекция N. …» строится по названию лекции версии, остальное (темы) переводится.
  const pre = textLines(parsed.preamble);
  const hasLectureLine = pre.length > 0 && LECTURE_LINE_RE.test(pre[0]!);
  if (hasLectureLine) lines.push(lectureLine(u.lang, u.tgt.number, u.tgt.title));
  const rest = hasLectureLine ? pre.slice(1) : pre;
  if (rest.length) {
    const r = await translateSection(u.code, { prefix: '', title: '' }, rest, u.lang, glossary);
    lines.push(...r.lines);
    notes.push(...r.notes);
  }

  for (const s of parsed.sections) {
    const body = textLines(s.body);
    const r = await translateSection(u.code, { prefix: s.headerPrefix, title: s.title }, body, u.lang, glossary);
    lines.push(`${s.headerPrefix}${sectionTitle(s.title, r.title, u.lang)}`.trimEnd());
    // Заголовки приложения — по ru-строке той же позиции (если число строк сошлось).
    const out = r.lines.map((line, i) => {
      const src = body[i];
      const h = src !== undefined && r.lines.length === body.length ? APPENDIX_HEADINGS.find((x) => x.re.test(src)) : undefined;
      return h ? sameCase(src!, h.to[u.lang]) : line;
    });
    lines.push(...out);
    notes.push(...r.notes);
    console.log(`   ${u.code} ${s.headerPrefix.trim()} · ${body.length} строк · ${s.body.trim().length} → ${out.join('\n').length} симв`);
  }

  const text = lines.join('\n');
  const timecodes = timecodeRanges(text);
  if (timecodes.join() !== timecodeRanges(u.src.transcriptText).join()) throw new Error(`${u.code}: таймкоды перевода не совпали с ru`);
  const ratio = text.length / u.src.transcriptText.length;
  if (ratio < 0.75 || ratio > 1.4) notes.push(`ПРОВЕРКА длина перевода ${round(ratio, 2)} от ru — проверить полноту`);
  return {
    code: u.code,
    lang: u.lang,
    lecture: u.tgt.number,
    module: u.tgt.moduleOrder,
    lectureOrder: u.tgt.lectureOrder,
    title: u.tgt.title,
    source: { code: lectureCode(SOURCE, u.src.number), title: u.src.title, sha256: sha256(u.src.transcriptText), chars: u.src.transcriptText.length },
    timecodes,
    durationSec: transcriptEndSeconds(text),
    lines,
    notes,
  };
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x);
    }),
  );
}

async function draft(args: ReturnType<typeof parseArgs>): Promise<number> {
  const course = await loadCourse();
  const ru = version(course, SOURCE);
  const only = (args.get('--only') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const units: Unit[] = [];
  const glossaries: Partial<Record<Target, Record<string, string>>> = {};
  for (const lang of args.langs.filter((l): l is Target => l !== SOURCE)) {
    const v = version(course, lang);
    for (const tgt of v.lectures) {
      const code = lectureCode(lang, tgt.number);
      if (only.length ? !only.includes(code) : tgt.transcriptText.trim()) continue;
      const src = lectureByPos(ru, tgt.moduleOrder, tgt.lectureOrder);
      if (!src?.transcriptText.trim()) {
        console.log(`· ${code}: нет ru-расшифровки на той же позиции — переводить не из чего`);
        continue;
      }
      if (tgt.transcriptText.trim()) console.log(`⚠ ${code}: расшифровка уже есть — переводится заново по --only (применение её не перезапишет без --force)`);
      units.push({ code, lang, tgt, src });
    }
    if (units.some((u) => u.lang === lang)) glossaries[lang] = buildGlossary(ru, v);
  }
  if (!units.length) {
    console.log('Переводить нечего: у лекций kk/en нет пустых расшифровок (или --only не совпал).');
    return 0;
  }
  console.log(`К переводу: ${units.map((u) => `${u.code} ← ${lectureCode(SOURCE, u.src.number)} (${u.src.transcriptText.length} симв)`).join(', ')}`);
  for (const [lang, g] of Object.entries(glossaries)) console.log(`Глоссарий ru → ${lang}: ${Object.keys(g).length} соответствий`);

  const items: Item[] = [];
  await pool(units, CONCURRENCY, async (u) => {
    console.log(`→ ${u.code} «${u.tgt.title}»`);
    items.push(await translateUnit(u, glossaries[u.lang]!));
  });
  items.sort((a, b) => a.lang.localeCompare(b.lang) || a.lecture - b.lecture);

  const art: Artifact = {
    meta: {
      version: 1,
      course: courseProfile().ruTitle,
      createdAt: new Date().toISOString(),
      model: 'gpt-5.4-mini (BE4 translateTranscript, mode translate)',
      effort: 'medium',
      sourceLanguage: SOURCE,
      glossaryEntries: Object.fromEntries(Object.entries(glossaries).map(([k, g]) => [k, Object.keys(g).length])),
      llm: getDraftUsage(),
    },
    items,
  };
  const path = writeArtifact(args.dataDir, ARTIFACT, art, { overwriteReviewed: args.has('--overwrite-reviewed') });
  recordSpend(args.dataDir, { script: SCRIPT, at: new Date().toISOString(), ...getDraftUsage() });
  console.log(`\nЧерновик: ${path}`);
  for (const it of items) {
    const checks = it.notes.filter((n) => n.startsWith('ПРОВЕРКА'));
    console.log(`\n── ${it.code} · ${it.lines.length} строк · ${it.lines.join('\n').length} симв · таймкодов ${it.timecodes.length} · ${fmt(it.durationSec)} · пометок ${it.notes.length}${checks.length ? ` (проверок ${checks.length})` : ''}`);
    for (const n of checks) console.log(`   ${n}`);
  }
  return 0;
}

/* ── Применение из артефакта (без LLM) ─────────────────────────── */

/** Целостность единицы артефакта после правок рецензента. */
function itemProblems(it: Item, text: string): string[] {
  const out: string[] = [];
  if (!text.trim()) out.push('пустой текст');
  if (timecodeRanges(text).join() !== it.timecodes.join()) out.push('таймкоды текста не совпадают с timecodes артефакта (сломан заголовок раздела?)');
  if (it.lines.some((l) => l.includes('\n'))) out.push('перевод строки внутри элемента lines');
  if (it.lang === 'en' && /[А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]/u.test(text)) out.push('кириллица в английском тексте');
  return out;
}

async function apply(args: ReturnType<typeof parseArgs>): Promise<number> {
  const art = readArtifact<Artifact>(args.from!);
  if (art.meta.course !== courseProfile().ruTitle) {
    fail(`Артефакт курса «${art.meta.course}», а запуск — для «${courseProfile().ruTitle}»: укажите --course "${art.meta.course}"`);
  }
  const report = new Report(SCRIPT, args.apply);
  const course = await loadCourse();
  const ru = version(course, SOURCE);

  for (const it of art.items.filter((x) => args.langs.includes(x.lang))) {
    const code = it.code;
    const v = version(course, it.lang);
    const l = lectureByPos(v, it.module, it.lectureOrder);
    if (!l) {
      report.line(code, 'error', 'лекция не найдена');
      continue;
    }
    const text = it.lines.join('\n');
    const problems = itemProblems(it, text);
    if (problems.length) {
      report.line(code, 'error', `артефакт: ${problems.join('; ')}`);
      continue;
    }
    const duration = transcriptEndSeconds(text);
    const src = lectureByPos(ru, it.module, it.lectureOrder);
    const warn = src && sha256(src.transcriptText) === it.source.sha256 ? '' : ' · ВНИМАНИЕ: ru-оригинал изменился после черновика';
    const key = ledgerKey(SCRIPT, code);
    const row = await ledgerGet(prisma, key);
    const prev = (row?.detail ?? null) as LedgerDetail | null;

    // Текст: в пустую расшифровку; в «нашу» (записанную скриптом и не правленную) — исправленный артефакт; иначе — только --force.
    let textWhy: string | null = null;
    if (l.transcriptText !== text) {
      if (!l.transcriptText.trim()) textWhy = 'пустая расшифровка';
      else if (prev && sha256(l.transcriptText) === prev.afterSha256) textWhy = 'артефакт исправлен после применения';
      else if (args.force) textWhy = 'ПРИНУДИТЕЛЬНО (--force): расшифровка уже заполнена';
      else {
        report.line(code, 'skip', prev ? 'расшифровку правили после применения — не трогаю без --force' : 'расшифровка уже есть (автор прислал или правка менеджера) — не трогаю без --force');
        continue;
      }
    }
    // Длительность: незаданная или записанная этим скриптом; заданную вручную — только --force.
    const durationOurs = l.durationSec === null || (prev !== null && l.durationSec === prev.durationSec);
    const setDuration = duration !== null && l.durationSec !== duration && (durationOurs || args.force);
    const durationNote = duration !== null && l.durationSec !== duration && !setDuration ? ` · длительность ${l.durationSec} с задана вручную — не трогаю (по таймкодам ${duration} с)` : '';
    if (!textWhy && !setDuration) {
      report.line(code, 'skip', `уже соответствует артефакту${durationNote}`);
      continue;
    }
    const summary = [
      textWhy ? `${textWhy}: ${it.lines.length} строк · таймкодов ${it.timecodes.length} · ${l.transcriptText.length}→${text.length} симв` : 'текст уже совпадает',
      setDuration ? `длительность ${fmt(l.durationSec)} → ${fmt(duration)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    if (!args.apply) {
      report.line(code, 'would-change', `${summary}${durationNote}${warn}`);
      continue;
    }
    const before = { text: l.transcriptText, durationSec: l.durationSec };
    const done = await prisma.$transaction(async (tx) => {
      const cur = await tx.lecture.findUniqueOrThrow({ where: { id: l.id }, select: { transcriptText: true, durationSec: true } });
      if (cur.transcriptText !== before.text || cur.durationSec !== before.durationSec) return false;
      await tx.lecture.update({
        where: { id: l.id },
        data: { ...(textWhy ? { transcriptText: text } : {}), ...(setDuration ? { durationSec: duration } : {}) },
      });
      const detail: LedgerDetail = {
        lectureId: l.id,
        afterSha256: sha256(textWhy ? text : before.text),
        durationSec: setDuration ? duration : before.durationSec,
      };
      if (!row) {
        await ledgerPut(tx, key, {
          ...detail,
          source: it.source.code,
          sourceSha256: it.source.sha256,
          ...(before.text.trim() ? { beforeSha256: sha256(before.text), forced: true } : {}),
        });
      } else {
        const revisions = [...(prev?.revisions ?? []), { at: new Date().toISOString(), beforeSha256: sha256(before.text), afterSha256: detail.afterSha256 }];
        const merged = { ...(row.detail as Record<string, unknown>), ...detail, revisions };
        await tx.contentMigration.update({ where: { key }, data: { detail: merged as Prisma.InputJsonValue } });
      }
      if (textWhy) {
        await flagForReview(tx, {
          reason: 'NATIVE_PROOFREAD',
          targetType: 'LECTURE',
          targetId: l.id,
          courseId: course.courseId,
          languageVersionId: v.id,
          comment:
            `Вычитка носителем: расшифровка ${code} — перевод ${it.source.code} через LLM (автор ${it.lang}-текста не прислал), ` +
            'вычитан редактором. Таймкоды разделов взяты из ru-расшифровки — сверить с видео этого языка (термины, имена, разбивку по разделам).',
          dedupeKey: `review:v1:NATIVE_PROOFREAD:${SCRIPT}:${l.id}`,
        });
      }
      return true;
    });
    report.line(code, done ? 'changed' : 'skip', done ? `${summary}${textWhy ? ' · отметка NATIVE_PROOFREAD' : ''}${durationNote}${warn}` : 'лекция изменилась во время работы — повторите');
  }
  console.log(`\n${report.summary()}`);
  return report.errors ? 1 : 0;
}

async function main(): Promise<number> {
  const args = parseArgs(SCRIPT, { llm: true });
  if (args.draft) return draft(args);
  if (!args.from) {
    console.log('Укажите --draft (черновик через LLM) или --from translations.v1.json (применение/предпросмотр).');
    return 2;
  }
  return apply(args);
}

run(main);
