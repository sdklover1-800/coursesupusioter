import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { logEvent } from '../../telemetry/events.js';
import { EventType } from '@edu/shared';
import { env } from '../../config/env.js';
import { mapVerdict } from '../../llm/rules.js';
import { orchestrator } from '../../llm/orchestrator.js';
import { generateEvaluationSummary } from '../../llm/evaluationSummary.js';

/**
 * Закрытие невозобновлённых сократических сессий (§5.7, аудит H3).
 * IN_PROGRESS-сессии без активности дольше SESSION_ABANDON_DAYS переводятся в
 * ABANDONED с verdictCode ABANDONED — они не смешиваются с FAILED в аналитике.
 *
 * Idle-пауза (§5.7) обеспечена самим дизайном: сессия по бездействию НЕ проваливается,
 * состояние авторитетно на сервере и возобновляется (FR-6.12); здесь закрываем лишь
 * окончательно брошенные. Сессия, поставленная студентом на паузу «Техническая
 * проблема» и не возобновлённая, получает endReason IDLE_AFTER_PAUSE и — если студент
 * успел написать хоть одну реплику — СЧИТАЕТСЯ попыткой (A7): иначе пауза давала бы
 * бесконечные бесплатные пересдачи. Освободить сессию может только сотрудник (excuse).
 */
export async function sweepAbandonedSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - env.SESSION_ABANDON_DAYS * 24 * 60 * 60 * 1000);
  const stale = await prisma.practicalSession.findMany({
    where: { status: 'IN_PROGRESS', lastActivityAt: { lt: cutoff } },
    select: { id: true, enrollmentId: true, _count: { select: { messages: { where: { role: 'STUDENT' } } } } },
  });
  if (stale.length === 0) return 0;

  // Какие из них были поставлены на паузу (PRACTICAL_SESSION_ENDED {paused:true}).
  const pausedEvents = await prisma.eventLog.findMany({
    where: {
      eventType: EventType.PRACTICAL_SESSION_ENDED,
      sessionId: { in: stale.map((s) => s.id) },
      payload: { path: ['paused'], equals: true },
    },
    select: { sessionId: true },
  });
  const paused = new Set(pausedEvents.map((e) => e.sessionId));

  let closed = 0;
  for (const s of stale) {
    const v = mapVerdict({ kind: 'ABANDONED', paused: paused.has(s.id) });
    const aggregate = await orchestrator.aggregateRubric(s.id, false);
    const hasTurns = s._count.messages > 0;
    // Условное обновление: сессию, которую студент успел возобновить, не трогаем.
    const { count } = await prisma.practicalSession.updateMany({
      where: { id: s.id, status: 'IN_PROGRESS', lastActivityAt: { lt: cutoff } },
      data: {
        status: v.status,
        verdictCode: v.verdictCode,
        endReason: v.endReason,
        endedAt: new Date(),
        evaluationResult: aggregate as object,
        verdictReason: `Сессия закрыта по бездействию (${v.endReason}, §5.7).`,
        // Итоговая оценка — только если было что оценивать
        summaryStatus: hasTurns ? 'PENDING' : null,
      },
    });
    if (count === 0) continue;
    closed++;
    await logEvent({
      eventType: EventType.PRACTICAL_SESSION_VERDICT,
      sessionId: s.id,
      enrollmentId: s.enrollmentId,
      payload: { status: v.status, verdictCode: v.verdictCode, reason: 'idle_timeout', aggregate },
    });
    await logEvent({
      eventType: EventType.PRACTICAL_SESSION_ENDED,
      sessionId: s.id,
      enrollmentId: s.enrollmentId,
      payload: { verdictCode: v.verdictCode, endReason: v.endReason },
    });
    if (hasTurns) {
      // Последовательно: обслуживание не должно устраивать всплеск параллельных LLM-вызовов.
      await generateEvaluationSummary(s.id).catch((err) => logger.warn({ err, sessionId: s.id }, 'Итоговая оценка брошенной сессии не сформирована'));
    }
  }
  logger.info({ count: closed }, 'Сократические сессии закрыты как ABANDONED (§5.7)');
  return closed;
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
