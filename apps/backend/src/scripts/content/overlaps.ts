/**
 * Фаза 2d (A11): оцениваемые вопросы не должны «утекать» в тренировку. Для каждого языка
 * НОВЫЕ формулировки оцениваемого банка сравниваются со всеми неархивными вопросами
 * мини-квизов (Жаккар > 0.35, для kk ещё триграммы > 0.5). Совпавшие тренировочные вопросы
 * заменяются (draftReplacementQuestions с doNotReuse = оцениваемые формулировки). Итоговый
 * мини-квиз курса здесь не трогается — его целиком пересоздаёт course-final.ts (2e).
 * Кроме того, по исправленным расшифровкам целиком пересоздаются мини-квизы kk L1, kk L7
 * и ru L2 (draftMiniQuiz с тем же числом вопросов). Правки рецензента после применения
 * (meta.textFixes) переносятся на уже пересозданные мини-квизы по точному «было → стало».
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/overlaps.ts --draft
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/overlaps.ts --from overlaps.v1.json [--apply --i-have-a-backup]
 */
import type { Language } from '@edu/shared';
import {
  draftMiniQuiz,
  draftReplacementQuestions,
  getDraftUsage,
  overlapsWith,
  replaceQuestions,
  writeQuizQuestions,
} from '../../generation/drafts.js';
import {
  type PortableQuestion,
  Report,
  type VersionCtx,
  activeQuestions,
  applyTextFixes,
  fromPortable,
  gradedModules,
  lectureByNumber,
  ledgerGet,
  ledgerKey,
  ledgerPut,
  loadCourse,
  markShuffled,
  parseArgs,
  prisma,
  readArtifact,
  recordSpend,
  round,
  run,
  toPortable,
  version,
  writeArtifact,
} from './lib.js';
import type { TextFix } from './revisions.js';

const SCRIPT = 'overlaps';
const ARTIFACT = 'overlaps.v1.json';
/** Мини-квизы, пересоздаваемые целиком по исправленным расшифровкам (2a, 1a). */
const WHOLE_MINIS: { lang: Language; lecture: number; reason: string }[] = [
  { lang: 'kk', lecture: 1, reason: 'расшифровка kk-01 исправлена (2a)' },
  { lang: 'kk', lecture: 7, reason: 'в расшифровку kk-07 добавлен раздел 3 (2a)' },
  { lang: 'ru', lecture: 2, reason: 'из расшифровки ru-02 убраны казахский хвост и реплики чата (1a)' },
];

const thresholdsFor = (lang: Language) => ({ jaccard: 0.35, trigram: lang === 'kk' ? 0.5 : null });

interface Replacement {
  lang: Language;
  lecture: number;
  orderIndex: number;
  expected: { prompt: string; options: string[]; correctOptionIds: number[] };
  overlap: { graded: string; jaccard: number; trigram: number };
  draft: PortableQuestion;
}

interface Artifact {
  meta: {
    version: 1;
    createdAt: string;
    llm: ReturnType<typeof getDraftUsage>;
    thresholds: string;
    warnings: string[];
    /** Правки рецензента (человекочитаемо). */
    reviewEdits?: string[];
    /** Те же правки для стендов, где мини-квизы уже пересозданы (lib.applyTextFixes). */
    textFixes?: TextFix[];
  };
  replacements: Replacement[];
  minis: { lang: Language; lecture: number; reason: string; count: number; items: PortableQuestion[] }[];
}

async function gradedPrompts(v: VersionCtx): Promise<string[]> {
  const out: string[] = [];
  for (const m of gradedModules(v)) out.push(...(await activeQuestions(prisma, m.quiz.id)).map((q) => q.prompt));
  return out;
}

async function draft(args: ReturnType<typeof parseArgs>): Promise<number> {
  const course = await loadCourse();
  const art: Artifact = {
    meta: { version: 1, createdAt: new Date().toISOString(), llm: getDraftUsage(), thresholds: 'Жаккар > 0.35; kk — ещё триграммы > 0.5', warnings: [] },
    replacements: [],
    minis: [],
  };
  for (const lang of args.langs) {
    const v = version(course, lang);
    const graded = await gradedPrompts(v);
    const whole = new Set(WHOLE_MINIS.filter((w) => w.lang === lang).map((w) => w.lecture));
    for (const l of v.lectures) {
      if (!l.miniQuiz) continue;
      const qs = await activeQuestions(prisma, l.miniQuiz.id);
      if (whole.has(l.number)) {
        const w = WHOLE_MINIS.find((x) => x.lang === lang && x.lecture === l.number)!;
        console.log(`→ ${lang} mini-${l.number}: пересоздание целиком (${qs.length} вопр.) — ${w.reason}`);
        const items = await draftMiniQuiz(l.id, { count: qs.length, doNotReuse: graded, onReport: (r) => art.meta.warnings.push(...r.warnings.map((x) => `${lang} mini-${l.number}: ${x}`)) });
        const left = items.map((d) => overlapsWith(d.prompt, graded, thresholdsFor(lang))).filter(Boolean).length;
        if (left) art.meta.warnings.push(`${lang} mini-${l.number}: после пересоздания пересечений ${left}`);
        art.minis.push({ lang, lecture: l.number, reason: w.reason, count: qs.length, items: items.map((d) => toPortable(v, d)) });
        continue;
      }
      const hits = qs
        .map((q) => ({ q, m: overlapsWith(q.prompt, graded, thresholdsFor(lang)) }))
        .filter((x): x is { q: (typeof qs)[number]; m: NonNullable<ReturnType<typeof overlapsWith>> } => !!x.m);
      if (!hits.length) continue;
      console.log(`→ ${lang} mini-${l.number}: пересечений ${hits.length} — черновики замен`);
      const map = await draftReplacementQuestions(l.miniQuiz.id, hits.map((h) => h.q.id), {
        doNotReuse: graded,
        onReport: (r) => art.meta.warnings.push(...r.warnings.map((x) => `${lang} mini-${l.number}: ${x}`)),
      });
      for (const h of hits) {
        const d = map.get(h.q.id);
        if (!d) {
          art.meta.warnings.push(`${lang} mini-${l.number} #${h.q.orderIndex + 1}: замена не получена`);
          continue;
        }
        const still = overlapsWith(d.prompt, graded, thresholdsFor(lang));
        if (still) art.meta.warnings.push(`${lang} mini-${l.number} #${h.q.orderIndex + 1}: замена всё ещё пересекается (J=${round(still.jaccard)})`);
        art.replacements.push({
          lang,
          lecture: l.number,
          orderIndex: h.q.orderIndex,
          expected: { prompt: h.q.prompt, options: h.q.options, correctOptionIds: h.q.correctOptionIds },
          overlap: { graded: h.m.text, jaccard: round(h.m.jaccard, 3), trigram: round(h.m.trigram, 3) },
          draft: toPortable(v, d),
        });
        console.log(`   #${h.q.orderIndex + 1} J=${round(h.m.jaccard)} T=${round(h.m.trigram)}\n      было:   ${h.q.prompt.slice(0, 120)}\n      тест:   ${h.m.text.slice(0, 120)}\n      замена: ${d.prompt.slice(0, 120)}`);
      }
    }
  }
  art.meta.llm = getDraftUsage();
  const path = writeArtifact(args.dataDir, ARTIFACT, art, { overwriteReviewed: args.has('--overwrite-reviewed') });
  recordSpend(args.dataDir, { script: SCRIPT, at: new Date().toISOString(), ...getDraftUsage() });
  console.log(`\nЧерновик: ${path} · замен ${art.replacements.length} · мини-квизов целиком ${art.minis.length}`);
  for (const m of art.minis) {
    console.log(`\n══ ${m.lang} mini-${m.lecture} ══`);
    for (const q of m.items) console.log(`   [${q.type}] ${q.prompt}\n      ${q.options.map((o, i) => `${q.correctOptionIds.includes(i) ? '*' : ' '}${o}`).join(' | ')}`);
  }
  if (art.meta.warnings.length) console.log(`\nПредупреждения:\n   ${art.meta.warnings.join('\n   ')}`);
  return 0;
}

async function apply(args: ReturnType<typeof parseArgs>): Promise<number> {
  const art = readArtifact<Artifact>(args.from!);
  const report = new Report(SCRIPT, args.apply);
  const course = await loadCourse();

  for (const m of art.minis.filter((x) => args.langs.includes(x.lang))) {
    const unit = `mini:${m.lang}-${String(m.lecture).padStart(2, '0')}`;
    const v = version(course, m.lang);
    const l = lectureByNumber(v, m.lecture);
    const key = ledgerKey(SCRIPT, unit);
    if (!l.miniQuiz) {
      report.line(unit, 'error', 'у лекции нет мини-квиза');
      continue;
    }
    if (await ledgerGet(prisma, key)) {
      report.line(unit, 'skip', 'уже применено (журнал)');
      continue;
    }
    const cur = await activeQuestions(prisma, l.miniQuiz.id);
    if (!args.apply) {
      report.line(unit, 'would-change', `архив ${cur.length} → новые ${m.items.length} (${m.reason})`);
      continue;
    }
    const ids = await writeQuizQuestions(l.miniQuiz.id, m.items.map((p) => fromPortable(v, p)), { mode: 'ARCHIVE_REPLACE', ledgerKey: key, ledgerDetail: { reason: m.reason } });
    await markShuffled(prisma, ids, SCRIPT);
    report.line(unit, ids.length ? 'changed' : 'skip', ids.length ? `архив ${cur.length} → новые ${ids.length}` : 'уже применено (журнал)');
  }

  for (const r of art.replacements.filter((x) => args.langs.includes(x.lang))) {
    const unit = `${r.lang}-mini-${String(r.lecture).padStart(2, '0')}#${r.orderIndex + 1}`;
    const key = ledgerKey(SCRIPT, unit);
    if (await ledgerGet(prisma, key)) {
      report.line(unit, 'skip', 'уже применено (журнал)');
      continue;
    }
    const v = version(course, r.lang);
    const l = lectureByNumber(v, r.lecture);
    const q = l.miniQuiz ? (await activeQuestions(prisma, l.miniQuiz.id)).find((x) => x.orderIndex === r.orderIndex) : undefined;
    if (!q || !l.miniQuiz) {
      report.line(unit, 'skip', 'вопроса нет (мини-квиз пересоздан или иной стенд)');
      continue;
    }
    if (q.prompt === r.draft.prompt.trim()) {
      report.line(unit, 'skip', 'замена уже на месте');
      continue;
    }
    if (q.prompt !== r.expected.prompt) {
      report.line(unit, 'skip', 'формулировка отличается от черновика (иной стенд или ручная правка) — не трогаю');
      continue;
    }
    if (!args.apply) {
      report.line(unit, 'would-change', `«${q.prompt.slice(0, 60)}» → «${r.draft.prompt.slice(0, 60)}»`);
      continue;
    }
    await replaceQuestions(l.miniQuiz.id, { [q.id]: fromPortable(v, r.draft) });
    await prisma.$transaction(async (tx) => {
      await ledgerPut(tx, key, { questionId: q.id, before: q.prompt, after: r.draft.prompt, overlap: r.overlap });
      await markShuffled(tx, [q.id], SCRIPT);
    });
    report.line(unit, 'changed', `«${r.draft.prompt.slice(0, 80)}»`);
  }
  // Правки рецензента после применения (meta.textFixes), напр. обоснования TRUE_FALSE.
  await applyTextFixes({ script: SCRIPT, fixes: art.meta.textFixes ?? [], course, langs: args.langs, apply: args.apply, force: args.force, report });
  console.log(`\n${report.summary()}`);
  return report.errors ? 1 : 0;
}

async function main(): Promise<number> {
  const args = parseArgs(SCRIPT, { llm: true });
  if (args.draft) return draft(args);
  if (!args.from) {
    console.log('Укажите --draft (черновик через LLM) или --from overlaps.v1.json (применение/предпросмотр).');
    return 2;
  }
  return apply(args);
}

run(main);
