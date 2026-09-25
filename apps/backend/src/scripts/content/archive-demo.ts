/**
 * Фаза 1h: архивирование демо-курса «Основы критического мышления» (лекции-заглушки,
 * видео Rick Astley) — версии и курс получают ARCHIVED, как POST /language-versions/:id/archive
 * (FR-2.5); в аудит пишется COURSE_ARCHIVED от имени автора курса с пометкой via=cli.
 * Данные студентов не удаляются. Если по курсу есть попытки или сессии — скрипт их
 * перечисляет и требует --force (попытки не демо-аккаунтов помечаются отдельно).
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/archive-demo.ts [--apply --i-have-a-backup --force]
 */
import { Report, ledgerGet, ledgerKey, ledgerPut, parseArgs, prisma, run, writePreview } from './lib.js';

const SCRIPT = 'archive-demo';
const DEMO_TITLE = 'Основы критического мышления';
/** Демо-аккаунты стенда (их данные демо-курса ожидаемы). */
const DEMO_ACCOUNTS = new Set(['student@edu.kz', 'student2@edu.kz', 'manager@edu.kz', 'admin@edu.kz']);

async function main(): Promise<number> {
  const args = parseArgs(SCRIPT);
  const report = new Report(SCRIPT, args.apply);
  const anchor = await prisma.courseLanguageVersion.findFirst({ where: { title: DEMO_TITLE }, select: { courseId: true } });
  if (!anchor) {
    report.line('demo', 'skip', `курса «${DEMO_TITLE}» нет`);
    console.log(`\n${report.summary()}`);
    return 0;
  }
  const course = await prisma.course.findUniqueOrThrow({
    where: { id: anchor.courseId },
    include: { languageVersions: { select: { id: true, language: true, title: true, status: true } } },
  });
  const enrollments = await prisma.enrollment.findMany({
    where: { courseId: course.id },
    select: {
      id: true,
      status: true,
      user: { select: { email: true } },
      quizAttempts: { select: { id: true, score: true, submittedAt: true, quiz: { select: { title: true } } } },
      practicalSessions: { select: { id: true, status: true } },
    },
  });
  const withData = enrollments.filter((e) => e.quizAttempts.length || e.practicalSessions.length);
  const foreign = withData.filter((e) => !DEMO_ACCOUNTS.has(e.user.email));
  console.log(`Курс «${DEMO_TITLE}» (${course.status}); версий ${course.languageVersions.length}; записей ${enrollments.length}; с попытками/сессиями ${withData.length}`);
  for (const e of withData) {
    const who = DEMO_ACCOUNTS.has(e.user.email) ? 'демо-аккаунт' : 'НЕ демо-аккаунт';
    console.log(`   ${e.user.email} (${who}, запись ${e.status}): попыток ${e.quizAttempts.length}, сессий ${e.practicalSessions.length}`);
    for (const a of e.quizAttempts) console.log(`      попытка ${a.id} «${a.quiz.title}» балл ${a.score}${a.submittedAt ? '' : ' (не отправлена)'}`);
    for (const s of e.practicalSessions) console.log(`      сессия ${s.id} ${s.status}`);
  }

  const toArchive = course.languageVersions.filter((v) => v.status !== 'ARCHIVED');
  if (!toArchive.length && course.status === 'ARCHIVED') {
    report.line('demo', 'skip', 'курс и версии уже ARCHIVED');
  } else if (withData.length && !args.force) {
    report.line('demo', 'error', `есть попытки/сессии (${withData.length} записей, из них не демо-аккаунтов: ${foreign.length}) — перечислены выше; архивирование только с --force`);
  } else if (!args.apply) {
    report.line('demo', 'would-change', `ARCHIVED: курс + версии ${toArchive.map((v) => v.language).join(',')}; данные студентов сохраняются`);
  } else {
    const key = ledgerKey(SCRIPT, course.id);
    await prisma.$transaction(async (tx) => {
      for (const v of toArchive) {
        await tx.courseLanguageVersion.update({ where: { id: v.id }, data: { status: 'ARCHIVED' } });
        await tx.auditLog.create({
          data: { actorId: course.createdById, action: 'COURSE_ARCHIVED', targetType: 'CourseLanguageVersion', targetId: v.id, detail: { via: 'cli', script: SCRIPT } },
        });
      }
      await tx.course.update({ where: { id: course.id }, data: { status: 'ARCHIVED' } });
      if (!(await ledgerGet(tx, key))) {
        await ledgerPut(tx, key, { versions: toArchive.map((v) => v.id), attemptsKept: withData.map((e) => e.user.email), forced: args.force });
      }
    });
    report.line('demo', 'changed', `ARCHIVED: курс + версии ${toArchive.map((v) => v.language).join(',')}`);
  }

  console.log(`\n${report.summary()}`);
  if (!args.apply) console.log(`Предпросмотр: ${writePreview(args, { course: course.id, withData: withData.map((e) => e.user.email), foreign: foreign.map((e) => e.user.email) })}`);
  return report.errors ? 1 : 0;
}

run(main);
