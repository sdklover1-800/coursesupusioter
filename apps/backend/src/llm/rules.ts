/**
 * Чистые правила оркестрации сократической сессии (§5.4, FR-6.4, FR-6.11).
 * Вынесены из orchestrator.ts, чтобы авторитетную серверную логику вердикта и
 * сигналы целостности можно было тестировать изолированно, без БД и LLM.
 */
import { INTEGRITY_THRESHOLDS, IntegrityFlagType } from '@edu/shared';

export type TurnOutcome = 'PASSED' | 'FAILED_LIMIT' | 'FAILED_CEILING' | 'CONTINUE';

/**
 * Решение об исходе хода ПОСЛЕ оценки судьи.
 * Приоритет: достигнут ответ → лимит реплик (основной) → токен-потолок (предохранитель).
 *
 * @param aiMessageCount число реплик ассистента ДО реплики текущего хода
 * @param tokensUsedAfterTurn накопленный расход токенов с учётом текущего хода
 */
export function decideTurnOutcome(p: {
  reached: boolean;
  aiMessageCount: number;
  maxAiMessages: number;
  tokensUsedAfterTurn: number;
  tokenCeiling: number;
}): TurnOutcome {
  // Мгновенно данный верный ответ засчитывается (§5.5), даже на последней реплике.
  if (p.reached) return 'PASSED';
  // Лимит реплик — основная и языконезависимая метрика (FR-6.4).
  if (p.aiMessageCount >= p.maxAiMessages) return 'FAILED_LIMIT';
  // Токен-потолок — предохранитель стоимости (§5.6).
  if (p.tokensUsedAfterTurn >= p.tokenCeiling) return 'FAILED_CEILING';
  return 'CONTINUE';
}

export interface IntegrityFlag {
  type: string;
  detail?: string;
}

/**
 * Сигналы целостности (FR-6.11). НЕ блокируют сдачу — только фиксируются.
 * @param maxChars конфигурируемый предел длины сообщения студента (FR-6.10)
 */
export function detectIntegritySignals(p: {
  text: string;
  typingMs?: number;
  maxChars: number;
}): IntegrityFlag[] {
  const flags: IntegrityFlag[] = [];

  // Аномально быстрый ввод длинного текста (вероятная вставка извне).
  if (p.text.length >= INTEGRITY_THRESHOLDS.longPasteMinChars && p.typingMs && p.typingMs > 0) {
    const cps = p.text.length / (p.typingMs / 1000);
    if (cps > INTEGRITY_THRESHOLDS.fastPasteCharsPerSecond) {
      flags.push({ type: IntegrityFlagType.FAST_LONG_PASTE, detail: `${cps.toFixed(0)} симв/с` });
    }
  }

  // Сообщение у верхней границы длины.
  if (p.text.length >= p.maxChars * INTEGRITY_THRESHOLDS.nearMaxLengthRatio) {
    flags.push({ type: IntegrityFlagType.NEAR_MAX_LENGTH });
  }

  return flags;
}
