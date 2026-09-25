/**
 * Фаза 1e: политика официальных тестов модулей (USER_DECISIONS §1) для всех
 * оцениваемых тестов курса: maxAttempts 2, scoringRule BEST, cooldownMinutes null
 * (значение из env, по умолчанию 24 ч), reviewPolicy FULL_AFTER_FINAL. Порог сдачи
 * (passThreshold 0.7) не меняется. Если после применения менеджер изменил тест — без --force
 * скрипт его не трогает.
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/set-quiz-policy.ts [--apply --i-have-a-backup]
 */
import { Report, gradedModules, ledgerGet, ledgerKey, ledgerPut, loadCourse, parseArgs, prisma, run, writePreview } from './lib.js';

const SCRIPT = 'set-quiz-policy';
const POLICY = { maxAttempts: 2, scoringRule: 'BEST', cooldownMinutes: null, reviewPolicy: 'FULL_AFTER_FINAL' } as const;

async function main(): Promise<number> {
  const args = parseArgs(SCRIPT);
  const report = new Report(SCRIPT, args.apply);
  const course = await loadCourse();
  const preview: unknown[] = [];
  for (const lang of args.langs) {
    const v = course.versions[lang];
    if (!v) continue;
    for (const m of gradedModules(v)) {
      const unit = `${lang}:${m.key}`;
      const q = await prisma.quiz.findUniqueOrThrow({ where: { id: m.quiz.id } });
      const diff = (Object.keys(POLICY) as (keyof typeof POLICY)[]).filter((k) => q[k] !== POLICY[k]);
      if (!diff.length) {
        report.line(unit, 'skip', `уже ${POLICY.maxAttempts} попытки / ${POLICY.scoringRule} / пауза из env / ${POLICY.reviewPolicy} (порог ${q.passThreshold})`);
        continue;
      }
      const change = diff.map((k) => `${k}: ${q[k]} → ${POLICY[k]}`).join(', ');
      const key = ledgerKey(SCRIPT, unit);
      const applied = await ledgerGet(prisma, key);
      if (applied && !args.force) {
        // Менеджер вправе менять паузу/попытки отдельного теста — повторный прогон их не затирает.
        report.line(unit, 'skip', `применено ранее, затем изменено вручную (${change}) — не трогаю без --force`);
        continue;
      }
      preview.push({ unit, change });
      if (!args.apply) {
        report.line(unit, 'would-change', change);
        continue;
      }
      await prisma.$transaction(async (tx) => {
        await tx.quiz.update({ where: { id: q.id }, data: POLICY });
        if (applied) await tx.contentMigration.update({ where: { key }, data: { detail: { quizId: q.id, change, forced: true } } });
        else await ledgerPut(tx, key, { quizId: q.id, change });
      });
      report.line(unit, 'changed', change);
    }
  }
  console.log(`\n${report.summary()}`);
  if (!args.apply) console.log(`Предпросмотр: ${writePreview(args, preview)}`);
  return report.errors ? 1 : 0;
}

run(main);
