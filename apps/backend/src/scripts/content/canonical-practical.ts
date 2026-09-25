/**
 * Фаза 2c (USER_DECISIONS §4): ОДИН канонический сценарий итогового практикума на все языки —
 * русская «Полисия», переведённая на kk и en с теми же ключевыми тезисами рубрики (1:1).
 *
 * Черновик (--draft): translatePracticalTask(ruTaskId, 'kk'|'en') → canonical-practical.v1.json;
 *  проверки: тезисов столько же, сколько в ru (9), есть answer_reached_criteria; kk — только «Сіз»,
 *  без «сен/сенің» и «ауызша» (задание письменное) — найденное правится в JSON при ревью.
 *  ru-содержание тоже кладётся в артефакт: на проде задание приводится к тому же канону.
 * Применение (--from canonical-practical.v1.json [--apply --i-have-a-backup]):
 *  - требует фазу A (старые сессии уже со снимком задания);
 *  - kk/en: название (localizedTitle), сценарий, эталон, рубрика, план беседы, isEdited=true,
 *    canonicalRef 'polisia-v1', бюджеты 1f, maxSessions 2, maxAiMessages 24, estimatedMinutes 25;
 *  - ru: canonicalRef, название и те же настройки (содержание — из артефакта, если отличается);
 *  - отметки: kk/en — NATIVE_PROOFREAD, ru — EXPERT_REVIEW («утвердить канонический сценарий»).
 * После применения — харнесс BE3: src/scripts/eval-judge.ts --task-bound --lang ru,kk,en --budget-usd 1.5.
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/canonical-practical.ts --draft
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/canonical-practical.ts --from canonical-practical.v1.json [--apply --i-have-a-backup]
 */
import type { Prisma } from '@prisma/client';
import type { Language } from '@edu/shared';
import { getDraftUsage, localizedTitle, translatePracticalTask } from '../../generation/drafts.js';
import {
  CANONICAL_REF,
  PRACTICAL_CONFIG,
  Report,
  assertPhaseA,
  flagForReview,
  ledgerGet,
  ledgerKey,
  ledgerPut,
  loadCourse,
  parseArgs,
  practicalModule,
  prisma,
  readArtifact,
  recordSpend,
  run,
  sha256,
  version,
  writeArtifact,
} from './lib.js';

const SCRIPT = 'canonical-practical';
const ARTIFACT = 'canonical-practical.v1.json';

interface TaskContent {
  title: string;
  scenarioPrompt: string;
  referenceSolution: string;
  rubricSpec: { key_points: string[]; answer_reached_criteria: string; [k: string]: unknown };
  introMessage: string | null;
}

interface Artifact {
  meta: { version: 1; createdAt: string; canonicalRef: string; llm: ReturnType<typeof getDraftUsage>; warnings: Record<string, string[]>; reviewEdits: string[] };
  ru: TaskContent;
  kk: TaskContent;
  en: TaskContent;
}

const INFORMAL_KK = /(^|[^\p{L}])(сен|сенің|саған|сені|сенде|сенен)(?=[^\p{L}]|$)/giu;

function checks(lang: Language, t: TaskContent, ruCount: number): string[] {
  const out: string[] = [];
  if (t.rubricSpec.key_points.length !== ruCount) out.push(`тезисов ${t.rubricSpec.key_points.length}, в ru ${ruCount}`);
  if (!t.rubricSpec.answer_reached_criteria?.trim()) out.push('нет answer_reached_criteria');
  if (lang === 'kk') {
    const all = [t.scenarioPrompt, t.referenceSolution, ...t.rubricSpec.key_points, t.rubricSpec.answer_reached_criteria, t.introMessage ?? ''].join('\n');
    const informal = all.match(INFORMAL_KK);
    if (informal) out.push(`обращение на «сен»: ${[...new Set(informal.map((x) => x.trim()))].join(', ')}`);
    if (/ауызша/iu.test(all)) out.push('слово «ауызша»');
  }
  return out;
}

async function ruTask() {
  const course = await loadCourse();
  const m = practicalModule(version(course, 'ru'));
  if (!m?.practicalTask) throw new Error('У ru-версии нет итогового практического задания');
  return { course, task: await prisma.practicalTask.findUniqueOrThrow({ where: { id: m.practicalTask.id } }) };
}

async function draft(args: ReturnType<typeof parseArgs>): Promise<number> {
  const { task } = await ruTask();
  const rubric = task.rubricSpec as TaskContent['rubricSpec'];
  if (!Array.isArray(rubric?.key_points) || !rubric.answer_reached_criteria) throw new Error('ru-рубрика без key_points/answer_reached_criteria');
  if (!/Полиси/u.test(task.scenarioPrompt)) throw new Error('ru-задание — не сценарий «Полисия»: канон не определён');
  const ru: TaskContent = {
    title: localizedTitle('PRACTICAL', 'ru'),
    scenarioPrompt: task.scenarioPrompt,
    referenceSolution: task.referenceSolution,
    rubricSpec: rubric,
    introMessage: task.introMessage,
  };
  const art: Artifact = {
    meta: { version: 1, createdAt: new Date().toISOString(), canonicalRef: CANONICAL_REF, llm: getDraftUsage(), warnings: {}, reviewEdits: [] },
    ru,
    kk: ru,
    en: ru,
  };
  for (const lang of ['kk', 'en'] as Language[]) {
    console.log(`→ перевод ${lang}`);
    const t = await translatePracticalTask(task.id, lang);
    const content: TaskContent = {
      title: t.title,
      scenarioPrompt: t.scenarioPrompt,
      referenceSolution: t.referenceSolution,
      rubricSpec: t.rubricSpec as TaskContent['rubricSpec'],
      introMessage: t.introMessage,
    };
    art[lang] = content;
    art.meta.warnings[lang] = [...t.warnings, ...checks(lang, content, rubric.key_points.length)];
    console.log(`   тезисов ${content.rubricSpec.key_points.length}/${rubric.key_points.length} · предупреждения: ${art.meta.warnings[lang]!.join('; ') || 'нет'}`);
  }
  art.meta.llm = getDraftUsage();
  const path = writeArtifact(args.dataDir, ARTIFACT, art, { overwriteReviewed: args.has('--overwrite-reviewed') });
  recordSpend(args.dataDir, { script: SCRIPT, at: new Date().toISOString(), ...getDraftUsage() });
  console.log(`\nЧерновик: ${path}`);
  for (const lang of ['kk', 'en'] as Language[]) {
    console.log(`\n══ ${lang}: ${art[lang].title} ══\n${art[lang].scenarioPrompt}\n— тезисы:`);
    art[lang].rubricSpec.key_points.forEach((k, i) => console.log(`   ${i + 1}. ${k}`));
    console.log(`— критерий: ${art[lang].rubricSpec.answer_reached_criteria}`);
  }
  return 0;
}

async function apply(args: ReturnType<typeof parseArgs>): Promise<number> {
  const art = readArtifact<Artifact>(args.from!);
  const report = new Report(SCRIPT, args.apply);
  const course = await loadCourse();
  if (args.apply) await assertPhaseA();
  const ruCount = art.ru.rubricSpec.key_points.length;
  for (const lang of args.langs) {
    const unit = `practical:${lang}`;
    const content = art[lang];
    const problems = checks(lang, content, ruCount);
    if (problems.length) {
      report.line(unit, 'error', `артефакт не прошёл проверки: ${problems.join('; ')}`);
      continue;
    }
    const v = version(course, lang);
    const m = practicalModule(v);
    if (!m?.practicalTask) {
      report.line(unit, 'error', 'у версии нет практического задания');
      continue;
    }
    const cur = await prisma.practicalTask.findUniqueOrThrow({ where: { id: m.practicalTask.id } });
    const cfg = PRACTICAL_CONFIG[lang];
    const data = {
      title: localizedTitle('PRACTICAL', lang),
      scenarioPrompt: content.scenarioPrompt,
      referenceSolution: content.referenceSolution,
      rubricSpec: content.rubricSpec as Prisma.InputJsonValue,
      agenda: cfg.agenda,
      introMessage: content.introMessage,
      isEdited: true,
      canonicalRef: art.meta.canonicalRef,
      tokenBudget: cfg.tokenBudget,
      maxAiMessages: cfg.maxAiMessages,
      maxSessions: cfg.maxSessions,
      estimatedMinutes: cfg.estimatedMinutes,
    };
    const diff = (Object.keys(data) as (keyof typeof data)[]).filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(data[k]));
    const key = ledgerKey(SCRIPT, unit);
    const applied = await ledgerGet(prisma, key);
    if (!diff.length) {
      report.line(unit, 'skip', `уже канон ${art.meta.canonicalRef} (тезисов ${ruCount})`);
    } else if (applied && !args.force) {
      report.line(unit, 'skip', `применено ранее, затем изменено вручную (${diff.join(', ')}) — не трогаю без --force`);
      continue;
    } else if (!args.apply) {
      const running = await prisma.practicalSession.count({ where: { practicalTaskId: cur.id, status: 'IN_PROGRESS' } });
      report.line(unit, 'would-change', `${diff.join(', ')}${running ? ` · идущих сессий ${running} (у них свой снимок задания)` : ''}`);
      continue;
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.practicalTask.update({ where: { id: cur.id }, data });
        const detail = { taskId: cur.id, fields: diff, beforeScenarioSha256: sha256(cur.scenarioPrompt), afterScenarioSha256: sha256(content.scenarioPrompt) };
        if (applied) await tx.contentMigration.update({ where: { key }, data: { detail: { ...detail, forced: true } } });
        else await ledgerPut(tx, key, detail);
      });
      report.line(unit, 'changed', diff.join(', '));
    }
    if (!args.apply) continue;
    const created = await flagForReview(prisma, {
      reason: lang === 'ru' ? 'EXPERT_REVIEW' : 'NATIVE_PROOFREAD',
      targetType: 'PRACTICAL_TASK',
      targetId: cur.id,
      courseId: course.courseId,
      languageVersionId: v.id,
      comment:
        lang === 'ru'
          ? `утвердить канонический сценарий «Полисия» (${art.meta.canonicalRef}): условие, эталон и 9 тезисов рубрики`
          : `вычитка перевода канонического сценария «Полисия» (${art.meta.canonicalRef}); тезисы рубрики 1:1 с ru`,
    });
    if (created) report.line(`${unit}:flag`, 'changed', lang === 'ru' ? 'EXPERT_REVIEW' : 'NATIVE_PROOFREAD');
  }
  console.log(`\n${report.summary()}`);
  return report.errors ? 1 : 0;
}

async function main(): Promise<number> {
  const args = parseArgs(SCRIPT, { llm: true });
  if (args.draft) return draft(args);
  if (!args.from) {
    console.log('Укажите --draft (черновик через LLM) или --from canonical-practical.v1.json (применение/предпросмотр).');
    return 2;
  }
  return apply(args);
}

run(main);
