/**
 * Фаза 2e: итоговый мини-квиз курса (тренировочный) — по одному вопросу на КАЖДУЮ
 * из 15 лекций, из её собственной расшифровки (draftCourseFinal: вызов на модуль;
 * старый единый промпт «залипал» на лекциях 1–2 и покрывал 1–3 лекции из 15).
 * doNotReuse — все неархивные формулировки оцениваемого банка версии (A11); после
 * применения аудит пересечений запускается снова (audit-content).
 *
 * Черновик (--draft): content-data/politology/course-final.v1.json {ru:[…], kk:[…], en:[…]}.
 * Применение (--from … [--apply --i-have-a-backup]): writeQuizQuestions(finalQuizId, items,
 * {mode: 'ARCHIVE_REPLACE'}) + локализованное название (localizedTitle('COURSE_FINAL')).
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/course-final.ts --draft
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/course-final.ts --from course-final.v1.json [--apply --i-have-a-backup]
 */
import type { Language } from '@edu/shared';
import { draftCourseFinal, getDraftUsage, gradedPromptsOfVersion, localizedTitle, overlapsWith, writeQuizQuestions } from '../../generation/drafts.js';
import {
  type PortableQuestion,
  Report,
  activeQuestions,
  fromPortable,
  ledgerGet,
  ledgerKey,
  loadCourse,
  markShuffled,
  parseArgs,
  prisma,
  readArtifact,
  recordSpend,
  run,
  toPortable,
  version,
  writeArtifact,
} from './lib.js';

const SCRIPT = 'course-final';
const ARTIFACT = 'course-final.v1.json';

type Artifact = { meta: { version: 1; createdAt: string; llm: ReturnType<typeof getDraftUsage>; warnings: string[]; coverage: Record<string, string> } } & Partial<Record<Language, PortableQuestion[]>>;

async function draft(args: ReturnType<typeof parseArgs>): Promise<number> {
  const course = await loadCourse();
  const art: Artifact = { meta: { version: 1, createdAt: new Date().toISOString(), llm: getDraftUsage(), warnings: [], coverage: {} } };
  for (const lang of args.langs) {
    const v = version(course, lang);
    const graded = await gradedPromptsOfVersion(v.id);
    console.log(`→ ${lang}: черновик итогового мини-квиза (doNotReuse: ${graded.length} оцениваемых)`);
    const items = await draftCourseFinal(v.id, { doNotReuse: graded, onReport: (r) => art.meta.warnings.push(...r.warnings.map((w) => `${lang}: ${w}`)) });
    const portable = items.map((d) => toPortable(v, d));
    const covered = new Set(portable.map((q) => q.source?.number).filter((n): n is number => !!n));
    const missing = v.lectures.map((l) => l.number).filter((n) => !covered.has(n));
    art.meta.coverage[lang] = `${covered.size}/${v.lectures.length}${missing.length ? ` (нет: ${missing.join(',')})` : ''}`;
    const trig = lang === 'kk' ? 0.5 : null;
    const overlaps = items.filter((d) => overlapsWith(d.prompt, graded, { jaccard: 0.35, trigram: trig }));
    if (overlaps.length) art.meta.warnings.push(`${lang}: пересечений с оцениваемыми ${overlaps.length}`);
    console.log(`   вопросов ${items.length} · покрытие ${art.meta.coverage[lang]} · пересечений ${overlaps.length}`);
    art[lang] = portable;
  }
  art.meta.llm = getDraftUsage();
  const path = writeArtifact(args.dataDir, ARTIFACT, art);
  recordSpend(args.dataDir, { script: SCRIPT, at: new Date().toISOString(), ...getDraftUsage() });
  console.log(`\nЧерновик: ${path}`);
  for (const lang of args.langs) {
    console.log(`\n══ ${lang} ══`);
    for (const q of art[lang] ?? []) console.log(`   L${q.source?.number ?? '?'} ${q.sourceTimecode ?? ''} ${q.prompt.slice(0, 150)}\n      ${q.options.map((o, i) => `${q.correctOptionIds.includes(i) ? '*' : ' '}${o}`).join(' | ').slice(0, 220)}`);
  }
  if (art.meta.warnings.length) console.log(`\nПредупреждения:\n   ${art.meta.warnings.join('\n   ')}`);
  return 0;
}

async function apply(args: ReturnType<typeof parseArgs>): Promise<number> {
  const art = readArtifact<Artifact>(args.from!);
  const report = new Report(SCRIPT, args.apply);
  const course = await loadCourse();
  for (const lang of args.langs) {
    const unit = lang;
    const items = art[lang];
    const v = version(course, lang);
    if (!items?.length) {
      report.line(unit, 'skip', 'нет в артефакте');
      continue;
    }
    if (!v.finalMiniQuiz) {
      report.line(unit, 'error', 'у версии нет итогового мини-квиза');
      continue;
    }
    const key = ledgerKey(SCRIPT, lang);
    const title = localizedTitle('COURSE_FINAL', lang);
    const cur = await activeQuestions(prisma, v.finalMiniQuiz.id);
    if (await ledgerGet(prisma, key)) {
      report.line(unit, 'skip', 'уже применено (журнал)');
      continue;
    }
    if (!args.apply) {
      report.line(unit, 'would-change', `архив ${cur.length} → новые ${items.length}; название «${title}»`);
      continue;
    }
    const ids = await writeQuizQuestions(v.finalMiniQuiz.id, items.map((p) => fromPortable(v, p)), { mode: 'ARCHIVE_REPLACE', ledgerKey: key, ledgerDetail: { coverage: art.meta.coverage[lang] } });
    await markShuffled(prisma, ids, SCRIPT);
    if (v.finalMiniQuiz.title !== title) await prisma.quiz.update({ where: { id: v.finalMiniQuiz.id }, data: { title } });
    report.line(unit, ids.length ? 'changed' : 'skip', ids.length ? `архив ${cur.length} → новые ${ids.length} · покрытие ${art.meta.coverage[lang]}` : 'уже применено (журнал)');
  }
  console.log(`\n${report.summary()}`);
  return report.errors ? 1 : 0;
}

async function main(): Promise<number> {
  const args = parseArgs(SCRIPT, { llm: true });
  if (args.draft) return draft(args);
  if (!args.from) {
    console.log('Укажите --draft (черновик через LLM) или --from course-final.v1.json (применение/предпросмотр).');
    return 2;
  }
  return apply(args);
}

run(main);
