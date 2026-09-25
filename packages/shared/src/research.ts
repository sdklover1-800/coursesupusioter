/**
 * Исследовательские структуры, которые пишет один модуль, а читает другой
 * (оценивание, практикум, экспорт исследовательских данных). Хранятся в Json-полях.
 */

/**
 * Порядок показа вопросов и вариантов в официальной попытке (QuizAttempt.presentation).
 * Попытка 2 перемешивает вопросы и варианты (USER_DECISIONS §1); ответы хранятся по
 * каноническим id вариантов, поэтому анализ не зависит от порядка показа.
 */
export interface AttemptPresentation {
  version: 1;
  /** id вопросов в порядке показа */
  questionIds: string[];
  /** questionId → канонические id вариантов в порядке показа */
  optionOrder: Record<string, number[]>;
  /** seed перемешивания (null — порядок без перемешивания) */
  seed: string | null;
}

/** Служебные метрики сессии практикума для воспроизводимости (PracticalSession.metrics, FR-R.7). */
export interface PracticalSessionMetrics {
  promptVersion: string;
  judgeCalls: number;
  confirmCalls: number;
  leakChecks: number;
  leakPrevented: number;
  leakCheckTimeouts: number;
  lengthRetries: number;
  nearCeiling: boolean;
  /** Токены вспомогательных вызовов (судья, подтверждение, проверка утечки) */
  auxTokens: { input: number; cachedInput: number; output: number; reasoning: number };
  /** Настройки, действовавшие в сессии */
  settings: { temperature: number | null; judgeConfirm: boolean; leakCheck: boolean; leakFailMode: 'closed' | 'open' };
}

/**
 * Снимок задания на момент старта сессии (PracticalSession.taskSnapshot): правка
 * задания после старта не меняет условий уже идущей или завершённой сессии.
 * Эталон не копируется — только его SHA-256 для контроля.
 */
export interface PracticalTaskSnapshot {
  capturedAt: string;
  canonicalRef: string | null;
  title: string;
  scenarioPrompt: string;
  rubricSpec: unknown;
  referenceSolutionSha256: string;
}
