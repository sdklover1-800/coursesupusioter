/**
 * Фаза 1d (A20, обобщённо): однозначные опечатки и кальки в казахских текстах —
 * берту→беру, үздіксіс→үздіксіз, яйни→яғни, аспекте→аспектіде, «айырмашылық қайда?»→
 * «айырмашылық неде?», ретинде→ретінде (только целые слова). Правятся неархивные
 * kk-вопросы (формулировка, варианты, пояснение, обоснования; порядок вариантов и ключ
 * не меняются) и kk-расшифровки. Каждый изменённый объект получает отметку
 * NATIVE_PROOFREAD для вычитки носителем.
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/fix-kk-text.ts [--apply --i-have-a-backup]
 */
import {
  KK_LEXICON,
  Report,
  applyKkLexicon,
  courseQuestions,
  editQuestionText,
  flagForReview,
  lectureCode,
  ledgerGet,
  ledgerKey,
  ledgerPut,
  loadCourse,
  locatorLabel,
  parseArgs,
  prisma,
  run,
  version,
  writePreview,
} from './lib.js';

const SCRIPT = 'fix-kk-text';

async function main(): Promise<number> {
  const args = parseArgs(SCRIPT);
  const report = new Report(SCRIPT, args.apply);
  const course = await loadCourse();
  const v = version(course, 'kk');
  const preview: unknown[] = [];
  console.log(`Лексикон: ${KK_LEXICON.map((x) => x.label).join(' · ')}\n`);

  /* ── Вопросы ── */
  const questions = (await courseQuestions(prisma, course)).filter((x) => x.lang === 'kk');
  for (const { locator, q } of questions) {
    const hits: Record<string, number> = {};
    const edit = editQuestionText(q, (s) => {
      const r = applyKkLexicon(s);
      for (const [k, n] of Object.entries(r.hits)) hits[k] = (hits[k] ?? 0) + n;
      return r.text;
    });
    if (!edit.changedFields.length) continue;
    const label = `${locatorLabel('kk', locator)} #${q.orderIndex + 1}`;
    const key = ledgerKey(SCRIPT, `q:${q.id}`);
    const summary = `${Object.entries(hits).map(([k, n]) => `${k}×${n}`).join(', ')} (${edit.changedFields.join(',')})`;
    if (await ledgerGet(prisma, key)) {
      report.line(label, 'skip', 'уже применено (журнал)');
      continue;
    }
    preview.push({ unit: label, hits, before: q.prompt, after: edit.prompt });
    if (!args.apply) {
      report.line(label, 'would-change', summary);
      continue;
    }
    const done = await prisma.$transaction(async (tx) => {
      const cur = await tx.quizQuestion.findUniqueOrThrow({ where: { id: q.id }, select: { prompt: true, archivedAt: true } });
      if (cur.prompt !== q.prompt || cur.archivedAt || (await ledgerGet(tx, key))) return false;
      await tx.quizQuestion.update({
        where: { id: q.id },
        data: {
          prompt: edit.prompt,
          options: edit.options,
          explanation: edit.explanation,
          ...(edit.optionRationales ? { optionRationales: edit.optionRationales } : {}),
        },
      });
      await flagForReview(tx, {
        reason: 'NATIVE_PROOFREAD',
        targetType: 'QUIZ_QUESTION',
        targetId: q.id,
        courseId: course.courseId,
        languageVersionId: v.id,
        comment: `Вычитка: исправлены опечатки (${Object.keys(hits).join(', ')}) — проверьте формулировку целиком`,
      });
      await ledgerPut(tx, key, { label, hits, fields: edit.changedFields });
      return true;
    });
    report.line(label, done ? 'changed' : 'skip', done ? summary : 'вопрос изменился во время работы');
  }

  /* ── Расшифровки ── */
  for (const l of v.lectures) {
    const r = applyKkLexicon(l.transcriptText);
    if (r.text === l.transcriptText) continue;
    const code = lectureCode('kk', l.number);
    const key = ledgerKey(SCRIPT, code);
    const summary = Object.entries(r.hits).map(([k, n]) => `${k}×${n}`).join(', ');
    if (await ledgerGet(prisma, key)) {
      report.line(code, 'skip', 'уже применено (журнал)');
      continue;
    }
    preview.push({ unit: code, hits: r.hits });
    if (!args.apply) {
      report.line(code, 'would-change', summary);
      continue;
    }
    const before = l.transcriptText;
    const done = await prisma.$transaction(async (tx) => {
      const cur = await tx.lecture.findUniqueOrThrow({ where: { id: l.id }, select: { transcriptText: true } });
      if (cur.transcriptText !== before || (await ledgerGet(tx, key))) return false;
      await tx.lecture.update({ where: { id: l.id }, data: { transcriptText: r.text } });
      await flagForReview(tx, {
        reason: 'NATIVE_PROOFREAD',
        targetType: 'LECTURE',
        targetId: l.id,
        courseId: course.courseId,
        languageVersionId: v.id,
        comment: `Вычитка расшифровки: исправлены опечатки (${Object.keys(r.hits).join(', ')})`,
      });
      await ledgerPut(tx, key, { hits: r.hits });
      return true;
    });
    report.line(code, done ? 'changed' : 'skip', done ? summary : 'расшифровка изменилась во время работы');
  }

  if (!report.rows.length) report.line('kk', 'skip', 'опечаток лексикона нет');
  console.log(`\n${report.summary()}`);
  if (!args.apply) console.log(`Предпросмотр: ${writePreview(args, preview)}`);
  return report.errors ? 1 : 0;
}

run(main);
