import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import type { EventType } from '@edu/shared';

interface LogEventInput {
  eventType: EventType;
  userId?: string | null;
  enrollmentId?: string | null;
  sessionId?: string | null;
  cohortId?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Единая точка записи событий телеметрии (FR-R.2, Приложение E).
 * Никогда не бросает — сбой телеметрии не должен ломать учебный сценарий.
 */
export async function logEvent(input: LogEventInput): Promise<void> {
  try {
    // FR-R.2: каждое событие привязано к когорте. Если cohortId не передан явно,
    // но известен userId — доразрешаем когорту из профиля, чтобы срезы по когортам
    // работали и для лекционных/тестовых/сертификатных событий.
    let cohortId = input.cohortId ?? null;
    if (!cohortId && input.userId) {
      const u = await prisma.user.findUnique({ where: { id: input.userId }, select: { cohortId: true } });
      cohortId = u?.cohortId ?? null;
    }
    if (!cohortId && input.enrollmentId) {
      const e = await prisma.enrollment.findUnique({ where: { id: input.enrollmentId }, select: { user: { select: { cohortId: true } } } });
      cohortId = e?.user.cohortId ?? null;
    }
    await prisma.eventLog.create({
      data: {
        eventType: input.eventType,
        userId: input.userId ?? null,
        enrollmentId: input.enrollmentId ?? null,
        sessionId: input.sessionId ?? null,
        cohortId,
        payload: (input.payload ?? {}) as object,
      },
    });
  } catch (err) {
    logger.error({ err, eventType: input.eventType }, 'Не удалось записать событие телеметрии');
  }
}

interface AuditInput {
  actorId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: Record<string, unknown>;
}

/** Аудит действий администратора/менеджера (NFR-2.9). */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        detail: (input.detail ?? {}) as object,
      },
    });
  } catch (err) {
    logger.error({ err, action: input.action }, 'Не удалось записать аудит');
  }
}
