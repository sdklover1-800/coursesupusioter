import { prisma } from '../../lib/prisma.js';
import { Errors } from '../../lib/errors.js';

/**
 * Контроль доступа студента к учебным ресурсам (аудит H2 — IDOR).
 * Проверять принадлежность enrollment пользователю НЕДОСТАТОЧНО: нужно ещё
 * убедиться, что запрошенный ресурс (лекция/тест/практическое) относится к
 * языковой версии этого enrollment, иначе по своему enrollmentId можно вытащить
 * чужой контент и ключи ответов.
 */

export interface OwnedEnrollment {
  id: string;
  userId: string;
  languageVersionId: string;
}

/** Загружает enrollment, проверяя владение и что версия опубликована. */
export async function loadOwnedEnrollment(userId: string, enrollmentId: string): Promise<OwnedEnrollment> {
  const e = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { languageVersion: { select: { status: true } } },
  });
  if (!e || e.userId !== userId) throw Errors.forbidden('Запись на курс не принадлежит пользователю');
  if (e.languageVersion.status !== 'PUBLISHED') throw Errors.forbidden('Курс недоступен');
  return { id: e.id, userId: e.userId, languageVersionId: e.languageVersionId };
}

/** Проверяет, что лекция входит в языковую версию enrollment. */
export async function assertLectureInEnrollment(lectureId: string, enr: OwnedEnrollment): Promise<void> {
  const lecture = await prisma.lecture.findUnique({
    where: { id: lectureId },
    select: { module: { select: { courseLanguageVersionId: true } } },
  });
  if (!lecture || lecture.module.courseLanguageVersionId !== enr.languageVersionId) {
    throw Errors.forbidden('Лекция не относится к вашему курсу');
  }
}

/**
 * Проверяет, что тест входит в языковую версию enrollment.
 * Тест бывает трёх видов (QuizKind), поэтому принадлежность определяется по любой
 * из трёх привязок: модуль → версия, лекция → модуль → версия, либо прямо версия.
 */
export async function assertQuizInEnrollment(quizId: string, enr: OwnedEnrollment): Promise<void> {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: {
      courseLanguageVersionId: true,
      module: { select: { courseLanguageVersionId: true } },
      lecture: { select: { module: { select: { courseLanguageVersionId: true } } } },
    },
  });
  const versionId =
    quiz?.module?.courseLanguageVersionId ??
    quiz?.lecture?.module.courseLanguageVersionId ??
    quiz?.courseLanguageVersionId ??
    null;
  if (!versionId || versionId !== enr.languageVersionId) {
    throw Errors.forbidden('Тест не относится к вашему курсу');
  }
}

/** Проверяет, что практическое задание входит в языковую версию enrollment. */
export async function assertPracticalInEnrollment(practicalTaskId: string, enr: OwnedEnrollment): Promise<void> {
  const task = await prisma.practicalTask.findUnique({
    where: { id: practicalTaskId },
    select: { module: { select: { courseLanguageVersionId: true } } },
  });
  if (!task || task.module.courseLanguageVersionId !== enr.languageVersionId) {
    throw Errors.forbidden('Задание не относится к вашему курсу');
  }
}
