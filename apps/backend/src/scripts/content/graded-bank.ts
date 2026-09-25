/**
 * Фаза 2b (USER_DECISIONS §5): канонический банк оцениваемых тестов модулей I–IV.
 *
 * Черновик (--draft [--only M2,M4]):
 *  - ru: draftModuleQuiz(moduleId, {count 8, types {SINGLE_CHOICE: 8}, canonicalKeyPrefix
 *    'polit:M<i>', doNotReuse: тренировочные формулировки модуля}) — 8 вопросов × 4 варианта,
 *    перемешаны с равномерными позициями ключа, с обоснованиями и источником;
 *  - гейт: 8 вопросов по 4 варианта, один ключ; нет подсказки длиной; ни одна позиция ключа
 *    не выше 40% (по 32 вопросам и по модулю); testwiseScore < 0.7; нет повторов формулировок.
 *    Не прошёл — один повторный черновик; снова не прошёл — модуль в отчёте, без записи;
 *  - kk, en: translateQuestions(items, lang, {targetVersionId}) — те же вопросы, ключи, порядок
 *    вариантов и canonicalKey; проверяется совпадение и гейт на каждом языке;
 *  - артефакт content-data/politology/graded-bank.v1.json {ru:{M1:[…]}, kk:{…}, en:{…}}; источник
 *    вопроса — по позиции лекции (переносимо на прод).
 * Применение (--from graded-bank.v1.json [--apply --i-have-a-backup]):
 *  - отказ, если фаза A не выполнена или у какого-либо целевого теста есть незавершённая попытка;
 *  - writeQuizQuestions(quizId, items, {mode: 'ARCHIVE_REPLACE', ledgerKey 'content:v1:graded-bank:<lang>:M<i>'}):
 *    старые вопросы АРХИВИРУЮТСЯ (не удаляются) — прошлые попытки сохраняют смысл;
 *  - отметки: ru — EXPERT_REVIEW (политолог), kk/en — NATIVE_PROOFREAD (перевод); системные
 *    отметки с архивированных вопросов снимаются (DISMISSED);
 *  - проверка: каждая прошлая попытка пересчитывается по своей presentation в сохранённый балл.
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/graded-bank.ts --draft
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/graded-bank.ts --from graded-bank.v1.json [--apply --i-have-a-backup]
 */
import { existsSync } from 'node:fs';
import { join as _join } from 'node:path';
import type { Language } from '@edu/shared';
import {
  type DraftQuestion,
  type DraftReport,
  draftModuleQuiz,
  getDraftUsage,
  keyPositionHistogram,
  lengthCue,
  lengthRatio,
  practicePromptsForModule,
  testwiseScore,
  translateQuestions,
  writeQuizQuestions,
} from '../../generation/drafts.js';
import {
  type PortableQuestion,
  Report,
  type VersionCtx,
  activeQuestions,
  assertPhaseA,
  dismissSystemFlags,
  flagForReview,
  fromPortable,
  gradedModules,
  ledgerGet,
  ledgerKey,
  loadCourse,
  parseArgs,
  printRescore,
  prisma,
  readArtifact,
  recordSpend,
  rescoreAttempts,
  round,
  run,
  sha256,
  toPortable,
  version,
  writeArtifact,
} from './lib.js';

const SCRIPT = 'graded-bank';
const ARTIFACT = 'graded-bank.v1.json';
const LANGS: Language[] = ['ru', 'kk', 'en'];

interface Gate {
  ok: boolean;
  problems: string[];
  keyHistogram: number[];
  testwise: number;
  maxLengthRatio: number;
}

interface Artifact {
  meta: {
    version: 1;
    createdAt: string;
    updatedAt: string;
    promptVersion: string;
    llm: ReturnType<typeof getDraftUsage>;
    gates: Record<string, Record<string, Gate>>;
    warnings: Record<string, string[]>;
    redrafted: string[];
  };
  ru: Record<string, PortableQuestion[]>;
  kk: Record<string, PortableQuestion[]>;
  en: Record<string, PortableQuestion[]>;
}

/* ── Гейт качества ─────────────────────────────────────────────── */

function gate(items: DraftQuestion[] | PortableQuestion[], expectedCount = 8): Gate {
  const problems: string[] = [];
  if (items.length !== expectedCount) problems.push(`вопросов ${items.length}, нужно ${expectedCount}`);
  for (const [i, q] of items.entries()) {
    if (q.type !== 'SINGLE_CHOICE') problems.push(`Q${i + 1}: тип ${q.type}`);
    if (q.options.length !== 4) problems.push(`Q${i + 1}: вариантов ${q.options.length}`);
    if (q.correctOptionIds.length !== 1) problems.push(`Q${i + 1}: ключей ${q.correctOptionIds.length}`);
    if (lengthCue(q.options, q.correctOptionIds)) problems.push(`Q${i + 1}: подсказка длиной (${round(lengthRatio(q.options, q.correctOptionIds) ?? 0)}×)`);
  }
  const hist = keyPositionHistogram(items);
  const total = hist.reduce((a, b) => a + b, 0);
  if (total && Math.max(...hist) / total > 0.4) problems.push(`позиция ключа выше 40%: ${JSON.stringify(hist)}`);
  const tw = testwiseScore(items);
  if (tw >= 0.7) problems.push(`testwiseScore ${tw} ≥ 0.7`);
  const prompts = items.map((q) => q.prompt.trim().toLowerCase());
  if (new Set(prompts).size !== prompts.length) problems.push('повтор формулировки');
  const ratios = items.map((q) => lengthRatio(q.options, q.correctOptionIds) ?? 0);
  return { ok: !problems.length, problems, keyHistogram: hist, testwise: round(tw, 3), maxLengthRatio: round(Math.max(0, ...ratios)) };
}

/** Совпадение структуры перевода с ru: canonicalKey, ключ, число вариантов, тип. */
function sameStructure(ru: PortableQuestion[], tr: PortableQuestion[]): string[] {
  const out: string[] = [];
  if (ru.length !== tr.length) out.push(`вопросов ${tr.length} ≠ ${ru.length}`);
  ru.forEach((q, i) => {
    const t = tr[i];
    if (!t) return;
    if (t.canonicalKey !== q.canonicalKey) out.push(`Q${i + 1}: canonicalKey ${t.canonicalKey} ≠ ${q.canonicalKey}`);
    if (JSON.stringify(t.correctOptionIds) !== JSON.stringify(q.correctOptionIds)) out.push(`Q${i + 1}: ключ`);
    if (t.options.length !== q.options.length) out.push(`Q${i + 1}: число вариантов`);
    if (t.type !== q.type) out.push(`Q${i + 1}: тип`);
  });
  return out;
}

/* ── Черновик ───────────────────────────────────────────────────── */

async function draft(args: ReturnType<typeof parseArgs>): Promise<number> {
  const only = args.get('--only')?.split(',').map((s) => s.trim().toUpperCase());
  const course = await loadCourse();
  const ru = version(course, 'ru');
  const path = _join(args.dataDir, ARTIFACT);
  const now = new Date().toISOString();
  const art: Artifact = existsSync(path)
    ? readArtifact<Artifact>(path)
    : { meta: { version: 1, createdAt: now, updatedAt: now, promptVersion: 'gen-2.0', llm: getDraftUsage(), gates: {}, warnings: {}, redrafted: [] }, ru: {}, kk: {}, en: {} };
  let failed = 0;
  const allRuPrompts = new Set(Object.values(art.ru).flat().map((q) => q.prompt.trim().toLowerCase()));

  for (const m of gradedModules(ru)) {
    if (only && !only.includes(m.key)) continue;
    const i = Number(m.key.slice(1));
    const practice = await practicePromptsForModule(m.id);
    // Другие модули нового банка тоже нельзя повторять.
    for (const q of art.ru[m.key] ?? []) allRuPrompts.delete(q.prompt.trim().toLowerCase());
    const otherGraded = Object.entries(art.ru).filter(([k]) => k !== m.key).flatMap(([, qs]) => qs.map((q) => q.prompt));
    let items: DraftQuestion[] = [];
    let g: Gate | null = null;
    const warnings: string[] = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      console.log(`→ ru ${m.key} «${m.title}» · черновик ${attempt} (doNotReuse: практика ${practice.length}, другие модули ${otherGraded.length})`);
      items = await draftModuleQuiz(m.id, {
        count: 8,
        types: { SINGLE_CHOICE: 8 },
        canonicalKeyPrefix: `polit:M${i}`,
        doNotReuse: [...practice, ...otherGraded],
        onReport: (r: DraftReport) => warnings.push(...r.warnings.map((w) => `ru черновик ${attempt}: ${w}`)),
      });
      g = gate(items);
      const dup = items.filter((q) => allRuPrompts.has(q.prompt.trim().toLowerCase()));
      if (dup.length) g = { ...g, ok: false, problems: [...g.problems, `повтор формулировки другого модуля: ${dup.length}`] };
      console.log(`   гейт: ${g.ok ? 'OK' : g.problems.join('; ')} · ключи ${JSON.stringify(g.keyHistogram)} · testwise ${g.testwise} · max длина ключа ${g.maxLengthRatio}×`);
      if (g.ok) break;
      if (attempt === 1) art.meta.redrafted.push(`${m.key}: ${g.problems.join('; ')}`);
    }
    if (!g?.ok) {
      console.log(`✖ ${m.key}: гейт не пройден после повторного черновика — модуль НЕ попадает в артефакт`);
      failed++;
      continue;
    }
    const ruPortable = items.map((d) => toPortable(ru, d));
    const byLang: Record<string, PortableQuestion[]> = { ru: ruPortable };
    const gates: Record<string, Gate> = { ru: g };
    for (const lang of ['kk', 'en'] as Language[]) {
      const v = version(course, lang);
      let tr: PortableQuestion[] = [];
      let tg: Gate | null = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        console.log(`   перевод ${lang} ${attempt}`);
        const out = await translateQuestions(items, lang, {
          targetVersionId: v.id,
          sourceLanguage: 'ru',
          onReport: (r) => warnings.push(...r.warnings.map((w) => `${lang} перевод ${attempt}: ${w}`)),
        });
        tr = out.map((d) => toPortable(v, d));
        tg = gate(tr);
        const struct = sameStructure(ruPortable, tr);
        if (struct.length) tg = { ...tg, ok: false, problems: [...tg.problems, ...struct] };
        console.log(`   гейт ${lang}: ${tg.ok ? 'OK' : tg.problems.join('; ')} · testwise ${tg.testwise} · max длина ключа ${tg.maxLengthRatio}×`);
        if (tg.ok) break;
      }
      if (!tg!.ok) warnings.push(`${lang}: гейт перевода не пройден — ${tg!.problems.join('; ')} (проверить при ревью)`);
      byLang[lang] = tr;
      gates[lang] = tg!;
    }
    for (const lang of LANGS) art[lang][m.key] = byLang[lang]!;
    for (const q of ruPortable) allRuPrompts.add(q.prompt.trim().toLowerCase());
    art.meta.gates[m.key] = gates;
    art.meta.warnings[m.key] = warnings;
  }
  art.meta.updatedAt = new Date().toISOString();
  const usage = getDraftUsage();
  art.meta.llm = {
    calls: art.meta.llm.calls + usage.calls,
    inputTokens: art.meta.llm.inputTokens + usage.inputTokens,
    outputTokens: art.meta.llm.outputTokens + usage.outputTokens,
    costUsd: art.meta.llm.costUsd + usage.costUsd,
  };
  const out = writeArtifact(args.dataDir, ARTIFACT, art);
  recordSpend(args.dataDir, { script: SCRIPT, at: new Date().toISOString(), ...usage });
  console.log(`\nЧерновик: ${out}`);

  // Читаемый предпросмотр.
  for (const key of Object.keys(art.ru).sort()) {
    console.log(`\n══ ${key} ══`);
    art.ru[key]!.forEach((q, j) => {
      const k = q.correctOptionIds[0]!;
      console.log(`${q.canonicalKey} [${'ABCD'[k]}] ${q.prompt}`);
      q.options.forEach((o, x) => console.log(`     ${x === k ? '*' : ' '} ${'ABCD'[x]}) ${o}`));
      console.log(`     kk: ${art.kk[key]![j]!.prompt.slice(0, 140)}`);
      console.log(`     en: ${art.en[key]![j]!.prompt.slice(0, 140)}`);
    });
  }
  const allRu = Object.values(art.ru).flat();
  console.log(`\nВсе ${allRu.length} ru-вопросов: ключи ${JSON.stringify(keyPositionHistogram(allRu))} · testwise ${round(testwiseScore(allRu), 3)}`);
  return failed ? 1 : 0;
}

/* ── Применение ─────────────────────────────────────────────────── */

async function apply(args: ReturnType<typeof parseArgs>): Promise<number> {
  const art = readArtifact<Artifact>(args.from!);
  const artifactSha = sha256(JSON.stringify(art));
  const report = new Report(SCRIPT, args.apply);
  const course = await loadCourse();
  if (args.apply) await assertPhaseA();

  // Целевые тесты и незавершённые попытки — проверка ДО любых записей.
  const targets: { lang: Language; v: VersionCtx; key: string; quizId: string; items: PortableQuestion[] }[] = [];
  for (const lang of args.langs) {
    const v = version(course, lang);
    for (const m of gradedModules(v)) {
      const items = art[lang]?.[m.key];
      if (!items?.length) {
        report.line(`${lang}:${m.key}`, 'skip', 'нет в артефакте');
        continue;
      }
      const g = gate(items);
      if (!g.ok) {
        report.line(`${lang}:${m.key}`, 'error', `артефакт не проходит гейт: ${g.problems.join('; ')}`);
        continue;
      }
      targets.push({ lang, v, key: m.key, quizId: m.quiz.id, items });
    }
  }
  const inProgress = await prisma.quizAttempt.findMany({
    where: { quizId: { in: targets.map((t) => t.quizId) }, submittedAt: null },
    select: { id: true, quizId: true, startedAt: true, enrollment: { select: { user: { select: { email: true } } } } },
  });
  if (inProgress.length) {
    console.log('✖ У целевых тестов есть НЕЗАВЕРШЁННЫЕ попытки — замена банка отложена:');
    for (const a of inProgress) console.log(`   ${a.id} ${a.enrollment.user.email} тест ${a.quizId} начата ${a.startedAt.toISOString()}`);
    return 1;
  }

  for (const t of targets) {
    const unit = `${t.lang}:${t.key}`;
    const key = ledgerKey(SCRIPT, unit);
    const drafts = t.items.map((p) => fromPortable(t.v, p));
    const missingSource = drafts.filter((d) => !d.sourceLectureId).length;
    const current = await activeQuestions(prisma, t.quizId);
    const sameAsArtifact =
      current.length === t.items.length && current.every((q, i) => q.canonicalKey === t.items[i]!.canonicalKey && q.prompt === t.items[i]!.prompt.trim());
    if (await ledgerGet(prisma, key)) {
      report.line(unit, 'skip', 'уже применено (журнал)');
    } else if (sameAsArtifact) {
      report.line(unit, 'skip', 'вопросы теста уже совпадают с артефактом');
    } else if (!args.apply) {
      report.line(unit, 'would-change', `архив ${current.length} → новые ${drafts.length} (${t.items.map((q) => q.canonicalKey).join(',')})${missingSource ? ` · без источника ${missingSource}` : ''}`);
      continue;
    } else {
      const ids = await writeQuizQuestions(t.quizId, drafts, {
        mode: 'ARCHIVE_REPLACE',
        ledgerKey: key,
        ledgerDetail: { artifact: ARTIFACT, artifactSha256: artifactSha, archived: current.map((q) => q.id) },
      });
      const dismissed = await dismissSystemFlags(prisma, current.map((q) => q.id), 'Вопрос архивирован: заменён каноническим банком (graded-bank)');
      report.line(unit, ids.length ? 'changed' : 'skip', ids.length ? `архив ${current.length} → новые ${ids.length}${dismissed ? ` · снято системных отметок ${dismissed}` : ''}` : 'уже применено (журнал)');
    }
    if (!args.apply) continue;
    // Отметки на проверку для действующих вопросов банка (идемпотентно по dedupeKey).
    const active = await activeQuestions(prisma, t.quizId);
    let flagged = 0;
    await prisma.$transaction(async (tx) => {
      for (const q of active.filter((x) => x.canonicalKey?.startsWith('polit:'))) {
        const created = await flagForReview(tx, {
          reason: t.lang === 'ru' ? 'EXPERT_REVIEW' : 'NATIVE_PROOFREAD',
          targetType: 'QUIZ_QUESTION',
          targetId: q.id,
          courseId: course.courseId,
          languageVersionId: t.v.id,
          comment:
            t.lang === 'ru'
              ? `политолог: единственный верный ответ, корректность дистракторов (${q.canonicalKey})`
              : `проверка перевода (${q.canonicalKey}; оригинал — ru-банк)`,
        });
        if (created) flagged++;
      }
    });
    if (flagged) report.line(`${unit}:flags`, 'changed', `отметок ${t.lang === 'ru' ? 'EXPERT_REVIEW' : 'NATIVE_PROOFREAD'}: ${flagged}`);
  }

  if (args.apply) {
    // Проверка: прошлые попытки пересчитываются по своей presentation (архивные вопросы) в сохранённый балл.
    const rows = await rescoreAttempts(prisma, { quizId: { in: targets.map((t) => t.quizId) } });
    console.log(`\nПересчёт прошлых попыток целевых тестов (${rows.length}):`);
    printRescore(rows);
    if (rows.some((r) => !r.ok)) report.line('rescore', 'error', 'пересчёт прошлых попыток не совпал с сохранённым баллом');
    for (const t of targets) {
      const n = (await activeQuestions(prisma, t.quizId)).length;
      if (n !== t.items.length) report.line(`${t.lang}:${t.key}:count`, 'error', `действующих вопросов ${n}, ожидалось ${t.items.length}`);
    }
  }
  console.log(`\n${report.summary()}`);
  return report.errors ? 1 : 0;
}

async function main(): Promise<number> {
  const args = parseArgs(SCRIPT, { llm: true });
  if (args.draft) return draft(args);
  if (!args.from) {
    console.log('Укажите --draft (черновик через LLM) или --from graded-bank.v1.json (применение/предпросмотр).');
    return 2;
  }
  return apply(args);
}

run(main);
