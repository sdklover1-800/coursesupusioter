import type { EnrollmentStatus } from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { Errors } from '../../lib/errors.js';
import { contentAccessDenial } from '../enrollments/policy.js';

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
  courseId: string;
  languageVersionId: string;
  status: EnrollmentStatus;
}

/**
 * Гейт одобрения заявки: контент курса (лекции, видео, расшифровки, тесты,
 * практическое, сертификат) доступен только при статусе ACTIVE/COMPLETED.
 * PENDING/REJECTED/WITHDRAWN → 403 ENROLLMENT_NOT_APPROVED (details — для экрана
 * «заявка на рассмотрении» со ссылкой на страницу курса в каталоге).
 */
export function assertEnrollmentAdmitted(e: { status: EnrollmentStatus; courseId: string }): void {
  const denial = contentAccessDenial(e.status);
  if (denial) throw Errors.enrollmentNotApproved(denial, { status: e.status, courseId: e.courseId });
}

/**
 * Загружает enrollment, проверяя владение, активность аккаунта, одобрение заявки
 * и что версия опубликована.
 * ЕДИНАЯ точка входа для всех учебных маршрутов студента.
 */
export async function loadOwnedEnrollment(userId: string, enrollmentId: string): Promise<OwnedEnrollment> {
  const e = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { languageVersion: { select: { status: true } }, user: { select: { isActive: true } } },
  });
  if (!e || e.userId !== userId) throw Errors.forbidden('Запись на курс не принадлежит пользователю');
  // Деактивированный аккаунт теряет доступ сразу, а не по истечении access-токена.
  if (!e.user.isActive) throw Errors.forbidden('Учётная запись деактивирована');
  assertEnrollmentAdmitted(e);
  if (e.languageVersion.status !== 'PUBLISHED') throw Errors.forbidden('Курс недоступен');
  return { id: e.id, userId: e.userId, courseId: e.courseId, languageVersionId: e.languageVersionId, status: e.status };
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
