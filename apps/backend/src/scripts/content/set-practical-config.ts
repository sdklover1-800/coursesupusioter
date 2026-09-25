/**
 * Фаза 1f: настройки итогового практикума курса (USER_DECISIONS §4, калибровка BE3):
 * бюджет токенов ru 160000 / kk 190000 / en 120000 (вмещает 24 реплики), maxAiMessages 24,
 * maxSessions 2, estimatedMinutes 25 и план беседы (виден студенту) на языке версии.
 * Уже идущие/завершённые сессии не меняются: у каждой свой снимок задания (фаза A) и
 * снимок лимита реплик.
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/set-practical-config.ts [--apply --i-have-a-backup] [--force]
 */
import { PRACTICAL_CONFIG as CONFIG, Report, ledgerGet, ledgerKey, ledgerPut, loadCourse, parseArgs, practicalModule, prisma, run, writePreview } from './lib.js';

const SCRIPT = 'set-practical-config';

async function main(): Promise<number> {
  const args = parseArgs(SCRIPT);
  const report = new Report(SCRIPT, args.apply);
  const course = await loadCourse();
  const preview: unknown[] = [];
  for (const lang of args.langs) {
    const v = course.versions[lang];
    const m = v && practicalModule(v);
    if (!m?.practicalTask) {
      report.line(`practical:${lang}`, 'error', 'у версии нет практического задания');
      continue;
    }
    const unit = `practical:${lang}`;
    const want = CONFIG[lang];
    const t = await prisma.practicalTask.findUniqueOrThrow({ where: { id: m.practicalTask.id } });
    const diff: string[] = [];
    for (const k of ['tokenBudget', 'maxAiMessages', 'maxSessions', 'estimatedMinutes'] as const) {
      if (t[k] !== want[k]) diff.push(`${k}: ${t[k]} → ${want[k]}`);
    }
    if (JSON.stringify(t.agenda) !== JSON.stringify(want.agenda)) diff.push(`agenda: ${JSON.stringify(t.agenda)} → ${JSON.stringify(want.agenda)}`);
    if (!diff.length) {
      report.line(unit, 'skip', `уже ${want.tokenBudget}/${want.maxAiMessages}/${want.maxSessions}/${want.estimatedMinutes} мин + план`);
      continue;
    }
    const key = ledgerKey(SCRIPT, unit);
    const applied = await ledgerGet(prisma, key);
    if (applied && !args.force) {
      report.line(unit, 'skip', `применено ранее, затем изменено вручную (${diff.join('; ')}) — не трогаю без --force`);
      continue;
    }
    preview.push({ unit, diff });
    if (!args.apply) {
      report.line(unit, 'would-change', diff.join('; '));
      continue;
    }
    await prisma.$transaction(async (tx) => {
      await tx.practicalTask.update({
        where: { id: t.id },
        data: {
          tokenBudget: want.tokenBudget,
          maxAiMessages: want.maxAiMessages,
          maxSessions: want.maxSessions,
          estimatedMinutes: want.estimatedMinutes,
          agenda: want.agenda,
        },
      });
      if (applied) await tx.contentMigration.update({ where: { key }, data: { detail: { taskId: t.id, diff, forced: true } } });
      else await ledgerPut(tx, key, { taskId: t.id, diff });
    });
    report.line(unit, 'changed', diff.join('; '));
  }
  console.log(`\n${report.summary()}`);
  if (!args.apply) console.log(`Предпросмотр: ${writePreview(args, preview)}`);
  return report.errors ? 1 : 0;
}

run(main);
