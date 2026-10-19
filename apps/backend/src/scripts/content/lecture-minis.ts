/**
 * Фаза 2d′ (новый курс; A11): тренировочные мини-квизы лекций — 3 вопроса (2 SINGLE_CHOICE +
 * 1 TRUE_FALSE) строго по расшифровке своей лекции. Тот же генератор, что у задачи MINI конвейера
 * генерации (generation/service.ts → draftMiniQuiz), но через проверенный JSON-артефакт: на проде
 * LLM не вызывается, вопросы приходят из content-data/<курс>/lecture-minis.v1.json. (Политология
 * получила мини-квизы раньше, конвейером генерации; этот скрипт — для курсов, загружаемых с нуля.)
 *
 * Черновик (--draft [--only ru-01,kk-04] [--lang …] [--overwrite-reviewed]):
 *  - для каждой лекции с расшифровкой — draftMiniQuiz(lectureId, {doNotReuse}): перемешанные
 *    варианты, обоснования, источник; doNotReuse — все действующие формулировки оцениваемого банка
 *    версии (A11; банк должен быть уже применён — иначе отказ без --force) и итогового мини-квиза;
 *  - пересечение с оцениваемыми (Жаккар > 0.35, для kk ещё триграммы > 0.5 — пороги аудита)
 *    попадает в meta.warnings;
 *  - лекции без расшифровки (ждут автора) пропускаются и перечисляются в meta.awaitingTranscript;
 *  - существующий артефакт дополняется: строки тех же лекций заменяются, правки рецензента в meta
 *    сохраняются (проверенный артефакт перезаписывается только с --overwrite-reviewed).
 * Применение (--from lecture-minis.v1.json [--apply --i-have-a-backup] [--force]):
 *  - лекция ищется по позиции (модуль, лекция); у лекции без мини-квиза он создаётся (LECTURE_MINI,
 *    тренировочный, название localizedTitle — как в generation/service.ts);
 *  - writeQuizQuestions(miniQuizId, items, {mode: 'ARCHIVE_REPLACE', ledgerKey 'content:v1:[<курс>:]lecture-minis:<lang-NN>'})
 *    + пометка «перемешано при генерации» (журнал shuffle, его читает shuffle-options);
 *  - мини-квиз с другими вопросами (сгенерирован раньше или правлен менеджером) без --force не трогается;
 *  - расшифровка изменилась после черновика (sha256) — предупреждение в строке сводки;
 *  - правки рецензента после применения (meta.textFixes) переносятся по точному «было → стало».
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/lecture-minis.ts --course "…" --draft [--only kk-04,en-14]
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/lecture-minis.ts --course "…" --from lecture-minis.v1.json [--apply --i-have-a-backup] [--force]
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Language } from '@edu/shared';
import { type DraftQuestion, draftMiniQuiz, getDraftUsage, gradedPromptsOfVersion, localizedTitle, overlapsWith, writeQuizQuestions } from '../../generation/drafts.js';
import {
  type LectureCtx,
  type PortableQuestion,
  Report,
  type VersionCtx,
  activeQuestions,
  applyTextFixes,
  fromPortable,
  lectureByPos,
  lectureCode,
  ledgerGet,
  ledgerKey,
  loadCourse,
  markShuffled,
  parseArgs,
  prisma,
  readArtifact,
  recordSpend,
  round,
  run,
  sha256,
  toPortable,
  version,
  writeArtifact,
} from './lib.js';
import type { TextFix } from './revisions.js';

const SCRIPT = 'lecture-minis';
const ARTIFACT = 'lecture-minis.v1.json';
const CONCURRENCY = 4;

/** Пороги пересечения с оцениваемыми — как в аудите (gradedPracticeOverlaps). */
const thresholdsFor = (lang: Language) => ({ jaccard: 0.35, trigram: lang === 'kk' ? 0.5 : null });

interface MiniRow {
  lang: Language;
  /** Сквозной номер лекции (для чтения человеком); поиск — по (module, lectureOrder). */
  lecture: number;
  module: number;
  lectureOrder: number;
  title: string;
  /** Расшифровка на момент черновика (предупреждение, если изменилась до применения). */
  transcriptSha256: string;
  items: PortableQuestion[];
}

interface Artifact {
  meta: {
    version: 1;
    createdAt: string;
    updatedAt: string;
    llm: ReturnType<typeof getDraftUsage>;
    thresholds: string;
    warnings: string[];
    /** Лекции без расшифровки на момент черновика — мини-квиза нет (ждут автора). */
    awaitingTranscript: string[];
    /** Правки рецензента (человекочитаемо). */
    reviewEdits?: string[];
    reviewNotes?: string[];
    /** Те же правки для стендов, где мини-квизы уже записаны (lib.applyTextFixes). */
    textFixes?: TextFix[];
  };
  minis: MiniRow[];
}

const byLecture = (a: MiniRow, b: MiniRow) => a.lang.localeCompare(b.lang) || a.lecture - b.lecture;

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x);
    }),
  );
}

/** Формулировки итогового мини-квиза версии — тоже не повторяем (тренировка не дублирует сама себя). */
async function courseFinalPrompts(v: VersionCtx): Promise<string[]> {
  return v.finalMiniQuiz ? (await activeQuestions(prisma, v.finalMiniQuiz.id)).map((q) => q.prompt) : [];
}

async function draft(args: ReturnType<typeof parseArgs>): Promise<number> {
  const only = args.get('--only')?.split(',').map((s) => s.trim()).filter(Boolean);
  const course = await loadCourse();
  const path = join(args.dataDir, ARTIFACT);
  const now = new Date().toISOString();
  const art: Artifact = existsSync(path)
    ? readArtifact<Artifact>(path)
    : {
        meta: { version: 1, createdAt: now, updatedAt: now, llm: getDraftUsage(), thresholds: 'Жаккар > 0.35; kk — ещё триграммы > 0.5', warnings: [], awaitingTranscript: [] },
        minis: [],
      };
  const todo: { lang: Language; v: VersionCtx; l: LectureCtx; graded: string[]; avoid: string[] }[] = [];
  const awaiting: string[] = [];
  for (const lang of args.langs) {
    const v = version(course, lang);
    const graded = await gradedPromptsOfVersion(v.id);
    if (!graded.length && !args.force) {
      console.log(`✖ ${lang}: оцениваемый банк версии ещё не применён — мини-квизы нельзя проверить на пересечение с ним (A11). Сначала graded-bank --apply; --force — всё равно.`);
      return 1;
    }
    const avoid = [...graded, ...(await courseFinalPrompts(v))];
    for (const l of v.lectures) {
      const code = lectureCode(lang, l.number);
      if (only && !only.includes(code)) continue;
      if (!l.transcriptText.trim()) awaiting.push(code);
      else todo.push({ lang, v, l, graded, avoid });
    }
  }
  console.log(`Лекций к черновику: ${todo.length}${awaiting.length ? ` · без расшифровки (пропуск): ${awaiting.join(', ')}` : ''}`);

  const fresh = new Map<string, MiniRow>();
  const warnings: string[] = [];
  await pool(todo, CONCURRENCY, async ({ lang, v, l, graded, avoid }) => {
    const code = lectureCode(lang, l.number);
    const items: DraftQuestion[] = await draftMiniQuiz(l.id, { doNotReuse: avoid, onReport: (r) => warnings.push(...r.warnings.map((w) => `${code}: ${w}`)) });
    for (const d of items) {
      const hit = overlapsWith(d.prompt, graded, thresholdsFor(lang));
      if (hit) warnings.push(`${code}: пересечение с оцениваемым (J=${round(hit.jaccard)} T=${round(hit.trigram)}): ${d.prompt.slice(0, 80)}`);
    }
    fresh.set(code, { lang, lecture: l.number, module: l.moduleOrder, lectureOrder: l.lectureOrder, title: l.title, transcriptSha256: sha256(l.transcriptText), items: items.map((d) => toPortable(v, d)) });
    console.log(`→ ${code} · ${items.map((d) => `${d.type === 'TRUE_FALSE' ? 'TF' : 'SC'}`).join('/')} · ${items[0]?.prompt.slice(0, 90)}`);
  });

  art.minis = [...art.minis.filter((m) => !fresh.has(lectureCode(m.lang, m.lecture))), ...fresh.values()].sort(byLecture);
  const stillAwaiting = new Set([...art.meta.awaitingTranscript.filter((c) => !fresh.has(c)), ...awaiting]);
  art.meta.awaitingTranscript = [...stillAwaiting].sort();
  // Предупреждения перечерновлённых лекций заменяются новыми.
  art.meta.warnings = [...art.meta.warnings.filter((w) => !fresh.has(w.split(':')[0]!)), ...warnings];
  art.meta.updatedAt = new Date().toISOString();
  const usage = getDraftUsage();
  art.meta.llm = {
    calls: art.meta.llm.calls + usage.calls,
    inputTokens: art.meta.llm.inputTokens + usage.inputTokens,
    outputTokens: art.meta.llm.outputTokens + usage.outputTokens,
    costUsd: art.meta.llm.costUsd + usage.costUsd,
  };
  const out = writeArtifact(args.dataDir, ARTIFACT, art, { overwriteReviewed: args.has('--overwrite-reviewed') });
  recordSpend(args.dataDir, { script: SCRIPT, at: new Date().toISOString(), ...usage });
  console.log(`\nЧерновик: ${out} · лекций в артефакте ${art.minis.length}`);
  for (const m of [...fresh.values()].sort(byLecture)) {
    console.log(`\n══ ${lectureCode(m.lang, m.lecture)} ${m.title.slice(0, 70)} ══`);
    for (const q of m.items) console.log(`   [${q.type}] ${q.prompt}\n      ${q.options.map((o, i) => `${q.correctOptionIds.includes(i) ? '*' : ' '}${o}`).join(' | ')}`);
  }
  if (warnings.length) console.log(`\nПредупреждения:\n   ${warnings.join('\n   ')}`);
  return 0;
}

async function apply(args: ReturnType<typeof parseArgs>): Promise<number> {
  const art = readArtifact<Artifact>(args.from!);
  const report = new Report(SCRIPT, args.apply);
  const course = await loadCourse();
  for (const row of art.minis.filter((x) => args.langs.includes(x.lang)).sort(byLecture)) {
    const code = lectureCode(row.lang, row.lecture);
    const v = version(course, row.lang);
    const l = lectureByPos(v, row.module, row.lectureOrder);
    if (!l) {
      report.line(code, 'error', 'лекция не найдена');
      continue;
    }
    if (!row.items.length) {
      report.line(code, 'skip', 'в артефакте нет вопросов');
      continue;
    }
    const key = ledgerKey(SCRIPT, code);
    if (await ledgerGet(prisma, key)) {
      report.line(code, 'skip', 'уже применено (журнал)');
      continue;
    }
    const title = localizedTitle('LECTURE_MINI', row.lang, l.title);
    const note = sha256(l.transcriptText) !== row.transcriptSha256 ? ' · ВНИМАНИЕ: расшифровка изменилась после черновика' : '';
    const cur = l.miniQuiz ? await activeQuestions(prisma, l.miniQuiz.id) : [];
    if (cur.length === row.items.length && cur.every((q, i) => q.prompt === row.items[i]!.prompt.trim())) {
      report.line(code, 'skip', 'вопросы мини-квиза уже совпадают с артефактом');
      continue;
    }
    if (cur.length && !args.force) {
      report.line(code, 'skip', `у лекции уже есть мини-квиз (${cur.length} вопр., другие) — не трогаю без --force`);
      continue;
    }
    if (!args.apply) {
      report.line(code, 'would-change', `${l.miniQuiz ? `архив ${cur.length} → новые` : 'создать мини-квиз + вопросов'} ${row.items.length}${note}`);
      continue;
    }
    // Новый курс: мини-квиза у лекции ещё нет — создаётся тренировочным (как в generation/service.ts).
    const quizId = l.miniQuiz?.id ?? (await prisma.quiz.create({ data: { lectureId: l.id, kind: 'LECTURE_MINI', isGraded: false, title }, select: { id: true } })).id;
    const ids = await writeQuizQuestions(quizId, row.items.map((p) => fromPortable(v, p)), {
      mode: 'ARCHIVE_REPLACE',
      ledgerKey: key,
      ledgerDetail: { artifact: ARTIFACT, transcriptSha256: row.transcriptSha256, archived: cur.map((q) => q.id) },
    });
    await markShuffled(prisma, ids, SCRIPT);
    if (l.miniQuiz && l.miniQuiz.title !== title) await prisma.quiz.update({ where: { id: quizId }, data: { title } });
    report.line(code, ids.length ? 'changed' : 'skip', ids.length ? `${l.miniQuiz ? `архив ${cur.length} → новые` : 'создан мини-квиз, вопросов'} ${ids.length}${note}` : 'уже применено (журнал)');
  }
  for (const c of art.meta.awaitingTranscript.filter((x) => args.langs.includes(x.slice(0, 2) as Language))) {
    report.line(c, 'skip', 'нет расшифровки на момент черновика — мини-квиза нет (ждёт автора; затем --draft --only)');
  }
  // Правки рецензента после применения (meta.textFixes): текст, без порядка вариантов и ключа.
  await applyTextFixes({ script: SCRIPT, fixes: art.meta.textFixes ?? [], course, langs: args.langs, apply: args.apply, force: args.force, report });
  console.log(`\n${report.summary()}`);
  return report.errors ? 1 : 0;
}

async function main(): Promise<number> {
  const args = parseArgs(SCRIPT, { llm: true });
  if (args.draft) return draft(args);
  if (!args.from) {
    console.log('Укажите --draft (черновик через LLM) или --from lecture-minis.v1.json (применение/предпросмотр).');
    return 2;
  }
  return apply(args);
}

run(main);
