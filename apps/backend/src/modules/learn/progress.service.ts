import { prisma } from '../../lib/prisma.js';
import { issueCertificateIfAbsent } from '../certificates/certificate.service.js';

/**
 * Пересчёт прогресса записи на курс (FR-8.2, FR-8.3).
 * Правило завершения: все лекции просмотрены + все итоговые оценивания сданы
 * (тест — passed; практическое — сессия PASSED).
 */
export async function recomputeProgress(enrollmentId: string): Promise<{ percent: number; completed: boolean }> {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      languageVersion: { include: { modules: { include: { lectures: true, quiz: true, practicalTask: true } } } },
      lectureProgress: true,
      quizAttempts: true,
      practicalSessions: true,
    },
  });
  if (!enrollment) return { percent: 0, completed: false };

  const modules = enrollment.languageVersion.modules;
  const allLectures = modules.flatMap((m) => m.lectures);
  const quizzes = modules.map((m) => m.quiz).filter((q): q is NonNullable<typeof q> => !!q);
  const practicals = modules.map((m) => m.practicalTask).filter((p): p is NonNullable<typeof p> => !!p);

  const completedLectureIds = new Set(enrollment.lectureProgress.filter((p) => p.isCompleted).map((p) => p.lectureId));
  const lecturesDone = allLectures.filter((l) => completedLectureIds.has(l.id)).length;

  const passedQuizIds = new Set(enrollment.quizAttempts.filter((a) => a.passed).map((a) => a.quizId));
  const quizzesDone = quizzes.filter((q) => passedQuizIds.has(q.id)).length;

  const passedPracticalTaskIds = new Set(enrollment.practicalSessions.filter((s) => s.status === 'PASSED').map((s) => s.practicalTaskId));
  const practicalsDone = practicals.filter((t) => passedPracticalTaskIds.has(t.id)).length;

  const totalItems = allLectures.length + quizzes.length + practicals.length;
  const doneItems = lecturesDone + quizzesDone + practicalsDone;
  const percent = totalItems ? Math.round((doneItems / totalItems) * 100) : 0;

  const completed =
    allLectures.length === lecturesDone && quizzes.length === quizzesDone && practicals.length === practicalsDone && totalItems > 0;

  await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: { progressPercent: percent, status: completed ? 'COMPLETED' : 'ACTIVE', completedAt: completed ? new Date() : null },
  });

  if (completed) await issueCertificateIfAbsent(enrollmentId); // FR-9.1

  return { percent, completed };
}
