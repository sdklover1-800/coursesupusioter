/**
 * Фаза 2a (LLM, medium — llm_calibration_plan §B): казахские расшифровки.
 *  - kk-01 — КОРРЕКТУРА существующего казахского текста по разделам: это расшифровка
 *    казахского видео, поэтому текст правится «как сказано», а не переводится заново.
 *    translateTranscript(kkSection, 'kk', {mode:'correct', reference: ruSection, effort:'medium',
 *    glossary}); глоссарий собирается из kk-02..15 ↔ ru-02..15 (ключевые понятия, заголовки
 *    разделов, названия лекций). Разделы, где текст не восстановить (много русских вставок),
 *    получают mode 'translate' из ru — это отмечено в JSON. Таймкоды — байт-в-байт.
 *  - kk-07 — пропущенный раздел 3: перевод ru-07 «[10:30–15:00] Блок 3. Авторитаризм…»
 *    и вставка по порядку.
 * Черновик (--draft) пишет content-data/politology/kk-transcripts.v1.json (оригинал,
 * исправленный текст и пометки по каждому разделу); применение (--apply --from) пишет
 * лекции без LLM и ставит отметки NATIVE_PROOFREAD на kk L1 и L7.
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/kk-transcripts.ts --draft
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/kk-transcripts.ts --from kk-transcripts.v1.json [--apply --i-have-a-backup] [--force]
 */
import { getDraftUsage, parseTranscript, translateTranscript } from '../../generation/drafts.js';
import {
  type LectureCtx,
  Report,
  type VersionCtx,
  flagForReview,
  isTimecodeLine,
  lectureByNumber,
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

const SCRIPT = 'kk-transcripts';
const ARTIFACT = 'kk-transcripts.v1.json';
/** Доля русских служебных слов в разделе, выше которой раздел переводится из ru, а не правится. */
const TRANSLATE_THRESHOLD = 0.08;
const RU_STOP = new Set(
  'и в на что это как который которая которые также является для не по из от или но если чтобы при так его их она они был была были быть только уже где когда между через вы мы с к о об за до могут'.split(' '),
);

interface SectionDraft {
  index: number;
  /** Строка заголовка раздела в kk-01 (таймкод + заголовок). */
  header: string;
  mode: 'correct' | 'translate';
  russianRatio: number;
  original: string;
  corrected: string;
  notes: string[];
  /** Раздел обрабатывался частями (ответ модели не уместился целиком). */
  chunks?: number;
}

interface Artifact {
  meta: { version: 1; createdAt: string; model: string; effort: 'medium'; glossaryEntries: number; llm: ReturnType<typeof getDraftUsage> };
  kk01: {
    lecture: number;
    module: number;
    lectureOrder: number;
    title: string;
    /** sha256 расшифровки kk-01 на момент черновика (после фазы 1). */
    sourceSha256: string;
    preamble: string;
    sections: SectionDraft[];
    text: string;
  };
  kk07: {
    lecture: number;
    module: number;
    lectureOrder: number;
    /** Вставить ПЕРЕД заголовком с этим таймкодом. */
    insertBefore: string;
    source: string;
    section: string;
    notes: string[];
  };
}

/* ── Глоссарий ru → kk из параллельных лекций 2–15 ─────────────── */

const splitList = (s: string) => {
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
};

const CONCEPTS_RE = /^\s*(?:Ключевые понятия|Негізгі ұғымдар)\s*:?\s*(.*)$/u;
const NEXT_HEAD_RE = /^\s*(?:Рекомендуемая литература|Ұсынылатын әдебиет|Литература|Әдебиет|Контрольные вопросы|Вопросы для|Бақылау сұрақтары|Дәріс)/u;

function concepts(text: string): string[] {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => CONCEPTS_RE.test(l));
  if (i === -1) return [];
  const inline = CONCEPTS_RE.exec(lines[i]!)![1]!.trim();
  if (inline) return splitList(inline);
  const out: string[] = [];
  for (const l of lines.slice(i + 1, i + 40)) {
    if (!l.trim() || NEXT_HEAD_RE.test(l)) break;
    out.push(...splitList(l));
  }
  return out;
}

const headingOf = (title: string) =>
  title
    .replace(/^(?:Блок|Раздел|Section)\s*\d+\s*[.:]\s*/u, '')
    .replace(/^\d+\s*-\s*(?:блок|бөлім)\s*[.:]\s*/u, '')
    .trim();

function buildGlossary(ru: VersionCtx, kk: VersionCtx): Record<string, string> {
  const g: Record<string, string> = {};
  for (let n = 2; n <= 15; n++) {
    const r = ru.lectures.find((l) => l.number === n);
    const k = kk.lectures.find((l) => l.number === n);
    if (!r || !k) continue;
    const rc = concepts(r.transcriptText);
    const kc = concepts(k.transcriptText);
    if (rc.length && rc.length === kc.length) rc.forEach((t, i) => (g[t] = kc[i]!));
    const rs = parseTranscript(r.transcriptText).sections;
    const ks = parseTranscript(k.transcriptText).sections;
    if (rs.length === ks.length) rs.forEach((s, i) => {
      const a = headingOf(s.title);
      const b = headingOf(ks[i]!.title);
      if (a && b && a.length < 90) g[a] = b;
    });
    g[r.title.replace(/^\d+\.\s*/, '')] = k.title.replace(/^\d+\.\s*/, '');
  }
  return g;
}

/* ── Черновик ───────────────────────────────────────────────────── */

function russianRatio(text: string): number {
  const words = text.toLowerCase().match(/[а-яёәғқңөұүһі]+/gu) ?? [];
  return words.length ? words.filter((w) => RU_STOP.has(w)).length / words.length : 0;
}

/** Делит текст на части по границам предложений (~ равные). */
function splitSentences(text: string, parts: number): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]+[»")]*\s*|[^.!?…]+$/gu) ?? [text];
  const target = text.length / parts;
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    cur += s;
    if (cur.length >= target && out.length < parts - 1) {
      out.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Один раздел через BE4 translateTranscript. Если ответ не уместился (UPSTREAM), текст
 * раздела делится на части по предложениям и правится по частям (с тем же reference).
 */
async function processSection(
  header: string,
  body: string,
  mode: 'correct' | 'translate',
  ref: string,
  glossary: Record<string, string>,
): Promise<{ title: string; text: string; notes: string[]; chunks?: number }> {
  const src = mode === 'correct' ? `${header}\n${body}` : ref;
  try {
    const r = await translateTranscript(src, 'kk', {
      mode,
      effort: 'medium',
      glossary,
      sourceLanguage: 'ru',
      ...(mode === 'correct' ? { reference: ref } : {}),
    });
    const [first, ...rest] = r.text.split('\n');
    return { title: first!, text: rest.join('\n').trim(), notes: r.notes };
  } catch (e) {
    console.log(`   ⚠ ${header.slice(0, 20)}: ${(e as Error).message} — повтор по частям`);
    const pieces = splitSentences(mode === 'correct' ? body : ref.split('\n').slice(1).join('\n'), 2);
    const texts: string[] = [];
    const notes: string[] = [];
    for (const p of pieces) {
      const r = await translateTranscript(p, 'kk', {
        mode,
        effort: 'medium',
        glossary,
        sourceLanguage: 'ru',
        ...(mode === 'correct' ? { reference: ref } : {}),
      });
      texts.push(r.text.trim());
      notes.push(...r.notes);
    }
    // Заголовок раздела — отдельным коротким вызовом не правим: оставляем исходный (проверит носитель).
    return { title: header, text: texts.join(' '), notes: [...notes, `ПРОВЕРКА раздел обработан по частям (${pieces.length}); заголовок оставлен как в исходнике`], chunks: pieces.length };
  }
}

async function draft(args: ReturnType<typeof parseArgs>): Promise<number> {
  const course = await loadCourse();
  const ru = version(course, 'ru');
  const kk = version(course, 'kk');
  const glossary = buildGlossary(ru, kk);
  console.log(`Глоссарий: ${Object.keys(glossary).length} соответствий (kk-02..15)`);

  /* kk-01 */
  const k1 = lectureByNumber(kk, 1);
  const r1 = lectureByNumber(ru, 1);
  const kp = parseTranscript(k1.transcriptText);
  const rp = parseTranscript(r1.transcriptText);
  if (kp.sections.length !== rp.sections.length) throw new Error(`kk-01: разделов ${kp.sections.length}, в ru-01 ${rp.sections.length} — сначала fix-transcripts`);
  const sections: SectionDraft[] = [];
  for (const [i, s] of kp.sections.entries()) {
    const header = `${s.headerPrefix}${s.title}`.trimEnd();
    const rs = rp.sections[i]!;
    const ref = `${rs.headerPrefix}${rs.title}`.trimEnd() + '\n' + rs.body.trim();
    const ratio = russianRatio(s.body);
    const mode: SectionDraft['mode'] = ratio > TRANSLATE_THRESHOLD ? 'translate' : 'correct';
    console.log(`→ kk-01 раздел ${i + 1} ${s.headerPrefix.trim()} · русских служебных слов ${round(ratio, 3)} · ${mode}`);
    const out = await processSection(header, s.body.trim(), mode, ref, glossary);
    // Префикс таймкода — байт-в-байт из kk-01 (перевод из ru даёт тот же префикс, но берём свой).
    const title = out.title.startsWith(s.headerPrefix) ? out.title : `${s.headerPrefix}${out.title.replace(/^\s*\[[^\]]*\]\s*/, '')}`;
    sections.push({ index: i, header: title, mode, russianRatio: round(ratio, 3), original: `${header}\n${s.body.trim()}`, corrected: `${title}\n${out.text}`, notes: out.notes, ...(out.chunks ? { chunks: out.chunks } : {}) });
    console.log(`   ${out.notes.length} пометок · ${s.body.trim().length} → ${out.text.length} симв`);
  }
  const preamble = kp.preamble.trim();
  const text = [preamble, ...sections.map((s) => s.corrected)].filter(Boolean).join('\n');
  if (timecodeRanges(text).join() !== timecodeRanges(k1.transcriptText).join()) throw new Error('kk-01: таймкоды после корректуры не совпадают с исходными');

  /* kk-07 — раздел 3 из ru-07 */
  const k7 = lectureByNumber(kk, 7);
  const r7 = lectureByNumber(ru, 7);
  const rs3 = parseTranscript(r7.transcriptText).sections.find((s) => s.headerPrefix.startsWith('[10:30–15:00]'));
  if (!rs3) throw new Error('ru-07: нет раздела [10:30–15:00]');
  const src3 = `${rs3.headerPrefix}${rs3.title}`.trimEnd() + '\n' + rs3.body.trim();
  console.log(`→ kk-07 раздел 3 · перевод из ru-07 «${rs3.title}»`);
  const t3 = await translateTranscript(src3, 'kk', { mode: 'translate', effort: 'medium', glossary, sourceLanguage: 'ru' });
  // Заголовок в стиле kk-07: «3-бөлім. …».
  const [h3, ...b3] = t3.text.split('\n');
  const header3 = h3!.replace(/^(\[[^\]]*\]\s*)(?:(?:\d+\s*-\s*(?:блок|бөлім))|(?:Блок|Бөлім)\s*\d+)\s*[.:]?\s*/iu, '$13-бөлім. ');
  const section3 = [header3.includes('3-бөлім') ? header3 : `${rs3.headerPrefix}3-бөлім. ${h3!.replace(/^\s*\[[^\]]*\]\s*/, '')}`, b3.join('\n').trim()].join('\n');

  const artifact: Artifact = {
    meta: { version: 1, createdAt: new Date().toISOString(), model: 'gpt-5.4-mini (BE4 translateTranscript)', effort: 'medium', glossaryEntries: Object.keys(glossary).length, llm: getDraftUsage() },
    kk01: {
      lecture: 1,
      module: k1.moduleOrder,
      lectureOrder: k1.lectureOrder,
      title: k1.title,
      sourceSha256: sha256(k1.transcriptText),
      preamble,
      sections,
      text,
    },
    kk07: {
      lecture: 7,
      module: k7.moduleOrder,
      lectureOrder: k7.lectureOrder,
      insertBefore: '[15:00–18:30]',
      source: src3,
      section: section3,
      notes: t3.notes,
    },
  };
  const path = writeArtifact(args.dataDir, ARTIFACT, artifact, { overwriteReviewed: args.has('--overwrite-reviewed') });
  console.log(`\nЧерновик: ${path}`);
  recordSpend(args.dataDir, { script: SCRIPT, at: new Date().toISOString(), ...getDraftUsage() });
  // Читаемый предпросмотр: начало каждого раздела до/после.
  for (const s of sections) {
    console.log(`\n── ${s.header} [${s.mode}] ──\n   было:  ${s.original.split('\n').slice(1).join(' ').slice(0, 260)}\n   стало: ${s.corrected.split('\n').slice(1).join(' ').slice(0, 260)}`);
  }
  console.log(`\n── kk-07 ${section3.split('\n')[0]} ──\n   ${section3.split('\n').slice(1).join(' ').slice(0, 400)}`);
  return 0;
}

/* ── Применение из артефакта (без LLM) ─────────────────────────── */

async function apply(args: ReturnType<typeof parseArgs>): Promise<number> {
  const art = readArtifact<Artifact>(args.from!);
  const report = new Report(SCRIPT, args.apply);
  const course = await loadCourse();
  const kk = version(course, 'kk');

  const units: { code: string; lecture: LectureCtx; next: () => string | null; comment: string; detail: Record<string, unknown> }[] = [];

  // kk-01: полная замена текста исправленным.
  const k1 = kk.lectures.find((l) => l.moduleOrder === art.kk01.module && l.lectureOrder === art.kk01.lectureOrder);
  if (k1) {
    const translated = art.kk01.sections.filter((s) => s.mode === 'translate').map((s) => s.header.slice(0, 13));
    const corrected = art.kk01.sections.filter((s) => s.mode === 'correct').map((s) => s.header.slice(0, 13));
    units.push({
      code: lectureCode('kk', k1.number),
      lecture: k1,
      next: () => {
        if (k1.transcriptText === art.kk01.text) return null;
        if (sha256(k1.transcriptText) !== art.kk01.sourceSha256 && !args.force) {
          throw new Error('текст kk-01 отличается от того, по которому делался черновик (фаза 1 не применена или ручная правка) — нужен --force');
        }
        return art.kk01.text;
      },
      comment: `Вычитка носителем: kk-01 исправлен ИИ по разделам (корректура: ${corrected.join(', ') || '—'}; перевод из ru: ${translated.join(', ') || '—'}). Сверить с видео.`,
      detail: { sections: art.kk01.sections.map((s) => ({ header: s.header, mode: s.mode, notes: s.notes.length })) },
    });
  }
  // kk-07: вставка раздела 3 перед [15:00–18:30].
  const k7 = kk.lectures.find((l) => l.moduleOrder === art.kk07.module && l.lectureOrder === art.kk07.lectureOrder);
  if (k7) {
    units.push({
      code: lectureCode('kk', k7.number),
      lecture: k7,
      next: () => {
        if (k7.transcriptText.split('\n').some((l) => /^\s*\[10:30[–—-]15:00\]/.test(l))) return null;
        const lines = k7.transcriptText.split('\n');
        const at = lines.flatMap((l, i) => (l.startsWith(art.kk07.insertBefore) && isTimecodeLine(l) ? [i] : []));
        if (at.length !== 1) throw new Error(`якорь «${art.kk07.insertBefore}» найден ${at.length} раз(а), ожидался 1`);
        return [...lines.slice(0, at[0]!), ...art.kk07.section.split('\n'), ...lines.slice(at[0]!)].join('\n');
      },
      comment: 'Вычитка носителем: в kk-07 добавлен раздел 3 «Авторитаризм» — перевод ru-07 (в kk-видео раздел есть, в расшифровке пропал). Сверить с видео.',
      detail: { inserted: art.kk07.section.split('\n')[0] },
    });
  }

  for (const u of units) {
    const key = ledgerKey(SCRIPT, u.code);
    if (await ledgerGet(prisma, key)) {
      report.line(u.code, 'skip', 'уже применено (журнал)');
      continue;
    }
    let next: string | null;
    try {
      next = u.next();
    } catch (e) {
      report.line(u.code, 'error', (e as Error).message);
      continue;
    }
    if (next === null) {
      report.line(u.code, 'skip', 'текст уже соответствует артефакту');
      continue;
    }
    const summary = `таймкодов ${timecodeRanges(next).length} · ${u.lecture.transcriptText.length}→${next.length} симв`;
    if (!args.apply) {
      report.line(u.code, 'would-change', summary);
      continue;
    }
    const before = u.lecture.transcriptText;
    const done = await prisma.$transaction(async (tx) => {
      const cur = await tx.lecture.findUniqueOrThrow({ where: { id: u.lecture.id }, select: { transcriptText: true } });
      if (cur.transcriptText !== before || (await ledgerGet(tx, key))) return false;
      await tx.lecture.update({ where: { id: u.lecture.id }, data: { transcriptText: next! } });
      await flagForReview(tx, {
        reason: 'NATIVE_PROOFREAD',
        targetType: 'LECTURE',
        targetId: u.lecture.id,
        courseId: course.courseId,
        languageVersionId: kk.id,
        comment: u.comment,
        dedupeKey: `review:v1:NATIVE_PROOFREAD:${SCRIPT}:${u.lecture.id}`,
      });
      await ledgerPut(tx, key, { ...u.detail, beforeSha256: sha256(before), afterSha256: sha256(next!) });
      return true;
    });
    report.line(u.code, done ? 'changed' : 'skip', done ? `${summary} · отметка NATIVE_PROOFREAD` : 'расшифровка изменилась во время работы');
  }
  console.log(`\n${report.summary()}`);
  return report.errors ? 1 : 0;
}

async function main(): Promise<number> {
  const args = parseArgs(SCRIPT, { llm: true });
  if (args.draft) return draft(args);
  if (!args.from) {
    console.log('Укажите --draft (черновик через LLM) или --from kk-transcripts.v1.json (применение/предпросмотр).');
    return 2;
  }
  return apply(args);
}

run(main);
