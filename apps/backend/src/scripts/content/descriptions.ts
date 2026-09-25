/**
 * Фаза 2h: описания курса для каталога по языкам (draftCourseDescription: 3–5 предложений,
 * 4–6 результатов обучения и строка охвата, посчитанная из данных — лекции, часы видео,
 * тесты разделов, итоговое практическое с ИИ-тьютором, сертификат).
 * ТОЛЬКО ЧЕРНОВИК до согласования с лидом: --draft пишет descriptions.v1.json; применение
 * (--apply --from) предусмотрено на потом и заменяет CourseLanguageVersion.description.
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/descriptions.ts --draft
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/descriptions.ts --from descriptions.v1.json [--apply --i-have-a-backup]
 */
import type { Language } from '@edu/shared';
import { draftCourseDescription, getDraftUsage } from '../../generation/drafts.js';
import { Report, ledgerGet, ledgerKey, ledgerPut, loadCourse, parseArgs, prisma, readArtifact, recordSpend, run, version, writeArtifact } from './lib.js';

const SCRIPT = 'descriptions';
const ARTIFACT = 'descriptions.v1.json';

type Artifact = { meta: { version: 1; createdAt: string; llm: ReturnType<typeof getDraftUsage>; approved: boolean; warnings: string[] } } & Partial<Record<Language, string>>;

async function draft(args: ReturnType<typeof parseArgs>): Promise<number> {
  const course = await loadCourse();
  const art: Artifact = { meta: { version: 1, createdAt: new Date().toISOString(), llm: getDraftUsage(), approved: false, warnings: [] } };
  for (const lang of args.langs) {
    const v = version(course, lang);
    art[lang] = await draftCourseDescription(v.id, { onReport: (r) => art.meta.warnings.push(...r.warnings.map((w) => `${lang}: ${w}`)) });
    console.log(`\n══ ${lang} «${v.title}» ══\n${art[lang]}`);
  }
  art.meta.llm = getDraftUsage();
  const path = writeArtifact(args.dataDir, ARTIFACT, art, { overwriteReviewed: args.has('--overwrite-reviewed') });
  recordSpend(args.dataDir, { script: SCRIPT, at: new Date().toISOString(), ...getDraftUsage() });
  console.log(`\nЧерновик: ${path} (НЕ применяется до согласования; meta.approved = false)`);
  return 0;
}

async function apply(args: ReturnType<typeof parseArgs>): Promise<number> {
  const art = readArtifact<Artifact>(args.from!);
  const report = new Report(SCRIPT, args.apply);
  if (args.apply && !art.meta.approved && !args.force) {
    console.log('✖ Описания не согласованы (meta.approved = false). Поставьте approved: true после согласования или используйте --force.');
    return 1;
  }
  const course = await loadCourse();
  for (const lang of args.langs) {
    const text = art[lang];
    if (!text?.trim()) continue;
    const v = version(course, lang);
    const key = ledgerKey(SCRIPT, lang);
    if (v.description === text) {
      report.line(lang, 'skip', 'описание уже совпадает');
      continue;
    }
    if (!args.apply) {
      report.line(lang, 'would-change', `${(v.description ?? '').length} → ${text.length} симв`);
      continue;
    }
    await prisma.$transaction(async (tx) => {
      await tx.courseLanguageVersion.update({ where: { id: v.id }, data: { description: text } });
      if (!(await ledgerGet(tx, key))) await ledgerPut(tx, key, { before: v.description, chars: text.length });
    });
    report.line(lang, 'changed', `${text.length} симв`);
  }
  console.log(`\n${report.summary()}`);
  return report.errors ? 1 : 0;
}

async function main(): Promise<number> {
  const args = parseArgs(SCRIPT, { llm: true });
  if (args.draft) return draft(args);
  if (!args.from) {
    console.log('Укажите --draft (черновик через LLM) или --from descriptions.v1.json (предпросмотр/применение после согласования).');
    return 2;
  }
  return apply(args);
}

run(main);
