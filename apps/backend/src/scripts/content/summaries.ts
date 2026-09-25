/**
 * Фаза 2g: краткие содержания лекций (вкладка «Кратко», строки программы в каталоге) —
 * 2–3 нейтральных предложения ≤ 400 символов на языке лекции (draftLectureSummary) для
 * лекций без summary. Применение пишет только пустые summary (правку менеджера не трогает
 * без --force); текст расшифровки на момент черновика фиксируется хешем (предупреждение,
 * если расшифровка изменилась).
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/summaries.ts --draft [--lang kk]
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/summaries.ts --from summaries.v1.json [--apply --i-have-a-backup] [--force]
 */
import type { Language } from '@edu/shared';
import { draftLectureSummary, getDraftUsage } from '../../generation/drafts.js';
import {
  type LectureCtx,
  Report,
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
  run,
  sha256,
  version,
  writeArtifact,
} from './lib.js';

const SCRIPT = 'summaries';
const ARTIFACT = 'summaries.v1.json';
const CONCURRENCY = 5;

interface Row {
  lang: Language;
  lecture: number;
  module: number;
  lectureOrder: number;
  title: string;
  transcriptSha256: string;
  summary: string;
}

interface Artifact {
  meta: { version: 1; createdAt: string; llm: ReturnType<typeof getDraftUsage>; warnings: string[] };
  rows: Row[];
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
  const todo: { lang: Language; l: LectureCtx }[] = [];
  for (const lang of args.langs) for (const l of version(course, lang).lectures) if (!l.summary?.trim() || args.force) todo.push({ lang, l });
  console.log(`Лекций без краткого содержания: ${todo.length}`);
  const art: Artifact = { meta: { version: 1, createdAt: new Date().toISOString(), llm: getDraftUsage(), warnings: [] }, rows: [] };
  await pool(todo, CONCURRENCY, async ({ lang, l }) => {
    const code = lectureCode(lang, l.number);
    const summary = await draftLectureSummary(l.id, { onReport: (r) => art.meta.warnings.push(...r.warnings.map((w) => `${code}: ${w}`)) });
    art.rows.push({ lang, lecture: l.number, module: l.moduleOrder, lectureOrder: l.lectureOrder, title: l.title, transcriptSha256: sha256(l.transcriptText), summary });
    console.log(`→ ${code} (${summary.length}) ${summary}`);
  });
  art.rows.sort((a, b) => a.lang.localeCompare(b.lang) || a.lecture - b.lecture);
  art.meta.llm = getDraftUsage();
  const path = writeArtifact(args.dataDir, ARTIFACT, art);
  recordSpend(args.dataDir, { script: SCRIPT, at: new Date().toISOString(), ...getDraftUsage() });
  console.log(`\nЧерновик: ${path}`);
  if (art.meta.warnings.length) console.log(`Предупреждения:\n   ${art.meta.warnings.join('\n   ')}`);
  return 0;
}

async function apply(args: ReturnType<typeof parseArgs>): Promise<number> {
  const art = readArtifact<Artifact>(args.from!);
  const report = new Report(SCRIPT, args.apply);
  const course = await loadCourse();
  for (const r of art.rows.filter((x) => args.langs.includes(x.lang))) {
    const code = lectureCode(r.lang, r.lecture);
    const l = lectureByPos(version(course, r.lang), r.module, r.lectureOrder);
    if (!l) {
      report.line(code, 'error', 'лекция не найдена');
      continue;
    }
    const key = ledgerKey(SCRIPT, code);
    if (l.summary === r.summary) {
      report.line(code, 'skip', 'уже совпадает');
      continue;
    }
    if (l.summary?.trim() && !args.force) {
      report.line(code, 'skip', 'краткое содержание уже задано (правка менеджера) — не трогаю без --force');
      continue;
    }
    const note = sha256(l.transcriptText) !== r.transcriptSha256 ? ' · ВНИМАНИЕ: расшифровка изменилась после черновика' : '';
    if (!args.apply) {
      report.line(code, 'would-change', `${r.summary.length} симв${note}`);
      continue;
    }
    const done = await prisma.$transaction(async (tx) => {
      const cur = await tx.lecture.findUniqueOrThrow({ where: { id: l.id }, select: { summary: true } });
      if (cur.summary !== l.summary) return false;
      await tx.lecture.update({ where: { id: l.id }, data: { summary: r.summary } });
      if (await ledgerGet(tx, key)) await tx.contentMigration.update({ where: { key }, data: { detail: { chars: r.summary.length, forced: true } } });
      else await ledgerPut(tx, key, { chars: r.summary.length, transcriptSha256: r.transcriptSha256 });
      return true;
    });
    report.line(code, done ? 'changed' : 'skip', done ? `${r.summary.length} симв${note}` : 'изменилось во время работы');
  }
  console.log(`\n${report.summary()}`);
  return report.errors ? 1 : 0;
}

async function main(): Promise<number> {
  const args = parseArgs(SCRIPT, { llm: true });
  if (args.draft) return draft(args);
  if (!args.from) {
    console.log('Укажите --draft (черновик через LLM) или --from summaries.v1.json (применение/предпросмотр).');
    return 2;
  }
  return apply(args);
}

run(main);
