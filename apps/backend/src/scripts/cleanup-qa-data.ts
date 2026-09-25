/**
 * Разовая очистка хвостов QA-проверок из БД (без reset, точечно по пользователям).
 *
 * По умолчанию — ПРЕДПРОСМОТР: какие аккаунты и сколько строк будет удалено. Запись —
 * только с флагом --apply, одной транзакцией. Перед --apply сделайте дамп БД.
 *
 * Кто удаляется:
 *  - тестовые аккаунты по домену email (research/testAccounts.ts: example.com и др.),
 *    кроме одноразовых пользователей идущих фиксеров qa-fx-… (их удаляют сами фиксеры;
 *    --include-fixers — удалить и их);
 *  - дополнительные адреса из --also a@b,c@d (явно тестовые аккаунты с «настоящим» доменом).
 * Демо-аккаунты (student@edu.kz и др.) и сотрудники с ролью ADMIN не удаляются никогда.
 *
 * Что удаляется вместе с аккаунтом: события (EventLog) пользователя и его записей,
 * аудит, где он автор или объект (сам аккаунт или его запись на курс), жалобы на контент
 * из его записей, записи на курс каскадом (прогресс лекций, попытки тестов, сессии
 * практикума с репликами, сертификаты), refresh-токены. Курсы, задания генерации и
 * занятия с преподавателем, созданные таким аккаунтом, скрипт НЕ трогает — при их
 * наличии он останавливается (разобрать вручную).
 *
 * Демо-студенты (по отдельным флагам; оба — только для student@edu.kz / student2@edu.kz):
 *  --demo-sessions id1,id2 — удалить эти сессии практикума демо-студентов и их события;
 *  --demo-quiz-window FROM,TO (ISO) — удалить события QUIZ_* демо-студентов за этот период,
 *    не ссылающиеся на существующую попытку (осиротевшая телеметрия QA-прогонов).
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/cleanup-qa-data.ts [--also …] [--apply]
 */
import { PrismaClient } from '@prisma/client';
import { isTestAccountEmail } from '../modules/research/testAccounts.js';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const INCLUDE_FIXERS = args.includes('--include-fixers');
const listArg = (name: string): string[] => {
  const i = args.indexOf(name);
  return i === -1 ? [] : String(args[i + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
};
const ALSO = listArg('--also').map((e) => e.toLowerCase());
const DEMO_SESSIONS = listArg('--demo-sessions');
const DEMO_WINDOW = listArg('--demo-quiz-window').map((d) => new Date(d));
if (DEMO_WINDOW.length && (DEMO_WINDOW.length !== 2 || DEMO_WINDOW.some((d) => Number.isNaN(d.getTime())))) {
  throw new Error('--demo-quiz-window: ожидается FROM,TO в ISO, например 2026-09-25T08:53:00Z,2026-09-25T09:25:00Z');
}

/** Демо-аккаунты сида — не удаляются никогда. */
const DEMO_ACCOUNTS = ['admin@edu.kz', 'manager@edu.kz', 'student@edu.kz', 'student2@edu.kz'];
const DEMO_STUDENTS = ['student@edu.kz', 'student2@edu.kz'];

async function main() {
  const all = await prisma.user.findMany({ select: { id: true, email: true, role: true, name: true, createdAt: true } });
  const selected = all.filter((u) => {
    const email = u.email.toLowerCase();
    if (DEMO_ACCOUNTS.includes(email) || u.role === 'ADMIN') return false;
    if (ALSO.includes(email)) return true;
    if (!isTestAccountEmail(email)) return false;
    return INCLUDE_FIXERS || !email.startsWith('qa-fx-');
  });
  const missing = ALSO.filter((e) => !all.some((u) => u.email.toLowerCase() === e));
  if (missing.length) console.log(`⚠ Не найдены (пропущены): ${missing.join(', ')}`);

  const userIds = selected.map((u) => u.id);
  const enrollmentIds = (await prisma.enrollment.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((e) => e.id);
  const targetIds = [...userIds, ...enrollmentIds];

  console.log(`Аккаунтов к удалению: ${selected.length}`);
  for (const u of selected.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    console.log(`  - ${u.email} (${u.role}, ${u.name}, ${u.createdAt.toISOString()})`);
  }

  // Созданное такими аккаунтами, что каскадом не удаляется, — разбирать вручную.
  const [courses, jobs, teacherSessions] = await Promise.all([
    prisma.course.count({ where: { createdById: { in: userIds } } }),
    prisma.generationJob.count({ where: { createdById: { in: userIds } } }),
    prisma.teacherSession.count({ where: { loggedById: { in: userIds } } }),
  ]);
  if (courses + jobs + teacherSessions > 0) {
    throw new Error(`Аккаунты создали курсы (${courses}), задания генерации (${jobs}) или занятия (${teacherSessions}) — разберите вручную`);
  }

  const eventsWhere = { OR: [{ userId: { in: userIds } }, { enrollmentId: { in: enrollmentIds } }] };
  const auditWhere = { OR: [{ actorId: { in: userIds } }, { targetId: { in: targetIds } }] };
  const issuesWhere = { OR: [{ reporterId: { in: userIds } }, { enrollmentId: { in: enrollmentIds } }] };
  const counts = {
    enrollments: enrollmentIds.length,
    quizAttempts: await prisma.quizAttempt.count({ where: { enrollmentId: { in: enrollmentIds } } }),
    practicalSessions: await prisma.practicalSession.count({ where: { enrollmentId: { in: enrollmentIds } } }),
    lectureProgress: await prisma.lectureProgress.count({ where: { enrollmentId: { in: enrollmentIds } } }),
    certificates: await prisma.certificate.count({ where: { enrollmentId: { in: enrollmentIds } } }),
    events: await prisma.eventLog.count({ where: eventsWhere }),
    audit: await prisma.auditLog.count({ where: auditWhere }),
    contentIssues: await prisma.contentIssue.count({ where: issuesWhere }),
    refreshTokens: await prisma.refreshToken.count({ where: { userId: { in: userIds } } }),
  };
  console.log('Связанные строки:', counts);

  // Демо-студенты: только явно названные сессии и осиротевшая телеметрия тестов.
  const demo = await prisma.user.findMany({ where: { email: { in: DEMO_STUDENTS } }, select: { id: true } });
  const demoIds = demo.map((u) => u.id);
  const demoSessions = DEMO_SESSIONS.length
    ? await prisma.practicalSession.findMany({ where: { id: { in: DEMO_SESSIONS }, enrollment: { userId: { in: demoIds } } }, select: { id: true } })
    : [];
  if (demoSessions.length !== DEMO_SESSIONS.length) throw new Error('--demo-sessions: не все сессии найдены у демо-студентов');
  const demoSessionIds = demoSessions.map((s) => s.id);
  const demoSessionEvents = demoSessionIds.length ? await prisma.eventLog.count({ where: { sessionId: { in: demoSessionIds } } }) : 0;
  let orphanEventIds: string[] = [];
  if (DEMO_WINDOW.length === 2) {
    const quizEvents = await prisma.eventLog.findMany({
      where: { userId: { in: demoIds }, eventType: { startsWith: 'QUIZ_' }, createdAt: { gte: DEMO_WINDOW[0], lte: DEMO_WINDOW[1] } },
      select: { id: true, payload: true },
    });
    const attemptOf = (p: unknown) => (p && typeof p === 'object' && typeof (p as { attemptId?: unknown }).attemptId === 'string' ? (p as { attemptId: string }).attemptId : null);
    const referenced = [...new Set(quizEvents.map((e) => attemptOf(e.payload)).filter((x): x is string => !!x))];
    const existing = new Set((await prisma.quizAttempt.findMany({ where: { id: { in: referenced } }, select: { id: true } })).map((a) => a.id));
    // Без attemptId (старый формат) или со ссылкой на удалённую попытку — осиротевшие.
    orphanEventIds = quizEvents.filter((e) => {
      const a = attemptOf(e.payload);
      return a === null || !existing.has(a);
    }).map((e) => e.id);
  }
  if (DEMO_SESSIONS.length || DEMO_WINDOW.length) {
    console.log(`Демо-студенты: сессий ${demoSessionIds.length} (событий ${demoSessionEvents}), осиротевших событий QUIZ_* ${orphanEventIds.length}`);
  }

  if (!APPLY) {
    console.log('\nПредпросмотр. Для удаления — повторить с --apply (сначала сделайте дамп БД).');
    return;
  }

  const res = await prisma.$transaction(async (tx) => {
    const events = await tx.eventLog.deleteMany({ where: eventsWhere });
    const audit = await tx.auditLog.deleteMany({ where: auditWhere });
    const issues = await tx.contentIssue.deleteMany({ where: issuesWhere });
    // Записи на курс — каскадом: прогресс, попытки, сессии с репликами, сертификаты.
    const enrollments = await tx.enrollment.deleteMany({ where: { id: { in: enrollmentIds } } });
    const users = await tx.user.deleteMany({ where: { id: { in: userIds } } });
    const demoEvents = await tx.eventLog.deleteMany({ where: { OR: [{ sessionId: { in: demoSessionIds } }, { id: { in: orphanEventIds } }] } });
    const demoSess = await tx.practicalSession.deleteMany({ where: { id: { in: demoSessionIds } } });
    return { users: users.count, enrollments: enrollments.count, events: events.count, audit: audit.count, contentIssues: issues.count, demoEvents: demoEvents.count, demoSessions: demoSess.count };
  }, { timeout: 60_000 });
  console.log('Удалено:', res);
}

main()
  .catch((err) => {
    console.error('❌', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
