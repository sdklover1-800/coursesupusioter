import type { Prisma } from '@prisma/client';
import { ADMITTED_ENROLLMENT_STATUSES, EnrollmentStatus, Role, type PublishStatus } from '@edu/shared';

/**
 * Политика статусов записи на курс (заявки из каталога).
 * Чистые функции без БД — единые правила для маршрутов и unit-тестов:
 *   студент подаёт заявку (PENDING) → менеджер/админ одобряет (ACTIVE) или
 *   отклоняет (REJECTED); доступ к контенту — только ACTIVE/COMPLETED.
 */

export type RequestFilter = 'PENDING' | 'REJECTED' | 'ALL';

const ADMITTED: ReadonlySet<EnrollmentStatus> = new Set(ADMITTED_ENROLLMENT_STATUSES);

/** Статус даёт доступ к учебному контенту и учитывается в статистике. */
export function isAdmitted(status: EnrollmentStatus): boolean {
  return ADMITTED.has(status);
}

/** Сообщения отказа в доступе к контенту по статусу (код ошибки ENROLLMENT_NOT_APPROVED). */
const DENIAL_MESSAGES: Partial<Record<EnrollmentStatus, string>> = {
  PENDING: 'Заявка на курс ещё не одобрена',
  REJECTED: 'Заявка на курс отклонена',
  WITHDRAWN: 'Запись на курс отменена',
};

/**
 * Решение о доступе к контенту курса: null — доступ есть, иначе текст отказа.
 * Неизвестный статус трактуется как отказ (fail-closed).
 */
export function contentAccessDenial(status: EnrollmentStatus): string | null {
  if (isAdmitted(status)) return null;
  return DENIAL_MESSAGES[status] ?? 'Доступ к курсу не одобрен';
}

/** Что сделать с заявкой студента при повторной подаче (POST /catalog/:courseId/requests). */
export type SelfRequestDecision =
  | { action: 'create' }
  | { action: 'keep-pending' }
  | { action: 'reopen' }
  | { action: 'conflict'; message: string };

export function decideSelfRequest(existing: EnrollmentStatus | null): SelfRequestDecision {
  switch (existing) {
    case null:
      return { action: 'create' };
    case 'PENDING':
      return { action: 'keep-pending' };
    case 'REJECTED':
    case 'WITHDRAWN':
      return { action: 'reopen' };
    case 'ACTIVE':
    case 'COMPLETED':
      return { action: 'conflict', message: 'Вы уже записаны на этот курс' };
    default:
      return { action: 'conflict', message: 'Заявку подать нельзя' };
  }
}

/** Одобрить можно ожидающую или ранее отклонённую заявку. */
export const APPROVABLE_STATUSES = [EnrollmentStatus.PENDING, EnrollmentStatus.REJECTED] as const;
export function canApprove(status: EnrollmentStatus): boolean {
  return (APPROVABLE_STATUSES as readonly EnrollmentStatus[]).includes(status);
}

/**
 * Одобрить заявку можно, пока её языковая версия не в архиве: архивная студентам
 * недоступна навсегда, её заявку можно только отклонить. Снятая с публикации (DRAFT)
 * — временно: одобрить можно, доступ откроется при повторной публикации.
 */
export function versionAllowsApproval(versionStatus: PublishStatus): boolean {
  return versionStatus !== 'ARCHIVED';
}

/** Отклонить — только ожидающую; отменить (студент) — только свою ожидающую. */
export function canReject(status: EnrollmentStatus): boolean {
  return status === EnrollmentStatus.PENDING;
}
export function canCancel(status: EnrollmentStatus): boolean {
  return status === EnrollmentStatus.PENDING;
}

/**
 * Отмена ожидающей заявки: строку без истории удаляем; если у записи уже есть
 * учебная история (повторная заявка после WITHDRAWN), удалять нельзя — каскад
 * стёр бы исследовательские данные (попытки, сессии), поэтому возвращаем WITHDRAWN.
 */
export function cancelAction(hasLearningHistory: boolean): 'delete' | 'withdraw' {
  return hasLearningHistory ? 'withdraw' : 'delete';
}

/** Смена языка прохождения (FR-3.4): для заявки и активного курса. */
export type LanguageSwitchDecision = 'allow' | 'not-approved' | 'completed';
export function languageSwitchDecision(status: EnrollmentStatus): LanguageSwitchDecision {
  if (status === EnrollmentStatus.PENDING || status === EnrollmentStatus.ACTIVE) return 'allow';
  if (status === EnrollmentStatus.COMPLETED) return 'completed';
  return 'not-approved';
}

/**
 * Прямая запись менеджером (POST /enrollments): существующая заявка
 * (PENDING/REJECTED) превращается в активную запись вместо 409.
 */
export function decideManagerEnroll(existing: EnrollmentStatus | null): 'create' | 'convert' | 'conflict' {
  if (existing === null) return 'create';
  if (existing === EnrollmentStatus.PENDING || existing === EnrollmentStatus.REJECTED) return 'convert';
  return 'conflict';
}

/**
 * Назначение когорты (плеча эксперимента, FR-R.1) при одобрении заявки.
 * Когорта — свойство студента, а не записи: смена группы «на ходу» переносит в
 * другое плечо и уже набранные данные по другим курсам. Поэтому:
 *  - когорта не передана или совпадает с текущей — ничего не меняем;
 *  - у студента ещё нет когорты — назначает и менеджер, и админ (первичное распределение),
 *    НО если у него уже есть учебные данные (собраны вне любого условия эксперимента),
 *    первичное назначение молча «переразметило» бы их — нужно явное подтверждение;
 *  - сменить уже назначенную может только админ (как в PATCH /admin/users) и только
 *    пока студент не учится/не учился на других курсах (нет ACTIVE/COMPLETED записей);
 *  - состав групп зафиксирован (STUDY_COHORTS_LOCKED) — любая смена только с force.
 */
export type CohortOnApprove =
  | { action: 'keep' }
  | { action: 'assign' }
  | { action: 'forbidden'; message: string }
  | { action: 'conflict'; message: string }
  | { action: 'confirm_required'; message: string }
  | { action: 'locked'; message: string };

export const COHORT_CONFIRM_MESSAGE = 'У студента уже есть учебные данные без группы эксперимента — подтвердите назначение группы';
export const COHORTS_LOCKED_MESSAGE = 'Состав групп эксперимента зафиксирован — смена группы только с явным подтверждением (force)';

export function decideCohortOnApprove(p: {
  requested: string | undefined;
  current: string | null;
  actorRole: Role;
  /** У студента есть ACTIVE/COMPLETED записи на другие курсы */
  hasAdmittedEnrollments: boolean;
  /** Есть учебные данные: ACTIVE/COMPLETED записи либо прогресс лекций/попытки/сессии */
  hasPriorStudyData: boolean;
  /** Менеджер подтвердил назначение группы студенту с данными (confirmCohortAssign) */
  confirmed: boolean;
  /** env STUDY_COHORTS_LOCKED */
  cohortsLocked?: boolean;
  /** Явное подтверждение смены при зафиксированных группах */
  force?: boolean;
}): CohortOnApprove {
  if (!p.requested || p.requested === p.current) return { action: 'keep' };
  if (p.current !== null) {
    if (p.actorRole !== Role.ADMIN) {
      return { action: 'forbidden', message: 'Студент уже в группе эксперимента — сменить её может только администратор' };
    }
    if (p.hasAdmittedEnrollments) {
      return { action: 'conflict', message: 'Студент уже учится в своей группе эксперимента на другом курсе — смена группы исказит данные исследования' };
    }
  }
  if (p.cohortsLocked && !p.force) return { action: 'locked', message: COHORTS_LOCKED_MESSAGE };
  if (p.current === null && p.hasPriorStudyData && !p.confirmed) return { action: 'confirm_required', message: COHORT_CONFIRM_MESSAGE };
  return { action: 'assign' };
}

/**
 * Фильтр очереди заявок (GET /enrollment-requests). «Все» — только то, что
 * пришло заявкой (requestedAt задан), плюс любые PENDING/REJECTED; прямые записи
 * менеджером в очередь не попадают. Заявки деактивированных аккаунтов скрыты
 * (и не входят в счётчик): одобрить их всё равно нельзя.
 */
export function requestListWhere(filter: RequestFilter, courseId?: string): Prisma.EnrollmentWhereInput {
  const byStatus =
    filter === 'ALL'
      ? { OR: [{ requestedAt: { not: null } }, { status: { in: [EnrollmentStatus.PENDING, EnrollmentStatus.REJECTED] } }] }
      : { status: filter };
  return { ...byStatus, user: { isActive: true }, ...(courseId ? { courseId } : {}) };
}

/** Порядок очереди: ожидающие — по давности (FIFO), остальные — свежие сверху. */
export function requestListOrder(filter: RequestFilter): Prisma.EnrollmentOrderByWithRelationInput[] {
  return filter === 'PENDING'
    ? [{ requestedAt: { sort: 'asc' as const, nulls: 'first' as const } }, { id: 'asc' as const }]
    : [{ requestedAt: { sort: 'desc' as const, nulls: 'last' as const } }, { id: 'desc' as const }];
}
