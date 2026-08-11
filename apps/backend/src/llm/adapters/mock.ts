import type { CompletionRequest, CompletionResult, LlmAdapter, StreamDelta } from '../types.js';

/**
 * Детерминированный оффлайн-адаптер для локальной разработки и тестов.
 * НЕ отправляет данные наружу (важно до закрытия правовых блокеров DP-2/DP-5).
 * Возвращает валидный по схемам JSON для генерации и разумную сократическую реплику.
 */
export class MockAdapter implements LlmAdapter {
  readonly provider = 'mock';

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const text = this.render(req);
    return {
      text,
      usage: { inputTokens: estimateTokens(req), outputTokens: Math.ceil(text.length / 3) },
      model: req.model,
      provider: this.provider,
    };
  }

  async streamComplete(req: CompletionRequest, onDelta: StreamDelta): Promise<CompletionResult> {
    const result = await this.complete(req);
    // Эмулируем стриминг по словам
    for (const word of result.text.split(/(\s+)/)) {
      onDelta(word);
    }
    return result;
  }

  private render(req: CompletionRequest): string {
    const system = req.system ?? '';
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';

    // Генерация теста
    if (/сгенерируй тест|quiz|тест по/i.test(system + lastUser) || /"questions"/i.test(system)) {
      return JSON.stringify(mockQuiz());
    }
    // Генерация практического задания
    if (/практическое задание|practical|student_facing_scenario/i.test(system + lastUser)) {
      return JSON.stringify(mockPractical());
    }
    // Судья (структурированная оценка)
    if (/судья|judge|student_reached_answer/i.test(system)) {
      return JSON.stringify(mockJudge(lastUser));
    }
    // Тьютор — краткая наводящая реплика (без ответа)
    return mockTutor(lastUser);
  }
}

function estimateTokens(req: CompletionRequest): number {
  const chars = (req.system?.length ?? 0) + req.messages.reduce((s, m) => s + m.content.length, 0);
  return Math.ceil(chars / 3);
}

function mockQuiz() {
  return {
    questions: [
      {
        type: 'SINGLE_CHOICE',
        prompt: '[MOCK] Какой ключевой тезис раскрыт в материале модуля?',
        options: ['Вариант A', 'Вариант B (верный)', 'Вариант C', 'Вариант D'],
        correct_option_indexes: [1],
        explanation: '[MOCK] Пояснение к правильному ответу.',
        difficulty: 'MEDIUM',
      },
      {
        type: 'TRUE_FALSE',
        prompt: '[MOCK] Утверждение по материалу является верным.',
        options: ['Верно', 'Неверно'],
        correct_option_indexes: [0],
        explanation: '[MOCK] Обоснование.',
        difficulty: 'EASY',
      },
    ],
  };
}

function mockPractical() {
  return {
    student_facing_scenario:
      '[MOCK] Рассмотрите проблему из материалов курса и предложите обоснованное решение, рассуждая шаг за шагом.',
    reference_solution: '[MOCK — СКРЫТО] Эталонное решение: ключевая идея и вывод.',
    rubric: {
      key_points: ['[MOCK] Тезис 1', '[MOCK] Тезис 2'],
      answer_reached_criteria: '[MOCK] Студент явно формулирует верный вывод и обосновывает его.',
    },
    recommended_token_budget: 9000,
    recommended_max_ai_messages: 22,
    difficulty: 'MEDIUM',
  };
}

function mockJudge(studentText: string) {
  const reached = /итог|ответ:|я думаю ответ|вывод:/i.test(studentText) && studentText.length > 40;
  const depth = Math.min(3, Math.floor(studentText.length / 60));
  return {
    student_reached_answer: reached,
    reasoning_assessment: {
      methodicalness: depth,
      question_quality: Math.max(0, depth - 1),
      logical_progression: depth,
      self_correction: /ошиб|я был неправ|поправ/i.test(studentText) ? 2 : 0,
      notes: '[MOCK] Автоматическая оценка (детерминированная эвристика).',
    },
  };
}

function mockTutor(studentText: string): string {
  if (!studentText) return '[MOCK] С чего вы предлагаете начать? Разбейте задачу на шаги.';
  return '[MOCK] Хорошее направление. А что произойдёт, если рассмотреть противоположный случай? Какой признак это подтвердит?';
}
