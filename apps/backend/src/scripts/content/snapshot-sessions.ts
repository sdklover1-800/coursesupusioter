/**
 * Фаза A — ДО любых других записей контент-скриптов: фиксирует, на чём проходили
 * старые попытки и сессии, чтобы последующие правки контента не меняли их смысл.
 *
 *  - PracticalSession без taskSnapshot → PracticalTaskSnapshot ТЕКУЩЕГО содержания задания
 *    (capturedAt = сейчас; в журнале — пометка backfilled: снимок сделан задним числом);
 *  - QuizAttempt без presentation → {version:1, questionIds: действующие вопросы теста по
 *    orderIndex, optionOrder: тождественный, seed: null} — ровно то, что BE2 показывает
 *    устаревшей попытке сейчас;
 *  - проверка: балл каждой отправленной попытки, пересчитанный по новой presentation, равен
 *    сохранённому; любое расхождение — отказ БЕЗ записи попыток.
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/snapshot-sessions.ts [--apply --i-have-a-backup]
 */
import { createHash } from 'node:crypto';
import type { AttemptPresentation, PracticalTaskSnapshot } from '@edu/shared';
import { Prisma } from '@prisma/client';
import { parseStoredAnswers, presentedQuestions, toPolicyQuestion } from '../../modules/quizzes/policy.js';
import { scoreQuiz } from '../../modules/quizzes/scoring.js';
import { PHASE_A_DONE_KEY, Report, ledgerGet, ledgerKey, ledgerPut, parseArgs, prisma, rescoreAttempts, printRescore, round, run, writePreview } from './lib.js';

const SCRIPT = 'snapshot-sessions';

async function main(): Promise<number> {
  const args = parseArgs(SCRIPT);
  const report = new Report(SCRIPT, args.apply);
  const preview: Record<string, unknown[]> = { sessions: [], attempts: [] };

  /* ── Сессии практикума ── */
  const sessions = await prisma.practicalSession.findMany({
    where: { taskSnapshot: { equals: Prisma.DbNull } },
    include: { practicalTask: true, enrollment: { select: { user: { select: { email: true } } } } },
    orderBy: { startedAt: 'asc' },
  });
  for (const s of sessions) {
    const unit = `session:${s.id}`;
    const key = ledgerKey(SCRIPT, unit);
    const t = s.practicalTask;
    const snapshot: PracticalTaskSnapshot = {
      capturedAt: new Date().toISOString(),
      canonicalRef: t.canonicalRef ?? null,
      title: t.title,
      scenarioPrompt: t.scenarioPrompt,
      rubricSpec: t.rubricSpec,
      referenceSolutionSha256: createHash('sha256').update(t.referenceSolution).digest('hex'),
    };
    preview.sessions!.push({ sessionId: s.id, email: s.enrollment.user.email, status: s.status, task: t.title, snapshotTitle: snapshot.title });
    const info = `${s.enrollment.user.email} · ${s.status} · «${t.title.slice(0, 60)}»`;
    if (!args.apply) {
      report.line(unit, 'would-change', `снимок текущего задания · ${info}`);
      continue;
    }
    const done = await prisma.$transaction(async (tx) => {
      const cur = await tx.practicalSession.findUniqueOrThrow({ where: { id: s.id }, select: { taskSnapshot: true } });
      if (cur.taskSnapshot !== null || (await ledgerGet(tx, key))) return false;
      await tx.practicalSession.update({ where: { id: s.id }, data: { taskSnapshot: snapshot as unknown as Prisma.InputJsonValue } });
      await ledgerPut(tx, key, { backfilled: true, taskId: t.id, capturedAt: snapshot.capturedAt, note: 'снимок задания сделан задним числом (фаза A)' });
      return true;
    });
    report.line(unit, done ? 'changed' : 'skip', done ? `снимок записан (backfilled) · ${info}` : 'уже есть снимок');
  }
  if (!sessions.length) report.line('sessions', 'skip', 'у всех сессий уже есть taskSnapshot');

  /* ── Попытки тестов ── */
  const attempts = await prisma.quizAttempt.findMany({
    where: { presentation: { equals: Prisma.DbNull } },
    include: {
      quiz: { include: { questions: true } },
      enrollment: { select: { user: { select: { email: true } } } },
    },
    orderBy: { startedAt: 'asc' },
  });
  const planned: { id: string; presentation: AttemptPresentation; info: string }[] = [];
  let mismatches = 0;
  console.log(`\nПопыток без presentation: ${attempts.length}. Проверка пересчёта балла:`);
  for (const a of attempts) {
    const questions = a.quiz.questions.map((q) => toPolicyQuestion(q));
    const active = questions.filter((q) => q.archivedAt === null).sort((x, y) => x.orderIndex - y.orderIndex);
    const presentation: AttemptPresentation = {
      version: 1,
      questionIds: active.map((q) => q.id),
      optionOrder: Object.fromEntries(active.map((q) => [q.id, q.options.map((_, i) => i)])),
      seed: null,
    };
    const answers = parseStoredAnswers(a.answers);
    const presented = presentedQuestions({ presentation }, questions);
    const scored = scoreQuiz(
      presented.map((q) => ({ id: q.id, correctOptionIds: q.correctOptionIds })),
      answers,
      a.quiz.passThreshold,
    );
    const unknown = Object.keys(answers).filter((qid) => !presentation.questionIds.includes(qid));
    const submitted = a.submittedAt !== null;
    const ok = !submitted || (Math.abs(scored.score - a.score) < 1e-9 && unknown.length === 0);
    if (!ok) mismatches++;
    const info = `${a.enrollment.user.email} «${a.quiz.title.slice(0, 50)}» stored ${round(a.score, 4)} → ${round(scored.score, 4)}${submitted ? '' : ' (не отправлена)'}${unknown.length ? ` · ответы на вопросы вне набора: ${unknown.length}` : ''}`;
    console.log(`   ${ok ? '=' : '≠'} ${a.id} ${info}`);
    planned.push({ id: a.id, presentation, info });
    preview.attempts!.push({ attemptId: a.id, email: a.enrollment.user.email, quiz: a.quiz.title, stored: a.score, rescored: scored.score, ok, presentation });
  }
  if (mismatches) {
    console.log(`\n✖ Пересчёт не совпал у ${mismatches} попыток — presentation НЕ записываются (разберите вручную).`);
    for (const p of planned) report.line(`attempt:${p.id}`, 'error', 'отказ: есть расхождения пересчёта');
  } else {
    for (const p of planned) {
      const unit = `attempt:${p.id}`;
      const key = ledgerKey(SCRIPT, unit);
      if (!args.apply) {
        report.line(unit, 'would-change', `presentation (${p.presentation.questionIds.length} вопросов, тождественный порядок) · ${p.info}`);
        continue;
      }
      const done = await prisma.$transaction(async (tx) => {
        const cur = await tx.quizAttempt.findUniqueOrThrow({ where: { id: p.id }, select: { presentation: true } });
        if (cur.presentation !== null || (await ledgerGet(tx, key))) return false;
        await tx.quizAttempt.update({ where: { id: p.id }, data: { presentation: p.presentation as unknown as Prisma.InputJsonValue } });
        await ledgerPut(tx, key, { backfilled: true, questionIds: p.presentation.questionIds });
        return true;
      });
      report.line(unit, done ? 'changed' : 'skip', done ? `presentation записана · ${p.info}` : 'уже есть presentation');
    }
  }
  if (!attempts.length) report.line('attempts', 'skip', 'у всех попыток уже есть presentation');

  /* ── Итог: пересчёт ВСЕХ попыток по записанным presentation ── */
  if (args.apply && !mismatches) {
    const rows = await rescoreAttempts(prisma);
    console.log('\nПересчёт всех отправленных попыток после записи:');
    printRescore(rows);
    const bad = rows.filter((r) => !r.ok);
    const leftSessions = await prisma.practicalSession.count({ where: { taskSnapshot: { equals: Prisma.DbNull } } });
    const leftAttempts = await prisma.quizAttempt.count({ where: { presentation: { equals: Prisma.DbNull } } });
    if (!bad.length && !leftSessions && !leftAttempts && !(await ledgerGet(prisma, PHASE_A_DONE_KEY))) {
      await ledgerPut(prisma, PHASE_A_DONE_KEY, { sessions: sessions.length, attempts: attempts.length, at: new Date().toISOString() });
      report.line('done', 'changed', 'фаза A завершена (ключ журнала записан)');
    } else if (bad.length || leftSessions || leftAttempts) {
      report.line('done', 'error', `осталось: сессий без снимка ${leftSessions}, попыток без presentation ${leftAttempts}, расхождений ${bad.length}`);
    } else {
      report.line('done', 'skip', 'фаза A уже отмечена в журнале');
    }
  }

  console.log(`\n${report.summary()}`);
  if (!args.apply) console.log(`Предпросмотр: ${writePreview(args, preview)}`);
  return report.errors ? 1 : 0;
}

run(main);
