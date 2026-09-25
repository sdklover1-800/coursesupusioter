/**
 * Фаза 1i (A17): детерминированное перемешивание вариантов тренировочных вопросов
 * (мини-квизы лекций и итоговый мини-квиз курса): аудит нашёл ключ на A/B почти везде.
 * Правила:
 *  - только неархивные вопросы НЕоцениваемых тестов, не TRUE_FALSE (порядок «верно/неверно»
 *    задаёт платформа), без ссылок из попыток;
 *  - seed = id вопроса (стабилен между прогонами, в отличие от текста);
 *  - ключ и обоснования пересчитываются (BE4 seededShuffle);
 *  - журнал content:v1:shuffle:<questionId> — второй прогон ничего не меняет; вопросы,
 *    созданные контент-скриптами фазы 2 (уже перемешаны при генерации), помечаются там же;
 *  - оцениваемые вопросы пропускаются: новый банк перемешан при генерации (graded-bank).
 * Печатает гистограммы позиций ключа до/после по языкам.
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/shuffle-options.ts [--apply --i-have-a-backup]
 */
import type { Prisma } from '@prisma/client';
import { keyPositionHistogram, seededShuffle } from '../../generation/drafts.js';
import { type QuestionRow, Report, courseQuestions, ledgerGet, ledgerKey, ledgerPut, loadCourse, locatorLabel, parseArgs, prisma, run, writePreview } from './lib.js';

const SCRIPT = 'shuffle-options';

/** id вопросов теста, на которые ссылаются попытки (ключи answers и presentation.questionIds). */
async function referenced(quizId: string): Promise<Set<string>> {
  const attempts = await prisma.quizAttempt.findMany({ where: { quizId }, select: { answers: true, presentation: true } });
  const ids = new Set<string>();
  for (const a of attempts) {
    for (const k of Object.keys((a.answers ?? {}) as Record<string, unknown>)) ids.add(k);
    const q = (a.presentation as { questionIds?: unknown } | null)?.questionIds;
    if (Array.isArray(q)) q.forEach((x) => typeof x === 'string' && ids.add(x));
  }
  return ids;
}

async function main(): Promise<number> {
  const args = parseArgs(SCRIPT);
  const report = new Report(SCRIPT, args.apply);
  const course = await loadCourse();
  const all = (await courseQuestions(prisma, course)).filter((x) => !x.graded && args.langs.includes(x.lang));
  const before: Record<string, QuestionRow[]> = {};
  const after: Record<string, QuestionRow[]> = {};
  const refCache = new Map<string, Set<string>>();
  const preview: unknown[] = [];
  let skippedTf = 0;
  let skippedLedger = 0;

  for (const { lang, locator, quizId, q } of all) {
    (before[lang] ??= []).push(q);
    const label = `${locatorLabel(lang, locator)} #${q.orderIndex + 1}`;
    if (q.type === 'TRUE_FALSE') {
      skippedTf++;
      (after[lang] ??= []).push(q);
      continue;
    }
    const key = ledgerKey('shuffle', q.id);
    if (await ledgerGet(prisma, key)) {
      skippedLedger++;
      (after[lang] ??= []).push(q);
      continue;
    }
    if (!refCache.has(quizId)) refCache.set(quizId, await referenced(quizId));
    if (refCache.get(quizId)!.has(q.id)) {
      report.line(label, 'skip', 'на вопрос ссылаются попытки — порядок вариантов не меняется');
      (after[lang] ??= []).push(q);
      continue;
    }
    const r = seededShuffle(q.options, q.correctOptionIds, q.optionRationales, q.id);
    const moved = r.permutation.some((p, i) => p !== i);
    (after[lang] ??= []).push({ ...q, options: r.options, correctOptionIds: r.correctOptionIds });
    const summary = `ключ ${q.correctOptionIds.map((c) => 'ABCD'[c]).join('')} → ${r.correctOptionIds.map((c) => 'ABCD'[c]).join('')} (перестановка ${r.permutation.join('')})`;
    preview.push({ label, questionId: q.id, permutation: r.permutation, before: q.correctOptionIds, after: r.correctOptionIds });
    if (!args.apply) {
      report.line(label, 'would-change', summary);
      continue;
    }
    const done = await prisma.$transaction(async (tx) => {
      const cur = await tx.quizQuestion.findUniqueOrThrow({ where: { id: q.id }, select: { options: true, correctOptionIds: true, archivedAt: true } });
      if (cur.archivedAt || JSON.stringify(cur.options) !== JSON.stringify(q.options) || (await ledgerGet(tx, key))) return false;
      if (moved) {
        await tx.quizQuestion.update({
          where: { id: q.id },
          data: {
            options: r.options,
            correctOptionIds: r.correctOptionIds,
            ...(r.optionRationales ? { optionRationales: r.optionRationales as Prisma.InputJsonValue } : {}),
          },
        });
      }
      await ledgerPut(tx, key, { seed: q.id, permutation: r.permutation, before: q.correctOptionIds, after: r.correctOptionIds, script: SCRIPT });
      return true;
    });
    report.line(label, done ? 'changed' : 'skip', done ? summary : 'вопрос изменился во время работы');
  }

  console.log(`\nПропущено: TRUE_FALSE ${skippedTf}, уже перемешаны (журнал) ${skippedLedger}`);
  console.log('Гистограммы позиций ключа (A/B/C/D) тренировочных вопросов:');
  for (const lang of Object.keys(before)) {
    console.log(`   ${lang}: до ${JSON.stringify(keyPositionHistogram(before[lang]!))} → после ${JSON.stringify(keyPositionHistogram(after[lang] ?? []))}`);
  }
  console.log(`\n${report.summary()}`);
  if (!args.apply) console.log(`Предпросмотр: ${writePreview(args, preview)}`);
  return report.errors ? 1 : 0;
}

run(main);
