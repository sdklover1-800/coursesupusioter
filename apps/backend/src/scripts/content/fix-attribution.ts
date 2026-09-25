/**
 * Фаза 1b: фактическая ошибка атрибуции «кризисов развития». В ru/kk-расшифровках
 * лекции 13 стоит «Габриэль Алмонд и Люсьен Бинтроу»; в en уже верно — «Gabriel Almond
 * and Lucian Pye». Правим ru/kk на «Люсьен Пай» / «Л. Пай» (якоря с проверкой числа
 * попаданий), те же замены — в неархивных вопросах и пояснениях (мини-квизы L13 ru/kk;
 * старый оцениваемый вопрос ru модуля IV архивирует graded-bank). После — 0 «Бинтроу»
 * в неархивном контенте. На лекции ru-13 и kk-13 ставится отметка FACT_CHECK для
 * эксперта: полная атрибуция — Binder, Coleman, LaPalombara, Pye, Verba, Weiner (1971).
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/fix-attribution.ts [--apply --i-have-a-backup]
 */
import type { Language } from '@edu/shared';
import {
  Report,
  courseQuestions,
  editQuestionText,
  flagForReview,
  lectureByNumber,
  lectureCode,
  ledgerGet,
  ledgerKey,
  ledgerPut,
  loadCourse,
  locatorLabel,
  parseArgs,
  prisma,
  replaceAnchor,
  run,
  version,
  writePreview,
} from './lib.js';

const SCRIPT = 'fix-attribution';
const BAD = /Бинтроу/u;

/** Якоря расшифровок: [было, стало, ожидаемое число попаданий]. Длинные — раньше коротких. */
const TRANSCRIPT_ANCHORS: Partial<Record<Language, [string, string, number][]>> = {
  ru: [
    ['Габриэль Алмонд и Люсьен Бинтроу', 'Габриэль Алмонд и Люсьен Пай', 1],
    ['(Г. Алмонд, Л. Бинтроу)', '(Г. Алмонд, Л. Пай)', 1],
    ['по Алмонду и Бинтроу', 'по Алмонду и Паю', 1],
  ],
  kk: [
    ['Габриэль Алмонд пен Люсьен Бинтроу', 'Габриэль Алмонд пен Люсьен Пай', 1],
    ['(Г. Алмонд, Л. Бинтроу)', '(Г. Алмонд, Л. Пай)', 1],
    ['Алмонд пен Бинтроу', 'Алмонд пен Пай', 1],
  ],
};

/** Замены для вопросов (падежные формы ru и kk). */
const QUESTION_PHRASES: [RegExp, string][] = [
  [/Люсьеном Бинтроу/gu, 'Люсьеном Паем'],
  [/Люсьен Бинтроу/gu, 'Люсьен Пай'],
  [/Л\. Бинтроу/gu, 'Л. Пай'],
  [/Алмонда и Бинтроу/gu, 'Алмонда и Пая'],
  [/Алмонду и Бинтроу/gu, 'Алмонду и Паю'],
  [/Алмондом и Бинтроу/gu, 'Алмондом и Паем'],
  [/Алмонд и Бинтроу/gu, 'Алмонд и Пай'],
  [/Алмонд пен Бинтроу/gu, 'Алмонд пен Пай'],
  [/Бинтроудың/gu, 'Пайдың'],
];

const fixPhrases = (s: string) => QUESTION_PHRASES.reduce((acc, [re, to]) => acc.replace(re, to), s);

const FACT_CHECK_COMMENT =
  'SME: подтвердить атрибуцию «кризисов развития» (Алмонд и Пай; полная — Binder, Coleman, LaPalombara, Pye, Verba, Weiner, 1971)';

async function main(): Promise<number> {
  const args = parseArgs(SCRIPT);
  const report = new Report(SCRIPT, args.apply);
  const course = await loadCourse();
  const preview: unknown[] = [];

  /* ── Расшифровки лекции 13 ── */
  for (const lang of ['ru', 'kk'] as Language[]) {
    const v = version(course, lang);
    const l = lectureByNumber(v, 13);
    const code = lectureCode(lang, 13);
    const key = ledgerKey(SCRIPT, code);
    if (await ledgerGet(prisma, key)) {
      report.line(code, 'skip', 'уже применено (журнал)');
      continue;
    }
    if (!BAD.test(l.transcriptText)) {
      report.line(code, 'skip', '«Бинтроу» в расшифровке нет');
      continue;
    }
    let text = l.transcriptText;
    try {
      for (const [from, to, n] of TRANSCRIPT_ANCHORS[lang]!) text = replaceAnchor(text, from, to, n, code);
      if (BAD.test(text)) throw new Error(`${code}: после замен осталось «Бинтроу» — нужен новый якорь`);
    } catch (e) {
      report.line(code, 'error', (e as Error).message);
      continue;
    }
    preview.push({ unit: code, anchors: TRANSCRIPT_ANCHORS[lang] });
    if (!args.apply) {
      report.line(code, 'would-change', `замен ${TRANSCRIPT_ANCHORS[lang]!.length} · + отметка FACT_CHECK`);
      continue;
    }
    const before = l.transcriptText;
    const done = await prisma.$transaction(async (tx) => {
      const cur = await tx.lecture.findUniqueOrThrow({ where: { id: l.id }, select: { transcriptText: true } });
      if (cur.transcriptText !== before || (await ledgerGet(tx, key))) return false;
      await tx.lecture.update({ where: { id: l.id }, data: { transcriptText: text } });
      await flagForReview(tx, {
        reason: 'FACT_CHECK',
        targetType: 'LECTURE',
        targetId: l.id,
        courseId: course.courseId,
        languageVersionId: v.id,
        comment: FACT_CHECK_COMMENT,
      });
      await ledgerPut(tx, key, { anchors: TRANSCRIPT_ANCHORS[lang] });
      return true;
    });
    report.line(code, done ? 'changed' : 'skip', done ? 'Бинтроу → Пай (3 якоря) · отметка FACT_CHECK' : 'расшифровка изменилась во время работы');
  }

  /* ── Вопросы и пояснения (неархивные, все языки) ── */
  const questions = (await courseQuestions(prisma, course)).filter(({ q }) =>
    [q.prompt, ...q.options, q.explanation ?? '', ...(q.optionRationales ?? [])].some((s) => BAD.test(s)),
  );
  for (const { lang, locator, q } of questions) {
    const unit = `q:${q.id}`;
    const label = `${locatorLabel(lang, locator)} #${q.orderIndex + 1}`;
    const key = ledgerKey(SCRIPT, unit);
    if (await ledgerGet(prisma, key)) {
      report.line(label, 'skip', 'уже применено (журнал)');
      continue;
    }
    const edit = editQuestionText(q, fixPhrases);
    const left = [edit.prompt, ...edit.options, edit.explanation ?? '', ...(edit.optionRationales ?? [])].some((s) => BAD.test(s));
    if (left) {
      report.line(label, 'error', `осталось «Бинтроу» после замен — добавьте падежную форму: ${q.prompt.slice(0, 80)}`);
      continue;
    }
    preview.push({ unit: label, before: q.prompt, after: edit.prompt, fields: edit.changedFields });
    if (!args.apply) {
      report.line(label, 'would-change', `${edit.changedFields.join(',')}: «${edit.prompt.slice(0, 90)}»`);
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
      await ledgerPut(tx, key, { label, fields: edit.changedFields, before: q.prompt, after: edit.prompt });
      return true;
    });
    report.line(label, done ? 'changed' : 'skip', done ? `${edit.changedFields.join(',')}: Бинтроу → Пай` : 'вопрос изменился во время работы');
  }
  if (!questions.length) report.line('questions', 'skip', '«Бинтроу» в неархивных вопросах нет');

  console.log(`\n${report.summary()}`);
  if (!args.apply) console.log(`Предпросмотр: ${writePreview(args, preview)}`);
  return report.errors ? 1 : 0;
}

run(main);
