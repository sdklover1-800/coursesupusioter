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
    const inputTokens = estimateTokens(req);
    return {
      text,
      // Детерминированные значения для тестов учёта токенов (A3): половина входа
      // «из кеша», у вызовов судьи — фиксированные токены рассуждений.
      usage: {
        inputTokens,
        outputTokens: Math.ceil(text.length / 3),
        cachedInputTokens: Math.floor(inputTokens / 2),
        reasoningTokens: req.purpose === 'judge' ? 16 : 0,
      },
      model: req.model,
      provider: this.provider,
      finishReason: 'stop',
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

    // Диалог практикума (§5.4) различаем по назначению вызова — текст студента
    // не должен случайно переключать мок на генерацию («тест по…», «practical»).
    if (req.purpose === 'dialog') return mockTutor(lastUser);
    if (req.purpose === 'judge') {
      if (/итогового отзыва студенту/i.test(system)) return JSON.stringify({ leaks: false, lines: [], reason: '' });
      if (/контролёр учебного диалога/i.test(system)) return JSON.stringify(mockLeakCheck(lastUser));
      if (/итоговый отзыв студенту/i.test(system)) return JSON.stringify(mockSummary(lastUser));
      // Однокальный режим: вывод судьи + реплика тьютора одним JSON
      if (/"tutor_message"/.test(system)) {
        const student = lastStudentLine(lastUser);
        return JSON.stringify({ ...mockJudge(student), tutor_message: mockTutor(student) });
      }
      if (/судья|judge|student_reached_answer/i.test(system)) return JSON.stringify(mockJudge(lastStudentLine(lastUser)));
    }

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

/** Судья получает транскрипт одним сообщением — берём последнюю реплику студента. */
function lastStudentLine(transcript: string): string {
  const lines = transcript.split('\n').filter((l) => /^\[С\d+\] СТУДЕНТ: /.test(l));
  const last = lines[lines.length - 1];
  return last ? last.replace(/^\[С\d+\] СТУДЕНТ: /, '') : transcript;
}

function mockJudge(studentText: string) {
  const reached = /итог|ответ:|я думаю ответ|вывод:/i.test(studentText) && studentText.length > 40;
  const depth = Math.min(3, Math.floor(studentText.length / 60));
  // Порядок полей = порядок генерации у живой модели: вердикт последним (A.1).
  return {
    reasoning_assessment: {
      methodicalness: depth,
      question_quality: Math.max(0, depth - 1),
      logical_progression: depth,
      self_correction: /ошиб|я был неправ|поправ/i.test(studentText) ? 2 : 0,
      notes: '[MOCK] Автоматическая оценка (детерминированная эвристика).',
    },
    covered_key_points: reached ? [1, 2] : [],
    missing_key_points: reached ? [] : [1, 2],
    criterion_missing: reached ? [] : ['[MOCK] вывод'],
    student_reached_answer: reached,
  };
}

/** Проверка утечки: «утечка» только для реплики с маркером MOCK-LEAK (смоук-тест замены). */
function mockLeakCheck(userMessage: string) {
  const leaks = /MOCK-LEAK/.test(userMessage);
  return { leaks, reason: leaks ? '[MOCK] маркер утечки' : '' };
}

/** Итоговый отзыв: ссылается на первую реплику студента из входа. */
function mockSummary(userMessage: string) {
  const id = /\[id=([^\]]+)\]/.exec(userMessage)?.[1];
  const line = '[MOCK] Рассуждение прослеживается по репликам.';
  return {
    criteria: ['methodicalness', 'question_quality', 'logical_progression', 'self_correction'].map((key) => ({ key, line })),
    strengths: ['[MOCK] Последовательность.', '[MOCK] Готовность уточнять.'],
    to_develop: ['[MOCK] Больше вопросов к себе.', '[MOCK] Проверка альтернатив.'],
    highlights: id ? [{ message_id: id, criterion: 'methodicalness', polarity: 'plus', note: '[MOCK] Хороший шаг.' }] : [],
  };
}

function mockTutor(studentText: string): string {
  if (!studentText) return '[MOCK] С чего вы предлагаете начать? Разбейте задачу на шаги и назовите первый.';
  // Смоук-тест замены реплики при утечке (A21): студент пишет «mock-leak».
  if (/mock-leak/i.test(studentText)) return '[MOCK] Ответ такой: MOCK-LEAK. Согласны ли вы с этим?';
  return '[MOCK] Хорошее направление. А какой признак из условия подтвердит вашу мысль?';
}
