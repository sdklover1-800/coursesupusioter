import { logger } from '../lib/logger.js';
import { sweepAbandonedSessions, cleanupRefreshTokens } from '../modules/practical/sweep.service.js';
import { sweepStaleQuizAttempts } from '../modules/quizzes/sweep.service.js';

/** Итог одного прогона обслуживания: сколько записей обработал каждый шаг (-1 — шаг упал). */
export interface MaintenanceResult {
  /** Брошенные сессии практикума → ABANDONED (§5.7, аудит H3) */
  abandonedSessions: number;
  /** Зависшие попытки теста → автоотправка (A15) */
  staleQuizAttempts: number;
  /** Удалённые истёкшие/отозванные refresh-токены (аудит M5) */
  refreshTokens: number;
}

async function step(name: string, fn: () => Promise<number>): Promise<number> {
  try {
    return await fn();
  } catch (err) {
    // Сбой одного шага не должен срывать остальные.
    logger.error({ err, step: name }, 'Шаг обслуживания упал');
    return -1;
  }
}

/**
 * Периодическое обслуживание (раз в час, очередь maintenance). Каждый шаг
 * изолирован: ошибка логируется, остальные шаги выполняются.
 */
export async function runMaintenance(): Promise<MaintenanceResult> {
  const abandonedSessions = await step('sweepAbandonedSessions', sweepAbandonedSessions);
  const staleQuizAttempts = await step('sweepStaleQuizAttempts', sweepStaleQuizAttempts);
  const refreshTokens = await step('cleanupRefreshTokens', cleanupRefreshTokens);
  return { abandonedSessions, staleQuizAttempts, refreshTokens };
}
