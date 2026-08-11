import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { logEvent } from '../../telemetry/events.js';
import { EventType } from '@edu/shared';
import { env } from '../../config/env.js';

/**
 * Закрытие невозобновлённых сократических сессий (§5.7, аудит H3).
 * IN_PROGRESS-сессии без активности дольше SESSION_ABANDON_DAYS переводятся в
 * ABANDONED — они не смешиваются с FAILED в аналитике исследования.
 *
 * Idle-пауза (§5.7) обеспечена самим дизайном: сессия по бездействию НЕ проваливается,
 * состояние авторитетно на сервере и возобновляется (FR-6.12) — отдельного действия
 * «пауза» не требуется; здесь закрываем лишь окончательно брошенные.
 */
export async function sweepAbandonedSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - env.SESSION_ABANDON_DAYS * 24 * 60 * 60 * 1000);
  const stale = await prisma.practicalSession.findMany({
    where: { status: 'IN_PROGRESS', lastActivityAt: { lt: cutoff } },
    select: { id: true, enrollmentId: true },
  });
  if (stale.length === 0) return 0;

  await prisma.practicalSession.updateMany({
    where: { id: { in: stale.map((s) => s.id) } },
    data: { status: 'ABANDONED', endedAt: new Date(), verdictReason: 'Сессия закрыта по бездействию (ABANDONED, §5.7).' },
  });

  for (const s of stale) {
    await logEvent({
      eventType: EventType.PRACTICAL_SESSION_VERDICT,
      sessionId: s.id,
      enrollmentId: s.enrollmentId,
      payload: { status: 'ABANDONED', reason: 'idle_timeout' },
    });
  }
  logger.info({ count: stale.length }, 'Сократические сессии закрыты как ABANDONED (§5.7)');
  return stale.length;
}

/**
 * Чистка ненужных refresh-токенов (аудит M5): истёкшие и отозванные старше суток
 * удаляются, иначе таблица растёт бесконечно (на каждый логин/ротацию — строка).
 */
export async function cleanupRefreshTokens(): Promise<number> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const { count } = await prisma.refreshToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: dayAgo } }] },
  });
  if (count > 0) logger.info({ count }, 'Удалены протухшие/отозванные refresh-токены');
  return count;
}
