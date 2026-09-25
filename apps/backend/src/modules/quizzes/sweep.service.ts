import { autoSubmitStaleAttempts } from './attempts.service.js';

/**
 * Автоотправка зависших попыток оцениваемого теста (A15): попытка без отправки
 * дольше QUIZ_ATTEMPT_MAX_HOURS (от последнего автосохранения, иначе от старта)
 * отправляется системой с сохранёнными ответами: autoSubmitted = true, событие
 * QUIZ_AUTO_SUBMITTED, activeDurationSec — до последнего автосохранения.
 * Вызывается раз в час из queue/maintenance.ts; возвращает число отправленных.
 */
export async function sweepStaleQuizAttempts(): Promise<number> {
  return autoSubmitStaleAttempts(new Date());
}
