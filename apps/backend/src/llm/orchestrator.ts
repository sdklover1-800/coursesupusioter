import type { PracticalSession, PracticalTask, ChatMessage } from '@prisma/client';
import {
  judgeOutputSchema,
  socraticTurnSchema,
  reasoningAssessmentSchema,
  EventType,
  IntegrityFlagType,
  TUTOR_MESSAGE_MAX_CHARS,
  type Difficulty,
  type Language,
  type ReasoningAssessment,
  type RubricAggregate,
} from '@edu/shared';
import { prisma } from '../lib/prisma.js';
import { getGateway } from './gateway.js';
import { env, tokenCeilingFor } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { Errors } from '../lib/errors.js';
import { logEvent } from '../telemetry/events.js';
import { detectAnswerLeak } from './leakDetector.js';
import { decideTurnOutcome, detectIntegritySignals } from './rules.js';
import {
  tutorSystemPrompt,
  judgeSystemPrompt,
  singleCallSystemPrompt,
  PROMPT_VERSION,
} from './prompts.js';
import type { StreamDelta } from './types.js';

/** Локализованные служебные реплики (не от LLM — экономия + отсутствие утечки). */
const CLOSING = {
  passed: {
    kk: 'Сіз дұрыс қорытындыға келдіңіз. Тапсырма тапсырылды.',
    ru: 'Вы пришли к верному выводу. Задание сдано.',
    en: 'You reached the correct conclusion. Task passed.',
  },
  failedLimit: {
    kk: 'Реплика лимиті таусылды. Тапсырма тапсырылмады.',
    ru: 'Лимит реплик исчерпан. Задание не сдано.',
    en: 'The reply limit is exhausted. Task not passed.',
  },
} as const;

export interface TurnResult {
  status: PracticalSession['status'];
  tutorMessage: string | null;
  reachedAnswer: boolean;
  remainingAiMessages: number;
  aiMessageCount: number;
  maxAiMessages: number;
  verdictReason?: string | null;
  assessment?: ReasoningAssessment;
  integrityFlags?: { type: string; detail?: string }[];
  evaluationResult?: RubricAggregate;
}

type SessionWithTask = PracticalSession & { practicalTask: PracticalTask };

/**
 * Серверная авторитетная оркестрация сократического диалога (§5.4).
 * Клиенту нельзя доверять подсчёт токенов и вынесение вердикта.
 */
export class SocraticOrchestrator {
  private gateway = getGateway();

  /** Стартует сессию: создаёт запись, генерирует первую реплику ассистента. */
  async startSession(params: {
    enrollmentId: string;
    task: PracticalTask;
    language: Language;
    cohortId: string | null;
    userId: string;
  }): Promise<PracticalSession> {
    const existing = await prisma.practicalSession.findFirst({
      where: { enrollmentId: params.enrollmentId, practicalTaskId: params.task.id, status: 'IN_PROGRESS' },
    });
    if (existing) return existing; // возобновление вместо дубля (NFR-1.7)

    const session = await prisma.practicalSession.create({
      data: {
        enrollmentId: params.enrollmentId,
        practicalTaskId: params.task.id,
        orchestrationMode: env.ORCHESTRATION_MODE,
        modelUsed: env.LLM_MODEL_DIALOG,
        promptTemplateId: PROMPT_VERSION,
        maxAiMessages: params.task.maxAiMessages,
      },
    });

    // Стартовая реплика ассистента — сам сценарий (виден студенту), из задания.
    await prisma.chatMessage.create({
      data: { sessionId: session.id, role: 'AI', content: params.task.scenarioPrompt, tokensIn: 0, tokensOut: 0 },
    });

    await logEvent({
      eventType: EventType.PRACTICAL_SESSION_STARTED,
      userId: params.userId,
      enrollmentId: params.enrollmentId,
      sessionId: session.id,
      cohortId: params.cohortId,
      payload: { taskId: params.task.id, mode: session.orchestrationMode, model: session.modelUsed },
    });
    return session;
  }

  /**
   * Обработка хода студента. Идемпотентно относительно «зависшего» хода:
   * если последняя реплика — STUDENT без ответа ассистента (сбой), повторяем ход
   * без добавления нового сообщения и без расхода лимита (FR-6.12, §5.7).
   */
  async handleStudentTurn(params: {
    sessionId: string;
    studentText: string;
    typingMs?: number;
    userId: string;
    cohortId: string | null;
    onDelta: StreamDelta;
  }): Promise<TurnResult> {
    const session = (await prisma.practicalSession.findUnique({
      where: { id: params.sessionId },
      include: { practicalTask: true },
    })) as SessionWithTask | null;
    if (!session) throw Errors.notFound('Сессия не найдена');
    if (session.status !== 'IN_PROGRESS') throw Errors.conflict('Сессия уже завершена');

    const enrollment = await prisma.enrollment.findUnique({
      where: { id: session.enrollmentId },
      include: { languageVersion: true },
    });
    const language = (enrollment?.languageVersion.language ?? 'ru') as Language;

    const history = await prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
    });

    // ── Определяем: новый ход или повтор «зависшего» ──
    const last = history[history.length - 1];
    const isResume = last?.role === 'STUDENT';
    let studentMsg: ChatMessage;

    if (isResume) {
      studentMsg = last!; // повторяем ход по уже сохранённому сообщению
      await logEvent({
        eventType: EventType.PRACTICAL_SESSION_RESUMED,
        userId: params.userId,
        sessionId: session.id,
        enrollmentId: session.enrollmentId,
        cohortId: params.cohortId,
      });
    } else {
      const text = params.studentText.trim();
      if (!text) throw Errors.badRequest('Пустое сообщение');
      if (text.length > env.MAX_STUDENT_MESSAGE_CHARS) {
        throw Errors.badRequest(`Сообщение длиннее ${env.MAX_STUDENT_MESSAGE_CHARS} символов`); // FR-6.10
      }
      const integrity = detectIntegritySignals({ text, typingMs: params.typingMs, maxChars: env.MAX_STUDENT_MESSAGE_CHARS });
      studentMsg = await prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: 'STUDENT',
          content: text,
          integrityFlags: integrity.length ? (integrity as object) : undefined,
        },
      });
      await logEvent({
        eventType: EventType.PRACTICAL_MESSAGE_SENT,
        userId: params.userId,
        sessionId: session.id,
        enrollmentId: session.enrollmentId,
        cohortId: params.cohortId,
        payload: { length: text.length },
      });
      for (const flag of integrity) {
        await logEvent({
          eventType: EventType.PRACTICAL_INTEGRITY_FLAG,
          userId: params.userId,
          sessionId: session.id,
          enrollmentId: session.enrollmentId,
          cohortId: params.cohortId,
          payload: { type: flag.type, detail: flag.detail },
        });
      }
    }

    const rubric = session.practicalTask.rubricSpec as { key_points: string[]; answer_reached_criteria: string };
    const difficulty = session.practicalTask.difficulty as Difficulty;

    // ── Выполнение хода (двухвызовный по умолчанию) ──
    // Технические ошибки LLM пробрасываются (Errors.upstream) БЕЗ смены статуса и
    // БЕЗ расхода лимита (§5.7): сообщение студента уже сохранено и не потеряно.
    let reached: boolean;
    let assessment: ReasoningAssessment;
    let tutorMessage: string;
    let turnIn = 0; // FR-6.9/FR-R.3: раздельный per-turn учёт input/output токенов
    let turnOut = 0;

    if (session.orchestrationMode === 'SINGLE_CALL') {
      const sys = singleCallSystemPrompt({
        language,
        difficulty,
        scenario: session.practicalTask.scenarioPrompt,
        referenceSolution: session.practicalTask.referenceSolution,
        rubricKeyPoints: rubric.key_points,
        answerReachedCriteria: rubric.answer_reached_criteria,
      });
      const { data, result } = await this.gateway.completeStructured(
        { model: env.LLM_MODEL_DIALOG, system: sys, cacheSystem: true, maxTokens: 600, messages: this.toLlm(history, studentMsg) },
        socraticTurnSchema,
        'single_call',
      );
      turnIn += result.usage.inputTokens;
      turnOut += result.usage.outputTokens;
      reached = data.student_reached_answer;
      assessment = { ...data.reasoning_assessment, notes: data.reasoning_assessment.notes ?? '' };
      tutorMessage = this.clamp(data.tutor_message);
    } else {
      // 1) Судья (видит эталон) — сначала решаем исход
      const judgeSys = judgeSystemPrompt({
        language,
        referenceSolution: session.practicalTask.referenceSolution,
        rubricKeyPoints: rubric.key_points,
        answerReachedCriteria: rubric.answer_reached_criteria,
      });
      const judge = await this.gateway.completeStructured(
        { model: env.LLM_MODEL_JUDGE, system: judgeSys, cacheSystem: true, maxTokens: 400, messages: this.toLlm(history, studentMsg) },
        judgeOutputSchema,
        'judge',
      );
      turnIn += judge.result.usage.inputTokens;
      turnOut += judge.result.usage.outputTokens;
      reached = judge.data.student_reached_answer;
      assessment = { ...judge.data.reasoning_assessment, notes: judge.data.reasoning_assessment.notes ?? '' };
      tutorMessage = ''; // тьютор вызовется ниже только если нужен
    }

    // Сохраняем пошаговую оценку на реплике студента (§5.5, FR-R.3)
    await prisma.chatMessage.update({ where: { id: studentMsg.id }, data: { turnAssessment: assessment as object } });
    await logEvent({
      eventType: EventType.PRACTICAL_ASSESSMENT_RECORDED,
      userId: params.userId,
      sessionId: session.id,
      enrollmentId: session.enrollmentId,
      cohortId: params.cohortId,
      payload: assessment,
    });

    // 5.6b: токен-потолок сессии = бюджет задания (его калибрует/переопределяет
    // менеджер, §5.3); env-потолок по языку — только фолбэк, если бюджет не задан.
    const ceiling = session.practicalTask.tokenBudget > 0 ? session.practicalTask.tokenBudget : tokenCeilingFor(language);
    // Потолок проверяется по расходу судьи/single-call (до реплики тьютора) —
    // предохранитель срабатывает до генерации нового наводящего хода.
    const newTokens = session.tokensUsed + turnIn + turnOut;

    // FR-6.11: верный ответ первой же репликой (до единой реплики ассистента) —
    // сигнал возможной контаминации внешним ИИ. НЕ блокирует сдачу (мгновенный
    // верный ответ засчитывается), но фиксируется в телеметрии.
    if (reached && session.aiMessageCount === 0) {
      const flags = ((studentMsg.integrityFlags as { type: string }[] | null) ?? []).concat({ type: IntegrityFlagType.CORRECT_ON_FIRST_MESSAGE });
      await prisma.chatMessage.update({ where: { id: studentMsg.id }, data: { integrityFlags: flags as object } });
      await logEvent({ eventType: EventType.PRACTICAL_INTEGRITY_FLAG, userId: params.userId, sessionId: session.id, enrollmentId: session.enrollmentId, cohortId: params.cohortId, payload: { type: IntegrityFlagType.CORRECT_ON_FIRST_MESSAGE } });
    }

    // ── Правило 1: достигнут ответ → PASSED (мгновенный верный ответ засчитывается, §5.5) ──
    if (reached) {
      const closing = CLOSING.passed[language] ?? CLOSING.passed.ru;
      params.onDelta(closing);
      return this.finalize(session, {
        status: 'PASSED',
        closing,
        tokensUsed: newTokens,
        aiMessageCount: session.aiMessageCount,
        verdictReason: 'Студент пришёл к верному ответу.',
        reached: true,
        userId: params.userId,
        cohortId: params.cohortId,
      });
    }

    // ── Правило 2: исчерпан лимит реплик (основной) или токен-потолок (предохранитель) → FAILED ──
    const outcome = decideTurnOutcome({
      reached: false, // ветка reached обработана выше
      aiMessageCount: session.aiMessageCount,
      maxAiMessages: session.maxAiMessages,
      tokensUsedAfterTurn: newTokens,
      tokenCeiling: ceiling,
    });
    const ceilingReached = outcome === 'FAILED_CEILING';
    if (outcome === 'FAILED_LIMIT' || outcome === 'FAILED_CEILING') {
      const closing = CLOSING.failedLimit[language] ?? CLOSING.failedLimit.ru;
      params.onDelta(closing);
      return this.finalize(session, {
        status: 'FAILED',
        closing,
        tokensUsed: newTokens,
        aiMessageCount: session.aiMessageCount,
        verdictReason: ceilingReached ? 'Достигнут токен-потолок (предохранитель).' : 'Исчерпан лимит реплик ассистента.',
        reached: false,
        userId: params.userId,
        cohortId: params.cohortId,
      });
    }

    // ── Правило 3: наводящая реплика тьютора + пост-проверка на утечку (§5.4) ──
    if (session.orchestrationMode === 'SINGLE_CALL') {
      // Реплика уже получена структурированным вызовом; токены учтены в turnTokens.
      const leak = detectAnswerLeak(tutorMessage, session.practicalTask.referenceSolution);
      if (leak.leaked) {
        logger.warn({ sessionId: session.id, reason: leak.reason }, 'Утечка ответа (single-call) — реплика заменена');
        tutorMessage = this.safeFallback(language);
      }
      // L1 (NFR-1.4): структурированный вызов не потоковый — эмулируем стрим по словам,
      // чтобы клиент в SINGLE_CALL получал реплику так же плавно, как в двухвызовном.
      for (const word of tutorMessage.split(/(\s+)/)) if (word) params.onDelta(word);
    } else {
      // Двухвызовный: тьютор стримит реплику (эталон не в его контексте).
      const tutor = await this.runTutor({ session, language, difficulty, history, studentMsg, onDelta: params.onDelta });
      tutorMessage = tutor.message;
      turnIn += tutor.tokensIn;
      turnOut += tutor.tokensOut;
      const leak = detectAnswerLeak(tutorMessage, session.practicalTask.referenceSolution);
      if (leak.leaked) {
        logger.warn({ sessionId: session.id, reason: leak.reason }, 'Утечка ответа — реплика заменена');
        tutorMessage = this.safeFallback(language);
        params.onDelta('\n' + tutorMessage); // безопасная замена уходит клиенту целиком
      }
    }

    // Персист реплики ассистента + per-message токены (FR-6.9/FR-R.3) + инкремент счётчиков.
    await prisma.chatMessage.create({
      data: { sessionId: session.id, role: 'AI', content: tutorMessage, tokensIn: turnIn, tokensOut: turnOut },
    });
    const updated = await prisma.practicalSession.update({
      where: { id: session.id },
      data: {
        aiMessageCount: { increment: 1 },
        tokensUsed: { increment: turnIn + turnOut }, // атомарно (аудит H5) — не read-modify-write
        lastActivityAt: new Date(),
      },
    });

    return {
      status: 'IN_PROGRESS',
      tutorMessage,
      reachedAnswer: false,
      aiMessageCount: updated.aiMessageCount,
      maxAiMessages: updated.maxAiMessages,
      remainingAiMessages: Math.max(0, updated.maxAiMessages - updated.aiMessageCount),
      assessment,
      integrityFlags: (studentMsg.integrityFlags as { type: string }[]) ?? undefined,
    };
  }

  private async runTutor(params: {
    session: SessionWithTask;
    language: Language;
    difficulty: Difficulty;
    history: ChatMessage[];
    studentMsg: ChatMessage;
    onDelta: StreamDelta;
  }): Promise<{ message: string; tokensIn: number; tokensOut: number }> {
    const sys = tutorSystemPrompt({
      language: params.language,
      difficulty: params.difficulty,
      scenario: params.session.practicalTask.scenarioPrompt, // БЕЗ эталона (изоляция утечки, §5.4)
    });
    let acc = '';
    const res = await this.gateway.stream(
      { model: env.LLM_MODEL_DIALOG, system: sys, cacheSystem: true, maxTokens: 300, messages: this.toLlm(params.history, params.studentMsg) },
      (chunk) => {
        acc += chunk;
        params.onDelta(chunk);
      },
    );
    return { message: this.clamp(acc || res.text), tokensIn: res.usage.inputTokens, tokensOut: res.usage.outputTokens };
  }

  /** Завершение сессии со статусом + агрегат рубрики (§5.5). */
  private async finalize(
    session: SessionWithTask,
    p: {
      status: 'PASSED' | 'FAILED';
      closing: string;
      tokensUsed: number;
      aiMessageCount: number;
      verdictReason: string;
      reached: boolean;
      userId: string;
      cohortId: string | null;
    },
  ): Promise<TurnResult> {
    const aggregate = await this.aggregateRubric(session.id, p.reached);
    await prisma.chatMessage.create({
      data: { sessionId: session.id, role: 'SYSTEM', content: p.closing, tokensIn: 0, tokensOut: 0 },
    });
    const updated = await prisma.practicalSession.update({
      where: { id: session.id },
      data: {
        status: p.status,
        tokensUsed: p.tokensUsed,
        verdictReason: p.verdictReason,
        evaluationResult: aggregate as object,
        endedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });
    await logEvent({
      eventType: EventType.PRACTICAL_SESSION_VERDICT,
      userId: p.userId,
      sessionId: session.id,
      enrollmentId: session.enrollmentId,
      cohortId: p.cohortId,
      payload: { status: p.status, reason: p.verdictReason, aggregate },
    });
    return {
      status: updated.status,
      tutorMessage: p.closing,
      reachedAnswer: p.reached,
      aiMessageCount: updated.aiMessageCount,
      maxAiMessages: updated.maxAiMessages,
      remainingAiMessages: Math.max(0, updated.maxAiMessages - updated.aiMessageCount),
      verdictReason: p.verdictReason,
      evaluationResult: aggregate,
    };
  }

  /** Агрегирование пошаговых оценок рубрики по всей сессии. */
  private async aggregateRubric(sessionId: string, reached: boolean): Promise<RubricAggregate> {
    const msgs = await prisma.chatMessage.findMany({
      where: { sessionId, role: 'STUDENT', NOT: { turnAssessment: { equals: null as never } } },
      orderBy: { createdAt: 'asc' },
    });
    const assessments = msgs
      .map((m) => reasoningAssessmentSchema.safeParse(m.turnAssessment))
      .filter((r) => r.success)
      .map((r) => (r as { data: ReasoningAssessment }).data);
    const n = assessments.length || 1;
    const sum = (k: keyof ReasoningAssessment) =>
      assessments.reduce((s, a) => s + (typeof a[k] === 'number' ? (a[k] as number) : 0), 0);
    return {
      turns: assessments.length,
      avg_methodicalness: +(sum('methodicalness') / n).toFixed(2),
      avg_question_quality: +(sum('question_quality') / n).toFixed(2),
      avg_logical_progression: +(sum('logical_progression') / n).toFixed(2),
      avg_self_correction: +(sum('self_correction') / n).toFixed(2),
      reached_answer: reached,
      reached_at_turn: reached ? assessments.length : null,
    };
  }

  private clamp(msg: string): string {
    const t = msg.trim();
    return t.length > TUTOR_MESSAGE_MAX_CHARS ? t.slice(0, TUTOR_MESSAGE_MAX_CHARS).trimEnd() + '…' : t;
  }

  private safeFallback(language: Language): string {
    const m: Record<Language, string> = {
      kk: 'Келесі қадамды өзіңіз тұжырымдап көріңіз: қандай белгі болжамыңызды тексереді?',
      ru: 'Попробуйте сформулировать следующий шаг сами: какой признак проверит вашу гипотезу?',
      en: 'Try to formulate the next step yourself: what would confirm your hypothesis?',
    };
    return m[language] ?? m.ru;
  }

  /** История → сообщения для LLM (SYSTEM-реплики опускаем). */
  private toLlm(history: ChatMessage[], current: ChatMessage) {
    const all = history.some((m) => m.id === current.id) ? history : [...history, current];
    return all
      .filter((m) => m.role !== 'SYSTEM')
      .map((m) => ({ role: (m.role === 'AI' ? 'assistant' : 'user') as 'assistant' | 'user', content: m.content }));
  }
}

export const orchestrator = new SocraticOrchestrator();
