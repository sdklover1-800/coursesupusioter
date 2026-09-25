/**
 * Фаза 1a: детерминированный ремонт расшифровок (без LLM). По каждой лекции:
 *  1) адресные ремонты по точным якорям (число попаданий проверяется):
 *     ru-02 — срез всего после настоящих контрольных вопросов (казахский «5-блок», дубль
 *     заключения, литературы и вопросов); kk-02 — сборка из ПЕРВОЙ казахской копии +
 *     казахское заключение (без русских блоков 4/5 и второй копии); ru-01 — черновой план
 *     блока 4 (полный текст остаётся); en-09 — пропущенный заголовок «[06:00–10:30] Section 2»;
 *  2) дубли: одинаковые разделы (en-06 §4, kk-07 §2, kk-02 блок 3) и соседние одинаковые
 *     абзацы (ru-12);
 *  3) реплики чат-ассистента / сессии перевода (en-01, en-02, ru-02, kk-02);
 *  4) нормализация заголовков-таймкодов («[00:00 –01 : 30 ]» → «[00:00–01:30]», kk-01);
 *  5) шапка до первого таймкода: служебные строки «Курс/Хронометраж/Формат/Runtime/Тіл…»
 *     и приклеенные к названию метаданные удаляются, СТРОКА НАЗВАНИЯ остаётся;
 *  6) хвосты «End of Lecture N» + повтор названия;
 *  7) «предложение на строку» (en-04, kk-04, kk-03, en-06..09, kk-07..09) → абзацы: склейка
 *     соседних строк раздела; заголовки, пункты списков и приложение не трогаются;
 *  8) отдельная единица `heading:<код>` (свой ключ журнала — применяется и там, где 1–7 уже
 *     прошли): русский заголовок «6-ЛЕКЦИЯ» / «10-ЛЕКЦИЯ» в первой строке kk-06 / kk-10 →
 *     «№6 ДӘРІС» / «№10 ДӘРІС», как в остальных kk-лекциях; нет такой строки — пропуск (иной стенд).
 * Инвариант: число непробельных символов не меняется, кроме удалённых строк (они в отчёте
 * и в журнале; удалённые метаданные шапки читает backfill-durations.ts).
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/fix-transcripts.ts [--lang ru,kk,en] [--only en-01,kk-02] [--apply --i-have-a-backup]
 */
import type { Language } from '@edu/shared';
import {
  type LectureCtx,
  APPENDIX_START_RE,
  COURSE_NAME_LINE_RE,
  END_TRAILER_RE,
  INLINE_META_RE,
  Report,
  isChatArtifact,
  isMetaLine,
  isSentencePerLine,
  isTimecodeLine,
  lectureCode,
  ledgerGet,
  ledgerKey,
  ledgerPut,
  loadCourse,
  nonWs,
  normalizeTimecodeLine,
  parseArgs,
  prisma,
  run,
  sha256,
  timecodeRanges,
  writePreview,
} from './lib.js';
import { replaceFirstLine } from './revisions.js';

const SCRIPT = 'fix-transcripts';

interface Removed {
  what: string;
  text: string;
}

interface Result {
  text: string;
  removed: Removed[];
  inserted: string[];
  ops: string[];
  /** Удалённые служебные строки шапки (для backfill-durations). */
  removedMeta: string[];
  merged: { linesBefore: number; linesAfter: number } | null;
}

/** Ожидаемые адресные ремонты (защита от «тихого» промаха якоря на другом стенде). */
const EXPECTED: Record<string, Record<string, number>> = {
  'en-01': { chat: 10 },
  'en-02': { chat: 1 },
  'ru-02': { 'trim-tail': 1 },
  'kk-02': { rebuild: 1, 'duplicate-section': 1 },
  'ru-01': { 'draft-block': 1 },
  'en-06': { 'duplicate-section': 1 },
  'kk-07': { 'duplicate-section': 1 },
  'ru-12': { 'duplicate-paragraph': 1 },
  'en-09': { 'insert-header': 1 },
};

/** Русский заголовок первой строки kk-расшифровки (виден в плеере) → «№N ДӘРІС», как в kk-03/kk-04/kk-07. */
const HEADING_FIXES: Record<string, { from: string; to: string }> = {
  'kk-06': { from: '6-ЛЕКЦИЯ', to: '№6 ДӘРІС' },
  'kk-10': { from: '10-ЛЕКЦИЯ', to: '№10 ДӘРІС' },
};

/** Дополнительные строки-«вложения» чата, не пойманные общими шаблонами (имя файла документа). */
const EXTRA_CHAT_LINES: Record<string, string[]> = {
  'en-01': ['Lecture 1 political science as a discipline'],
};

const indexesOf = (lines: string[], pred: (l: string) => boolean) => lines.flatMap((l, i) => (pred(l) ? [i] : []));

function expectCount(where: string, what: string, n: number, expected: number): void {
  if (n !== expected) throw new Error(`${where}: ${what} — найдено ${n}, ожидалось ${expected}`);
}

/* ── Адресные ремонты ─────────────────────────────────────────────── */

function trimRu02(lines: string[], r: Result, code: string): string[] {
  const idx = indexesOf(lines, (l) => /^\s*ЛЕКЦИЯ\s*№\s*2\s*-\s*казақша/.test(l));
  expectCount(code, 'якорь «ЛЕКЦИЯ № 2 - казақша»', idx.length, 1);
  const last = lines.slice(0, idx[0]).filter((l) => l.trim()).pop() ?? '';
  if (!/Монтескь[её].*актуален до сих пор\?\s*$/.test(last)) throw new Error(`${code}: перед срезом нет последнего контрольного вопроса`);
  const cut = lines.slice(idx[0]!);
  r.removed.push({ what: 'trim-tail', text: cut.join('\n') });
  r.ops.push(`trim-tail: −${cut.length} строк (казахский 5-блок, реплики чата, дубль заключения/литературы/вопросов)`);
  return lines.slice(0, idx[0]!);
}

function rebuildKk02(lines: string[], r: Result, code: string): string[] {
  const ruBlock4 = indexesOf(lines, (l) => /^\s*\[13:30[–—-]17:30\]\s*Блок 4\. Монтескьё/.test(l));
  const kkConclusion = indexesOf(lines, (l) => /^\s*\[19:00[–—-]20:00\]\s*Қорытынды/.test(l));
  const intro = indexesOf(lines, (l) => /^\s*\[00:00[–—-]01:30\]\s*Кіріспе/.test(l));
  expectCount(code, 'русский «Блок 4. Монтескьё»', ruBlock4.length, 1);
  expectCount(code, 'казахское заключение', kkConclusion.length, 1);
  expectCount(code, 'заголовок «Кіріспе» (две копии)', intro.length, 2);
  if (!(ruBlock4[0]! < intro[1]! && intro[1]! < kkConclusion[0]!)) throw new Error(`${code}: неожиданный порядок копий`);
  const cut = lines.slice(ruBlock4[0]!, kkConclusion[0]!);
  r.removed.push({ what: 'rebuild', text: cut.join('\n') });
  r.ops.push(`rebuild: −${cut.length} строк (русские блоки 4/5, реплики чата, вторая копия лекции)`);
  return [...lines.slice(0, ruBlock4[0]!), ...lines.slice(kkConclusion[0]!)];
}

function dropDraftRu01(lines: string[], r: Result, code: string): string[] {
  const h = indexesOf(lines, (l) => /^\s*\[12:30[–—-]17:00\]\s*Блок 4\. Методы политологического исследования/.test(l));
  expectCount(code, 'заголовок блока 4', h.length, 2);
  const cut = lines.slice(h[0]!, h[1]!);
  r.removed.push({ what: 'draft-block', text: cut.join('\n') });
  r.ops.push(`draft-block: −${cut.length} строк (черновой план блока 4; полный текст оставлен)`);
  return [...lines.slice(0, h[0]!), ...lines.slice(h[1]!)];
}

const EN09_HEADER = "[06:00–10:30] Section 2. Maurice Duverger's Typology of Parties";

function insertEn09Header(lines: string[], r: Result, code: string): string[] {
  if (lines.some((l) => /^\s*\[06:00[–—-]10:30\]/.test(l))) return lines;
  const at = indexesOf(lines, (l) => l.startsWith('The French political scientist Maurice Duverger, already familiar to us'));
  expectCount(code, 'якорь начала раздела 2 (Duverger)', at.length, 1);
  r.inserted.push(EN09_HEADER);
  r.ops.push(`insert-header: «${EN09_HEADER}» (название — по ru/kk «Типология партий Мориса Дюверже»)`);
  return [...lines.slice(0, at[0]!), EN09_HEADER, ...lines.slice(at[0]!)];
}

/* ── Дубли ────────────────────────────────────────────────────────── */

/** Разделы (заголовок + тело), полностью совпадающие с более ранним разделом, удаляются. */
function dropDuplicateSections(lines: string[], r: Result): string[] {
  const starts = indexesOf(lines, isTimecodeLine);
  const seen = new Set<string>();
  const drop = new Set<number>();
  starts.forEach((s, k) => {
    const end = starts[k + 1] ?? lines.length;
    // Последний раздел содержит приложение — сравниваем только до него.
    const block = lines.slice(s, end).join('\n').trim();
    if (seen.has(block)) {
      for (let i = s; i < end; i++) drop.add(i);
      r.removed.push({ what: 'duplicate-section', text: lines.slice(s, end).join('\n') });
      r.ops.push(`duplicate-section: −${end - s} строк («${lines[s]!.trim().slice(0, 60)}»)`);
    } else seen.add(block);
  });
  return lines.filter((_, i) => !drop.has(i));
}

/** Соседние одинаковые абзацы (≥ 60 символов) — второй удаляется. */
function dropAdjacentDuplicates(lines: string[], r: Result): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined && l.trim().length >= 60 && l.trim() === prev.trim()) {
      r.removed.push({ what: 'duplicate-paragraph', text: l });
      r.ops.push(`duplicate-paragraph: «${l.trim().slice(0, 60)}…»`);
      continue;
    }
    out.push(l);
  }
  return out;
}

/* ── Чат, таймкоды, шапка, хвосты ─────────────────────────────────── */

function dropChat(lines: string[], r: Result, code: string): string[] {
  const extra = new Set(EXTRA_CHAT_LINES[code] ?? []);
  return lines.filter((l) => {
    if (isChatArtifact(l) || extra.has(l.trim())) {
      r.removed.push({ what: 'chat', text: l });
      return false;
    }
    return true;
  });
}

function normalizeHeaders(lines: string[], r: Result): string[] {
  let n = 0;
  const out = lines.map((l) => {
    if (!isTimecodeLine(l)) return l;
    const norm = normalizeTimecodeLine(l);
    if (norm !== l) n++;
    return norm;
  });
  if (n) r.ops.push(`timecodes: нормализовано заголовков ${n}`);
  return out;
}

/** «LECTURE No. 1Lecture 1. …», «Раздел III. … Лекция 8. …» → название отдельной строкой. */
const GLUED_TITLE_RE = /(?<=\S)\s*(?=(?:Lecture|Лекция|Дәріс)\s+\d+\s*[.:(])|(?<=[^\s\d])\s*(?=\d+-дәріс\.)/gu;

function cleanPreamble(lines: string[], r: Result): string[] {
  const first = lines.findIndex(isTimecodeLine);
  if (first <= 0) return lines;
  const pre: string[] = [];
  for (const raw of lines.slice(0, first)) {
    for (const part of raw.split(GLUED_TITLE_RE).map((x) => x.trim()).filter(Boolean)) {
      let line = part;
      const m = INLINE_META_RE.exec(line);
      if (m && m.index > 0) {
        const tail = line.slice(m.index).trim();
        r.removed.push({ what: 'meta', text: tail });
        r.removedMeta.push(tail);
        line = line.slice(0, m.index).replace(/[\s,;–—-]+$/u, '').trim();
      }
      if (isMetaLine(line)) {
        r.removed.push({ what: 'meta', text: line });
        r.removedMeta.push(line);
        continue;
      }
      if (line) pre.push(line);
    }
  }
  const metaCount = r.removed.filter((x) => x.what === 'meta').length;
  if (metaCount) r.ops.push(`meta: удалено служебных строк/хвостов шапки ${metaCount}`);
  return [...pre, ...lines.slice(first)];
}

function dropTrailers(lines: string[], r: Result): string[] {
  const nonEmpty = indexesOf(lines, (l) => !!l.trim());
  const tail = nonEmpty.slice(-3);
  const endAt = tail.find((i) => END_TRAILER_RE.test(lines[i]!));
  let cutFrom: number | undefined;
  if (endAt !== undefined && lines.slice(endAt + 1).every((l) => l.trim().length < 150)) cutFrom = endAt;
  else if (tail.length && COURSE_NAME_LINE_RE.test(lines[tail[tail.length - 1]!]!)) cutFrom = tail[tail.length - 1];
  if (cutFrom === undefined) return lines;
  const cut = lines.slice(cutFrom).filter((l) => l.trim());
  r.removed.push(...cut.map((text) => ({ what: 'trailer', text })));
  r.ops.push(`trailer: −${cut.length} («${cut[0]!.trim().slice(0, 40)}»)`);
  return lines.slice(0, cutFrom);
}

/* ── Абзацы ───────────────────────────────────────────────────────── */

const LIST_ITEM_RE = /^\s*(?:[•●▪◦∙·*]|[-–—](?=\s)|\d+[.)]\s)/u;
const TERMINAL_RE = /[.!?…][»"”’)\]]*$/u;
const CONTINUES_RE = /[.!?…:;,][»"”’)\]]*$/u;
const PARAGRAPH_TARGET = 450;

/** Подзаголовок: короткая строка без знака конца/продолжения, дальше — не продолжение предложения. */
function isHeading(line: string, next: string | undefined): boolean {
  if (next === undefined) return false;
  if (line.length > 100 || CONTINUES_RE.test(line)) return false;
  if (line.split(/\s+/).length > 12) return false;
  if (!/^[\p{Lu}\d«"“]/u.test(line)) return false;
  if (/^\p{Ll}/u.test(next.trim())) return false;
  return true;
}

/** Склейка «одно предложение — одна строка» в абзацы ~450+ символов; шапка и приложение — как есть. */
function mergeParagraphs(lines: string[], r: Result): string[] {
  const first = lines.findIndex(isTimecodeLine);
  const tcIdx = indexesOf(lines, isTimecodeLine);
  const lastTc = tcIdx[tcIdx.length - 1] ?? -1;
  const appendixRel = lines.slice(lastTc + 1).findIndex((l) => APPENDIX_START_RE.test(l));
  const appendix = appendixRel === -1 ? lines.length : lastTc + 1 + appendixRel;
  const out: string[] = lines.slice(0, Math.max(0, first));
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(para.join(' '));
    para = [];
  };
  for (let i = Math.max(0, first); i < appendix; i++) {
    const line = lines[i]!.trim();
    if (!line) {
      flush();
      continue;
    }
    const next = lines.slice(i + 1, appendix).find((l) => l.trim());
    if (isTimecodeLine(line) || LIST_ITEM_RE.test(line) || isHeading(line, next)) {
      flush();
      out.push(line);
      continue;
    }
    para.push(line);
    if (para.join(' ').length >= PARAGRAPH_TARGET && TERMINAL_RE.test(line)) flush();
  }
  flush();
  out.push(...lines.slice(appendix));
  r.merged = { linesBefore: lines.filter((l) => l.trim()).length, linesAfter: out.filter((l) => l.trim()).length };
  r.ops.push(`paragraphs: строк ${r.merged.linesBefore} → ${r.merged.linesAfter}`);
  return out;
}

/* ── Конвейер ─────────────────────────────────────────────────────── */

function repairTranscript(code: string, text: string): Result {
  const r: Result = { text, removed: [], inserted: [], ops: [], removedMeta: [], merged: null };
  let lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/u, ''));
  lines = lines.filter((l) => l.trim());
  if (code === 'ru-02') lines = trimRu02(lines, r, code);
  if (code === 'kk-02') lines = rebuildKk02(lines, r, code);
  if (code === 'ru-01') lines = dropDraftRu01(lines, r, code);
  lines = dropChat(lines, r, code);
  const chat = r.removed.filter((x) => x.what === 'chat').length;
  if (chat) r.ops.push(`chat: −${chat} строк`);
  lines = dropDuplicateSections(lines, r);
  lines = dropAdjacentDuplicates(lines, r);
  if (code === 'en-09') lines = insertEn09Header(lines, r, code);
  lines = normalizeHeaders(lines, r);
  lines = cleanPreamble(lines, r);
  lines = dropTrailers(lines, r);
  if (isSentencePerLine(lines.join('\n'))) lines = mergeParagraphs(lines, r);
  r.text = lines.join('\n').trim();

  // Инвариант: непробельные символы = было − удалено + вставлено.
  const expected = nonWs(text) - r.removed.reduce((a, x) => a + nonWs(x.text), 0) + r.inserted.reduce((a, x) => a + nonWs(x), 0);
  if (nonWs(r.text) !== expected) throw new Error(`${code}: инвариант непробельных символов нарушен (${nonWs(r.text)} ≠ ${expected})`);
  // Ожидаемые адресные ремонты.
  for (const [what, n] of Object.entries(EXPECTED[code] ?? {})) {
    const got = what === 'insert-header' ? r.inserted.length : r.removed.filter((x) => x.what === what).length;
    expectCount(code, what, got, n);
  }
  return r;
}

async function headingUnit(l: LectureCtx, code: string, pending: string | undefined, apply: boolean, report: Report, preview: unknown[]): Promise<void> {
  const fix = HEADING_FIXES[code]!;
  const unit = `heading:${code}`;
  const key = ledgerKey(SCRIPT, unit);
  if (await ledgerGet(prisma, key)) {
    report.line(unit, 'skip', 'уже применено (журнал)');
    return;
  }
  const cur = pending ?? (await prisma.lecture.findUniqueOrThrow({ where: { id: l.id }, select: { transcriptText: true } })).transcriptText;
  const r = replaceFirstLine(cur, fix);
  if (r.status !== 'apply') {
    report.line(unit, 'skip', r.status === 'already' ? 'уже исправлено' : `первая строка «${r.first.slice(0, 40)}» — русского заголовка нет (иной стенд)`);
    return;
  }
  const summary = `«${fix.from}» → «${fix.to}»`;
  preview.push({ code: unit, ops: [summary] });
  if (!apply) {
    report.line(unit, 'would-change', summary);
    return;
  }
  const beforeSha = sha256(cur);
  const done = await prisma.$transaction(async (tx) => {
    const row = await tx.lecture.findUniqueOrThrow({ where: { id: l.id }, select: { transcriptText: true } });
    if (sha256(row.transcriptText) !== beforeSha || (await ledgerGet(tx, key))) return false;
    await tx.lecture.update({ where: { id: l.id }, data: { transcriptText: r.text } });
    await ledgerPut(tx, key, { lecture: code, from: fix.from, to: fix.to, beforeSha256: beforeSha, afterSha256: sha256(r.text) });
    return true;
  });
  report.line(unit, done ? 'changed' : 'skip', done ? summary : 'расшифровка изменилась во время работы — повторите');
}

async function main(): Promise<number> {
  const args = parseArgs(SCRIPT);
  const only = args.get('--only')?.split(',').map((s) => s.trim());
  const report = new Report(SCRIPT, args.apply);
  const course = await loadCourse();
  const preview: unknown[] = [];
  /** Предпросмотр: текст после ремонта 1–7 (ещё не записан) — от него считается шаг 8. */
  const pendingText = new Map<string, string>();

  for (const lang of args.langs) {
    const v = course.versions[lang as Language];
    if (!v) continue;
    for (const l of v.lectures) {
      const code = lectureCode(lang, l.number);
      if (only && !only.includes(code)) continue;
      const key = ledgerKey(SCRIPT, code);
      if (await ledgerGet(prisma, key)) {
        report.line(code, 'skip', 'уже применено (журнал)');
        continue;
      }
      let res: Result;
      try {
        res = repairTranscript(code, l.transcriptText);
      } catch (e) {
        report.line(code, 'error', (e as Error).message);
        continue;
      }
      if (res.text === l.transcriptText) {
        report.line(code, 'skip', 'изменений нет');
        continue;
      }
      const summary = `${res.ops.join(' · ')} · таймкодов ${timecodeRanges(res.text).length} · ${l.transcriptText.length}→${res.text.length} симв`;
      preview.push({ code, ops: res.ops, removed: res.removed, inserted: res.inserted, removedMeta: res.removedMeta, after: res.text });
      if (!args.apply) {
        pendingText.set(code, res.text);
        report.line(code, 'would-change', summary);
        for (const x of res.removed.filter((x) => x.what !== 'meta')) console.log(`      − [${x.what}] ${x.text.replace(/\n/g, ' ⏎ ').slice(0, 140)}`);
        continue;
      }
      const beforeSha = sha256(l.transcriptText);
      const done = await prisma.$transaction(async (tx) => {
        const cur = await tx.lecture.findUniqueOrThrow({ where: { id: l.id }, select: { transcriptText: true } });
        if (sha256(cur.transcriptText) !== beforeSha || (await ledgerGet(tx, key))) return false;
        await tx.lecture.update({ where: { id: l.id }, data: { transcriptText: res.text } });
        await ledgerPut(tx, key, {
          lecture: code,
          ops: res.ops,
          removed: res.removed,
          inserted: res.inserted,
          removedMeta: res.removedMeta,
          beforeSha256: beforeSha,
          afterSha256: sha256(res.text),
        });
        return true;
      });
      report.line(code, done ? 'changed' : 'skip', done ? summary : 'расшифровка изменилась во время работы — повторите');
    }
  }

  // Шаг 8: заголовок kk-06/kk-10 — отдельная единица (после 1–7 в этом же прогоне).
  for (const lang of args.langs) {
    for (const l of course.versions[lang as Language]?.lectures ?? []) {
      const code = lectureCode(lang, l.number);
      if (!HEADING_FIXES[code] || (only && !only.includes(code))) continue;
      await headingUnit(l, code, pendingText.get(code), args.apply, report, preview);
    }
  }
  console.log(`\n${report.summary()}`);
  if (!args.apply) console.log(`Предпросмотр: ${writePreview(args, preview)}`);
  return report.errors ? 1 : 0;
}

run(main);
