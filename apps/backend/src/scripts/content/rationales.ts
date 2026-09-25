/**
 * Фаза 2f: обоснования вариантов («почему верно/неверно» — разбор после попытки и тренировка)
 * для КАЖДОГО неархивного вопроса курса без optionRationales (в основном старые мини-квизы).
 * draftRationales(quizId, {onlyMissing}) — формулировка, варианты и ключ НЕ меняются; заодно
 * уточняется источник (лекция и таймкод). Применение — writeRationales: он сам проверяет, что
 * вопрос не изменился со времени черновика; скрипт печатает сверку по каждому вопросу.
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/rationales.ts --draft
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/rationales.ts --from rationales.v1.json [--apply --i-have-a-backup] [--force]
 */
import type { Language } from '@edu/shared';
import { draftRationales, getDraftUsage, writeRationales } from '../../generation/drafts.js';
import {
  type LectureRef,
  type QuizLocator,
  Report,
  activeQuestions,
  courseQuestions,
  lectureIdOf,
  lectureRefOf,
  ledgerGet,
  ledgerKey,
  ledgerPut,
  loadCourse,
  locatorLabel,
  parseArgs,
  prisma,
  readArtifact,
  recordSpend,
  resolveQuiz,
  run,
  version,
  writeArtifact,
} from './lib.js';

const SCRIPT = 'rationales';
const ARTIFACT = 'rationales.v1.json';

interface Row {
  orderIndex: number;
  prompt: string;
  options: string[];
  correctOptionIds: number[];
  optionRationales: string[];
  source: LectureRef | null;
  sourceTimecode: string | null;
}

interface QuizRows {
  lang: Language;
  locator: QuizLocator;
  label: string;
  rows: Row[];
}

interface Artifact {
  meta: { version: 1; createdAt: string; llm: ReturnType<typeof getDraftUsage>; warnings: string[] };
  quizzes: QuizRows[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function draft(args: ReturnType<typeof parseArgs>): Promise<number> {
  const course = await loadCourse();
  const all = (await courseQuestions(prisma, course)).filter((x) => args.langs.includes(x.lang) && !x.q.optionRationales);
  const byQuiz = new Map<string, { lang: Language; locator: QuizLocator; ids: string[] }>();
  for (const x of all) {
    const e = byQuiz.get(x.quizId) ?? { lang: x.lang, locator: x.locator, ids: [] };
    e.ids.push(x.q.id);
    byQuiz.set(x.quizId, e);
  }
  console.log(`Вопросов без обоснований: ${all.length} в ${byQuiz.size} тестах`);
  const art: Artifact = { meta: { version: 1, createdAt: new Date().toISOString(), llm: getDraftUsage(), warnings: [] }, quizzes: [] };
  for (const [quizId, e] of byQuiz) {
    const v = version(course, e.lang);
    const label = locatorLabel(e.lang, e.locator);
    const rows = await draftRationales(quizId, { onlyMissing: true, onReport: (r) => art.meta.warnings.push(...r.warnings.map((w) => `${label}: ${w}`)) });
    const qs = await activeQuestions(prisma, quizId);
    const out: Row[] = rows.map((r) => ({
      orderIndex: qs.find((q) => q.id === r.questionId)!.orderIndex,
      prompt: r.prompt,
      options: r.options,
      correctOptionIds: r.correctOptionIds,
      optionRationales: r.optionRationales,
      source: lectureRefOf(v, r.sourceLectureId),
      sourceTimecode: r.sourceTimecode,
    }));
    const missing = e.ids.length - out.length;
    if (missing) art.meta.warnings.push(`${label}: обоснования не получены для ${missing} вопросов`);
    art.quizzes.push({ lang: e.lang, locator: e.locator, label, rows: out });
    console.log(`→ ${label}: ${out.length}/${e.ids.length}`);
  }
  art.meta.llm = getDraftUsage();
  const path = writeArtifact(args.dataDir, ARTIFACT, art);
  recordSpend(args.dataDir, { script: SCRIPT, at: new Date().toISOString(), ...getDraftUsage() });
  console.log(`\nЧерновик: ${path}`);
  for (const z of art.quizzes.slice(0, 3)) {
    for (const r of z.rows.slice(0, 1)) {
      console.log(`\n${z.label} #${r.orderIndex + 1} ${r.prompt}`);
      r.options.forEach((o, i) => console.log(`   ${r.correctOptionIds.includes(i) ? '*' : ' '} ${o} — ${r.optionRationales[i]}`));
    }
  }
  if (art.meta.warnings.length) console.log(`\nПредупреждения:\n   ${art.meta.warnings.join('\n   ')}`);
  return 0;
}

async function apply(args: ReturnType<typeof parseArgs>): Promise<number> {
  const art = readArtifact<Artifact>(args.from!);
  const report = new Report(SCRIPT, args.apply);
  const course = await loadCourse();
  let verified = 0;
  for (const z of art.quizzes.filter((x) => args.langs.includes(x.lang))) {
    const v = version(course, z.lang);
    const quizId = resolveQuiz(v, z.locator);
    const key = ledgerKey(SCRIPT, z.label);
    if (!quizId) {
      report.line(z.label, 'error', 'тест не найден');
      continue;
    }
    if ((await ledgerGet(prisma, key)) && !args.force) {
      report.line(z.label, 'skip', 'уже применено (журнал)');
      continue;
    }
    const qs = await activeQuestions(prisma, quizId);
    const rows = [];
    const skipped: string[] = [];
    for (const r of z.rows) {
      const q = qs.find((x) => x.orderIndex === r.orderIndex);
      if (!q) {
        skipped.push(`#${r.orderIndex + 1}: вопроса нет`);
        continue;
      }
      // Сверка: формулировка, варианты и ключ — те же, что в черновике.
      if (q.prompt !== r.prompt || !same(q.options, r.options) || !same(q.correctOptionIds, r.correctOptionIds)) {
        skipped.push(`#${r.orderIndex + 1}: вопрос отличается от черновика (иной стенд или правка)`);
        continue;
      }
      if (q.optionRationales && !args.force) {
        skipped.push(`#${r.orderIndex + 1}: обоснования уже есть`);
        continue;
      }
      rows.push({
        questionId: q.id,
        optionRationales: r.optionRationales,
        sourceLectureId: lectureIdOf(v, r.source),
        sourceTimecode: r.source ? r.sourceTimecode : null,
        prompt: r.prompt,
        options: r.options,
        correctOptionIds: r.correctOptionIds,
      });
    }
    if (!rows.length) {
      report.line(z.label, 'skip', skipped.join('; ') || 'нечего писать');
      continue;
    }
    if (!args.apply) {
      report.line(z.label, 'would-change', `обоснований ${rows.length}${skipped.length ? ` · пропуск: ${skipped.join('; ')}` : ''}`);
      continue;
    }
    const n = await writeRationales(rows);
    // Сверка после записи: формулировка, варианты и ключ не изменились.
    const after = await activeQuestions(prisma, quizId);
    for (const r of rows) {
      const a = after.find((x) => x.id === r.questionId)!;
      if (a.prompt !== r.prompt || !same(a.options, r.options) || !same(a.correctOptionIds, r.correctOptionIds) || a.optionRationales?.length !== a.options.length) {
        report.line(`${z.label}:${r.questionId}`, 'error', 'после записи вопрос не совпадает с черновиком');
      } else verified++;
    }
    if (!(await ledgerGet(prisma, key))) await ledgerPut(prisma, key, { written: n, skipped });
    report.line(z.label, 'changed', `обоснований ${n} · формулировка/варианты/ключ без изменений ✓${skipped.length ? ` · пропуск: ${skipped.join('; ')}` : ''}`);
  }
  if (args.apply) console.log(`\nСверка после записи: ${verified} вопросов — формулировка, варианты и ключ без изменений, обоснований по числу вариантов.`);
  console.log(`\n${report.summary()}`);
  return report.errors ? 1 : 0;
}

async function main(): Promise<number> {
  const args = parseArgs(SCRIPT, { llm: true });
  if (args.draft) return draft(args);
  if (!args.from) {
    console.log('Укажите --draft (черновик через LLM) или --from rationales.v1.json (применение/предпросмотр).');
    return 2;
  }
  return apply(args);
}

run(main);
