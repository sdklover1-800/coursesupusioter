import type { Prisma } from '@prisma/client';

/**
 * Представления записи на курс для API. Явный select — наружу не уходят служебные
 * поля (reviewedById и т. п.), форма совпадает с контрактами @edu/shared.
 */

/** Запись глазами студента (StudentEnrollment): GET /me/courses, заявка из каталога. */
export const studentEnrollmentSelect = {
  id: true,
  courseId: true,
  languageVersionId: true,
  status: true,
  progressPercent: true,
  startedAt: true,
  completedAt: true,
  requestedAt: true,
  reviewedAt: true,
  reviewNote: true,
  // status — снятую с публикации версию UI помечает «Временно недоступен»
  languageVersion: { select: { id: true, title: true, description: true, language: true, status: true } },
  certificate: { select: { id: true, serialNumber: true } },
} satisfies Prisma.EnrollmentSelect;

/**
 * Строка очереди заявок (EnrollmentRequestItem): менеджер/админ.
 * user.selfRegisteredAt — аккаунт из самостоятельной регистрации: владение email
 * не проверялось, ФИО/email надо сверить со списком группы перед одобрением.
 */
export const requestItemSelect = {
  id: true,
  status: true,
  requestedAt: true,
  reviewedAt: true,
  reviewNote: true,
  courseId: true,
  user: { select: { id: true, name: true, email: true, cohortId: true, selfRegisteredAt: true } },
  languageVersion: { select: { id: true, language: true, title: true } },
} satisfies Prisma.EnrollmentSelect;
