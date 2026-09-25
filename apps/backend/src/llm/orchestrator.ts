import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { PracticalSession, PracticalTask, ChatMessage } from '@prisma/client';
import {
  EventType,
  IntegrityFlagType,
  TUTOR_MESSAGE_MAX_CHARS,
  type Difficulty,
  type Language,
  type PracticalSessionMetrics,
  type PracticalTaskSnapshot,
  type SessionStatus,
  type VerdictCode,
} from '@edu/shared';
import {
  judgeOutputSchema,
  socraticTurnSchema,
  reasoningAssessmentSchema,
  leakCheckOutputSchema,
  normalizeJudgeOutput,
  type JudgeOutput,
  type ReasoningAssessment,
  type RubricAggregate,
} from './schemas/dialog.js';
import { prisma } from '../lib/prisma.js';
import { getGateway, addUsage } from './gateway.js';
import { env, tokenCeilingFor } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { Errors } from '../lib/errors.js';
import { logEvent } from '../telemetry/events.js';
import { detectAnswerLeak } from './leakDetector.js';
import { runLeakCheck, leakDecision, type LeakCheckRecord } from './leakCheck.js';
import { sanitizeTutorReply } from './sanitize.js';
import {
  costUsd,
  decideTurnOutcome,
  detectIntegritySignals,
  guardVerdict,
  isNearCeiling,
  mapVerdict,
  passGate,
  tutorReplyCounts,
  tutorWindow,
  type FallbackCause,
  type FinalOutcome,
  type IntegrityFlag,
} from './rules.js';
import {
  tutorSystemPrompt,
  judgeSystemPrompt,
  judgeTranscript,
  singleCallSystemPrompt,
  TUTOR_SHORTER_INSTRUCTION,
  DIALOG_PROMPT_VERSION,
  type TranscriptLine,
} from './prompts/dialog.js';
import { generateEvaluationSummary, type SummaryRunResult } from './evaluationSummary.js';
import type { CompletionRequest, TokenUsage } from './types.js';

/**
 * Локализованные служебные реплики (не от LLM — экономия + отсутствие утечки).
 * Обращение фиксированное: ru «вы», kk «Сіз», en "you" (калибровка A.2).
 */
export const CLOSING = {
  passed: {
    kk: 'Сіз негізделген қорытындыға келдіңіз. Тапсырма орындалды.',
    ru: 'Вы пришли к обоснованному выводу. Задание выполнено.',
    en: 'You have reached a well-founded conclusion. The task is complete.',
  },
  failedLimit: {
    kk: 'Қорытынды жасалғанға дейін тьютордың жауаптары таусылды. Тапсырма орындалмады.',
    ru: 'Ответы тьютора закончились до итогового вывода. Задание не выполнено.',
    en: 'The tutor’s replies ran out before a final conclusion. The task is not complete.',
  },
  failedCeiling: {
    kk: 'Сессияның техникалық лимиті таусылды. Тапсырма орындалмады.',
    ru: 'Достигнут технический лимит сессии. Задание не выполнено.',
    en: 'The session’s technical limit was reached. The task is not complete.',
  },
  endedByStudent: {
    kk: 'Сіз диалогты аяқтадыңыз. Баға бұған дейін айтылғандар бойынша қойылады.',
    ru: 'Вы завершили диалог. Оценка выставляется по уже сказанному.',
    en: 'You ended the dialogue. It is assessed on what you have already said.',
  },
} as const satisfies Record<string, Record<Language, string>>;

/** Безопасный наводящий вопрос — замена реплики при утечке/сбое проверки/обрыве (A21, A22). */
export const FALLBACK_QUESTION: Record<Language, string> = {
  kk: 'Келесі қадамды өзіңіз тұжырымдап көріңіз: осы кезеңде қандай қорытынды жасайсыз және ол неге сүйенеді?',
  ru: 'Попробуйте сформулировать следующий шаг сами: какой вывод вы делаете на этом этапе и на чём он основан?',
  en: 'Try to formulate the next step yourself: what conclusion do you draw at this point, and what is it based on?',
};

export function fallbackQuestion(language: Language): string {
  return FALLBACK_QUESTION[language] ?? FALLBACK_QUESTION.ru;
}

export type Rubric = { key_points: string[]; answer_reached_criteria: string };

/** metrics сессии: контракт PracticalSessionMetrics + накопительная стоимость (USD). */
export type StoredMetrics = PracticalSessionMetrics & { costUsd: number };

/** Вызов LLM в трассе хода (для харнесса калибровки; клиенту не уходит). */
export interface CallTrace {
  ms: number;
  usage: TokenUsage;
}

/** Трасса хода: тайминги, токены по вызовам, замены. ТОЛЬКО сервер/харнесс. */
export interface TurnTrace {
  judge: CallTrace | null;
  confirm: CallTrace | null;
  tutor: CallTrace | null;
  leak: CallTrace | null;
  totalMs: number;
  rawTutorText: string | null;
  hadMarkdown: boolean;
  fallback: FallbackCause | null;
  lengthRetries: number;
  counted: boolean;
  judgeOutput: JudgeOutput | null;
  confirmOutput: JudgeOutput | null;
}

/**
 * Результат хода. Клиенту уходит ТОЛЬКО allowlist TurnDone (practical/sessions.view.ts, A1):
 * поля ниже разделителя — вывод судьи и служебные данные, студенту их видеть нельзя.
 */
export interface TurnResult {
  status: SessionStatus;
  verdictCode: VerdictCode | null;
  tutorMessage: string;
  tutorMessageId: string;
  userMessageId: string;
  aiMessageCount: number;
  maxAiMessages: number;
  remainingAiMessages: number;
  // ── только сервер ──
  verdictReason?: string | null;
  assessment?: ReasoningAssessment;
  integrityFlags?: IntegrityFlag[];
  leakCheck?: LeakCheckRecord | null;
  evaluationResult?: RubricAggregate;
  tokensUsed: number;
  tokenCeiling: number;
  trace: TurnTrace;
  /** Фоновая итоговая оценка (харнесс её дожидается; маршрут — нет, A23) */
  summary?: Promise<SummaryRunResult>;
}

type SessionWithTask = PracticalSession & {
  practicalTask: PracticalTask & { module: { courseLanguageVersionId: string; languageVersion: { language: string } } };
};

/** Контекст диалога для судьи и тьютора (без БД — его строит и харнесс калибровки). */
export interface DialogContext {
  language: Language;
  difficulty: Difficulty;
  scenario: string;
  rubric: Rubric;
  referenceSolution: string;
  sections: string[];
  tokenCeiling: number;
  maxChars: number;
}

export interface GateResult {
  primary: JudgeOutput;
  confirm: JudgeOutput | null;
  passed: boolean;
  /** Сырой вердикт модели был true, но страж его отменил (criterion_missing не пуст) */
  guardOverride: boolean;
  primaryTrace: CallTrace;
  confirmTrace: CallTrace | null;
  /** Реплика тьютора из однокального режима */
  tutorText: string | null;
}

const ZERO: TokenUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 };
const raw = (u: TokenUsage | null | undefined) => (u ? u.inputTokens + u.outputTokens : 0);
const sumUsage = (...xs: (TokenUsage | null | undefined)[]) => xs.reduce<TokenUsage>((a, b) => (b ? addUsage(a, b) : a), ZERO);

const SESSION_INCLUDE = {
  practicalTask: { include: { module: { select: { courseLanguageVersionId: true, languageVersion: { select: { language: true } } } } } },
} as const;

/** Начальные метрики сессии (FR-R.7): версия промптов и действующие настройки. */
export function initialMetrics(): StoredMetrics {
  return {
    promptVersion: DIALOG_PROMPT_VERSION,
    judgeCalls: 0,
    confirmCalls: 0,
    leakChecks: 0,
    leakPrevented: 0,
    leakCheckTimeouts: 0,
    lengthRetries: 0,
    nearCeiling: false,
    auxTokens: { input: 0, cachedInput: 0, output: 0, reasoning: 0 },
    settings: {
      temperature: env.DIALOG_TEMPERATURE,
      judgeConfirm: env.JUDGE_CONFIRM_ENABLED,
      leakCheck: env.LEAK_CHECK_ENABLED,
      leakFailMode: env.LEAK_CHECK_FAIL_MODE,
    },
    costUsd: 0,
  };
}

/** metrics из БД поверх значений по умолчанию (старые сессии без metrics). */
function metricsOf(s: PracticalSession): StoredMetrics {
  const stored = (s.metrics as Partial<StoredMetrics> | null) ?? {};
  const base = initialMetrics();
  return { ...base, ...stored, auxTokens: { ...base.auxTokens, ...(stored.auxTokens ?? {}) }, settings: { ...base.settings, ...(stored.settings ?? {}) } };
}

function addAux(m: StoredMetrics, u: TokenUsage | null | undefined): void {
  if (!u) return;
  m.auxTokens.input += u.inputTokens;
  m.auxTokens.cachedInput += u.cachedInputTokens ?? 0;
  m.auxTokens.output += u.outputTokens;
  m.auxTokens.reasoning += u.reasoningTokens ?? 0;
}

function addCost(m: StoredMetrics, u: TokenUsage): void {
  const add = costUsd(
    { input: u.inputTokens, cachedInput: u.cachedInputTokens ?? 0, output: u.outputTokens },
    { input: env.LLM_PRICE_INPUT_PER_MTOK, cachedInput: env.LLM_PRICE_CACHED_INPUT_PER_MTOK, output: env.LLM_PRICE_OUTPUT_PER_MTOK },
  );
  m.costUsd = +(m.costUsd + add).toFixed(6);
}

/** Снимок задания на момент старта (правка задания не меняет условий идущей сессии). */
export function taskSnapshotOf(task: PracticalTask): PracticalTaskSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    canonicalRef: task.canonicalRef ?? null,
    title: task.title,
    scenarioPrompt: task.scenarioPrompt,
    rubricSpec: task.rubricSpec,
    referenceSolutionSha256: createHash('sha256').update(task.referenceSolution).digest('hex'),
  };
}

/** Техническая ошибка хода: статус не меняется, лимит не расходуется, вердикта нет (§5.7, A4). */
const technical = (msg: string) => Errors.upstream(msg);

/* ── Ядро хода без БД: судья + PASS-гейт, реплика тьютора с проверками ─────────
 * Используется оркестратором и харнессом калибровки (scripts/eval-judge.ts) —
 * харнесс проверяет ровно тот же код, что работает у студентов.
 */

/** Реплика истории диалога (строка ChatMessage или фикстура харнесса). */
export interface DialogMessage {
  role: string;
  content: string;
}

/** Транскрипт для судьи: без SYSTEM; вводная реплика = сценарию не дублируется (он в system). */
export function transcriptFor(history: readonly DialogMessage[], scenario: string): TranscriptLine[] {
  const lines = history
    .filter((m) => m.role === 'AI' || m.role === 'STUDENT')
    .map((m) => ({ role: m.role as 'AI' | 'STUDENT', content: m.content }));
  if (lines[0]?.role === 'AI' && lines[0].content.trim() === scenario.trim()) lines.shift();
  return lines;
}

/**
 * Структурированный вызов судьи: сбой после ретраев/ремонта — техническая ошибка
 * хода с понятным студенту текстом (сообщение шлюза рассчитано на генерацию).
 */
async function judgeStructured<S extends z.ZodTypeAny>(req: CompletionRequest, schema: S, label: string) {
  try {
    return await getGateway().completeStructured(req, schema, label);
  } catch (err) {
    logger.error({ err, label }, 'Вызов судьи не удался — ход не засчитан, студент повторит отправку');
    throw technical('Оценка хода временно недоступна — повторите отправку');
  }
}

/**
 * Судья + PASS-гейт (A2, A4). Основной вызов (effort по назначению judge = low);
 * при «достигнут» и включённом подтверждении — второй вызов с тем же входом на
 * JUDGE_CONFIRM_EFFORT. finish_reason=length или отсутствие поля вердикта —
 * техническая ошибка хода (не вердикт, лимит не расходуется).
 */
export async function runJudgeGate(
  ctx: DialogContext,
  history: readonly DialogMessage[],
  opts: { singleCall?: boolean } = {},
): Promise<GateResult> {
  const judgeParams = {
    language: ctx.language,
    scenario: ctx.scenario,
    referenceSolution: ctx.referenceSolution,
    rubricKeyPoints: ctx.rubric.key_points,
    answerReachedCriteria: ctx.rubric.answer_reached_criteria,
  };
  const judgeReq: CompletionRequest = {
    model: env.LLM_MODEL_JUDGE,
    purpose: 'judge',
    system: judgeSystemPrompt(judgeParams),
    cacheSystem: true,
    maxTokens: env.JUDGE_MAX_TOKENS,
    messages: [{ role: 'user', content: judgeTranscript(transcriptFor(history, ctx.scenario)) }],
  };

  let primary: JudgeOutput;
  let tutorText: string | null = null;
  let primaryUsage: TokenUsage;
  const t1 = Date.now();
  if (opts.singleCall) {
    const { data, result } = await judgeStructured(
      {
        model: env.LLM_MODEL_DIALOG,
        purpose: 'judge',
        system: singleCallSystemPrompt({ ...judgeParams, difficulty: ctx.difficulty, sections: ctx.sections }),
        cacheSystem: true,
        maxTokens: env.JUDGE_MAX_TOKENS + (ctx.language === 'kk' ? env.TUTOR_MAX_TOKENS_KK : env.TUTOR_MAX_TOKENS),
        messages: judgeReq.messages,
      },
      socraticTurnSchema,
      'single_call',
    );
    if (result.finishReason === 'length') throw technical('Оценка хода оборвалась — повторите отправку');
    const { tutor_message, ...judgeData } = data;
    primary = judgeData;
    tutorText = tutor_message;
    primaryUsage = result.usage;
  } else {
    const { data, result } = await judgeStructured(judgeReq, judgeOutputSchema, 'judge');
    if (result.finishReason === 'length') throw technical('Оценка хода оборвалась — повторите отправку');
    primary = data;
    primaryUsage = result.usage;
  }
  primary = normalizeJudgeOutput(primary, ctx.rubric.key_points.length);
  const primaryTrace: CallTrace = { ms: Date.now() - t1, usage: primaryUsage };

  let confirm: JudgeOutput | null = null;
  let confirmTrace: CallTrace | null = null;
  if (guardVerdict(primary) && env.JUDGE_CONFIRM_ENABLED) {
    const t2 = Date.now();
    const { data, result } = await judgeStructured({ ...judgeReq, reasoningEffort: env.JUDGE_CONFIRM_EFFORT }, judgeOutputSchema, 'judge_confirm');
    if (result.finishReason === 'length') throw technical('Оценка хода оборвалась — повторите отправку');
    confirm = normalizeJudgeOutput(data, ctx.rubric.key_points.length);
    confirmTrace = { ms: Date.now() - t2, usage: result.usage };
  }
  return {
    primary,
    confirm,
    passed: passGate(primary, confirm, env.JUDGE_CONFIRM_ENABLED),
    guardOverride: primary.student_reached_answer && !guardVerdict(primary),
    primaryTrace,
    confirmTrace,
    tutorText,
  };
}

/** Пошаговая оценка на реплике студента (§5.5, FR-R.3): рубрика + оба вызова судьи. */
export function turnAssessmentRecord(gate: GateResult) {
  const pick = (j: JudgeOutput) => ({
    covered_key_points: j.covered_key_points,
    missing_key_points: j.missing_key_points,
    criterion_missing: j.criterion_missing,
    student_reached_answer: j.student_reached_answer,
  });
  return {
    ...gate.primary.reasoning_assessment,
    judge: pick(gate.primary),
    confirm: gate.confirm ? { ...pick(gate.confirm), reasoning_assessment: gate.confirm.reasoning_assessment } : null,
    gate: { passed: gate.passed, guardOverride: gate.guardOverride, confirmEnabled: env.JUDGE_CONFIRM_ENABLED },
    promptVersion: DIALOG_PROMPT_VERSION,
  };
}

/**
 * Тьютор (эталон НЕ в контексте). Реплика буферизуется целиком — клиент получит её
 * только после проверок. Обрыв по длине → один повтор с просьбой короче; повторный
 * обрыв → null (вызывающий подставит безопасный вопрос, A22).
 */
async function callTutor(
  ctx: DialogContext,
  history: readonly DialogMessage[],
  logSessionId?: string,
): Promise<{ text: string | null; usage: TokenUsage; lengthRetries: number }> {
  const system = tutorSystemPrompt({ language: ctx.language, difficulty: ctx.difficulty, scenario: ctx.scenario, sections: ctx.sections });
  const req: CompletionRequest = {
    model: env.LLM_MODEL_DIALOG,
    purpose: 'dialog',
    system,
    cacheSystem: true,
    temperature: env.DIALOG_TEMPERATURE,
    maxTokens: ctx.language === 'kk' ? env.TUTOR_MAX_TOKENS_KK : env.TUTOR_MAX_TOKENS,
    // Сценарий уже в system — вводную реплику-дубликат не пересылаем; тьютору — окно последних
    // реплик (A3: потолок/стоимость). Судья по-прежнему видит ВЕСЬ транскрипт.
    messages: tutorWindow(transcriptFor(history, ctx.scenario)).map((m) => ({
      role: (m.role === 'AI' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: m.content,
    })),
  };
  const gateway = getGateway();
  let res = await gateway.complete(req);
  let usage = res.usage;
  if (res.finishReason !== 'length' && res.text.trim()) return { text: res.text, usage, lengthRetries: 0 };
  logger.warn({ sessionId: logSessionId, finishReason: res.finishReason }, 'Реплика тьютора оборвалась по лимиту — повтор «короче»');
  res = await gateway.complete({ ...req, system: `${system}\n${TUTOR_SHORTER_INSTRUCTION}` });
  usage = addUsage(usage, res.usage);
  if (res.finishReason === 'length' || !res.text.trim()) return { text: null, usage, lengthRetries: 1 };
  return { text: res.text, usage, lengthRetries: 1 };
}

/** Результат или ошибка асинхронной операции — без «необработанного» reject, пока ждём судью. */
export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
export function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  return p.then(
    (value): Settled<T> => ({ ok: true, value }),
    (error): Settled<T> => ({ ok: false, error }),
  );
}

/** Черновик реплики тьютора: ответ модели целиком, ещё НЕ проверенный и студенту не отданный. */
export interface TutorDraft {
  text: string | null;
  usage: TokenUsage;
  lengthRetries: number;
  ms: number;
}

/**
 * Черновик тьютора — запускается ПАРАЛЛЕЛЬНО с судьёй (латентность хода, A23): в двухвызовном
 * режиме реплика тьютора не зависит от вывода судьи, эталона в её контексте нет. Проверки
 * утечки идут ПОСЛЕ вердикта и только если диалог продолжается: параллельный с судьёй
 * reasoning-вызов проверки замедлял оба вызова (замер: проверка 1 → 2,3 с, таймауты 3 с).
 */
export function draftTutorReply(ctx: DialogContext, history: readonly DialogMessage[], logSessionId?: string): Promise<Settled<TutorDraft>> {
  const t0 = Date.now();
  return settle(callTutor(ctx, history, logSessionId).then((r) => ({ ...r, ms: Date.now() - t0 })));
}

/** Итог подготовки реплики тьютора: выпускаемый текст, причина замены и учёт вызовов. */
export interface TutorReplyOutcome {
  /** Текст, который увидит студент (проверенный или безопасная замена) */
  text: string;
  fallback: FallbackCause | null;
  leakRecord: LeakCheckRecord | null;
  tutorUsage: TokenUsage | null;
  leakUsage: TokenUsage | null;
  tutorTrace: CallTrace | null;
  leakTrace: CallTrace | null;
  /** Сырой ответ модели до санитизации (для харнесса: доля markdown и т. п.) */
  rawText: string | null;
  hadMarkdown: boolean;
  lengthRetries: number;
  /** Семантическая проверка выполнялась */
  leakChecked: boolean;
  /** Проверка не завершилась (таймаут или сбой) */
  leakIncomplete: boolean;
}

/**
 * Реплика тьютора по порядку калибровки A.3: ответ модели целиком → санитизация →
 * дословный 4-граммный детектор → семантическая проверка. Утечка, таймаут/сбой
 * проверки (fail-closed), обрыв по длине → безопасный наводящий вопрос.
 */
export async function produceTutorReply(
  ctx: DialogContext,
  history: readonly DialogMessage[],
  opts: { presetText?: string | null; draft?: TutorDraft; logSessionId?: string } = {},
): Promise<TutorReplyOutcome> {
  const out: TutorReplyOutcome = {
    text: '',
    fallback: null,
    leakRecord: null,
    tutorUsage: null,
    leakUsage: null,
    tutorTrace: null,
    leakTrace: null,
    rawText: null,
    hadMarkdown: false,
    lengthRetries: 0,
    leakChecked: false,
    leakIncomplete: false,
  };
  let candidate: string | null;
  if (opts.presetText != null) {
    candidate = opts.presetText; // однокальный режим: реплика уже получена (токены — в основном вызове)
  } else {
    let tutor = opts.draft;
    if (!tutor) {
      const settled = await draftTutorReply(ctx, history, opts.logSessionId);
      if (!settled.ok) throw settled.error;
      tutor = settled.value;
    }
    out.tutorUsage = tutor.usage;
    out.tutorTrace = { ms: tutor.ms, usage: tutor.usage };
    out.lengthRetries = tutor.lengthRetries;
    candidate = tutor.text;
  }
  out.rawText = candidate;

  if (candidate === null || !candidate.trim()) {
    out.fallback = 'length';
  } else {
    const san = sanitizeTutorReply(candidate, ctx.maxChars);
    out.hadMarkdown = san.hadMarkdown;
    if (san.overLimit || !san.text) {
      out.fallback = 'over_limit';
    } else {
      out.text = san.text;
      const verbatim = detectAnswerLeak(san.text, ctx.referenceSolution);
      if (verbatim.leaked) {
        out.fallback = 'verbatim_leak';
        out.leakRecord = { leaks: true, reason: verbatim.reason ?? 'verbatim', ms: 0, timeout: false, verbatim: true };
      } else if (env.LEAK_CHECK_ENABLED) {
        const studentTurns = history.filter((m) => m.role === 'STUDENT').map((m) => m.content);
        const run = await runLeakCheck(
          { model: env.LLM_MODEL_JUDGE, rubricKeyPoints: ctx.rubric.key_points, referenceSolution: ctx.referenceSolution, studentTurns, reply: san.text },
          { call: (req) => getGateway().completeStructured(req, leakCheckOutputSchema, 'leak_check'), timeoutMs: env.LEAK_CHECK_TIMEOUT_MS },
        );
        out.leakChecked = true;
        out.leakUsage = run.usage;
        out.leakTrace = { ms: run.ms, usage: run.usage ?? ZERO };
        out.leakRecord = { leaks: run.leaks, reason: run.reason, ms: run.ms, timeout: run.timeout, ...(run.error ? { error: run.error } : {}) };
        const decision = leakDecision(run, env.LEAK_CHECK_FAIL_MODE);
        if (decision.cause === 'timeout' || decision.cause === 'error') {
          out.leakIncomplete = true;
          logger.warn({ sessionId: opts.logSessionId, cause: decision.cause, ms: run.ms, failMode: env.LEAK_CHECK_FAIL_MODE }, 'Проверка утечки не завершилась');
        }
        if (!decision.release) {
          out.fallback = decision.cause === 'leak' ? 'semantic_leak' : decision.cause === 'timeout' ? 'leak_timeout' : 'leak_error';
        } else if (decision.flagged) {
          out.leakRecord = { ...out.leakRecord, reason: `released unchecked (${decision.cause})` };
        }
      } else {
        out.leakRecord = { leaks: false, reason: '', ms: 0, timeout: false, skipped: true };
      }
    }
  }
  if (out.fallback === 'verbatim_leak' || out.fallback === 'semantic_leak') {
    logger.warn({ sessionId: opts.logSessionId, cause: out.fallback, reason: out.leakRecord?.reason }, 'Утечка ответа — реплика тьютора заменена');
  }
  if (out.fallback) out.text = fallbackQuestion(ctx.language);
  return out;
}

/**
 * Серверная авторитетная оркестрация сократического диалога (§5.4).
 * Клиенту нельзя доверять подсчёт токенов и вынесение вердикта.
 *
 * Порядок хода (калибровка A.3): судья (+ подтверждение PASS) → тьютор, ответ
 * буферизуется → санитизация → дословный детектор → семантическая проверка → только
 * потом реплика уходит студенту (маршрут шлёт ровно один delta и done-allowlist).
 */
export class SocraticOrchestrator {
  /** Стартует сессию: запись, снимок задания, метрики, первая реплика тьютора. */
  async startSession(params: {
    enrollmentId: string;
    task: PracticalTask;
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
        promptTemplateId: DIALOG_PROMPT_VERSION, // A26
        maxAiMessages: params.task.maxAiMessages,
        taskSnapshot: taskSnapshotOf(params.task) as object,
        metrics: initialMetrics() as object,
      },
    });

    // Первая реплика тьютора: вступление задания, иначе — сам сценарий (виден студенту).
    await prisma.chatMessage.create({
      data: { sessionId: session.id, role: 'AI', content: params.task.introMessage?.trim() || params.task.scenarioPrompt },
    });

    await logEvent({
      eventType: EventType.PRACTICAL_SESSION_STARTED,
      userId: params.userId,
      enrollmentId: params.enrollmentId,
      sessionId: session.id,
      cohortId: params.cohortId,
      payload: { taskId: params.task.id, mode: session.orchestrationMode, model: session.modelUsed, promptVersion: DIALOG_PROMPT_VERSION },
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
  }): Promise<TurnResult> {
    const t0 = Date.now();
    const session = await this.loadSession(params.sessionId);
    if (session.status !== 'IN_PROGRESS') throw Errors.conflict('Сессия уже завершена');
    const ctx = await this.context(session);
    const metrics = metricsOf(session);

    const history = await prisma.chatMessage.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: 'asc' } });

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
      history.push(studentMsg);
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

    // ── 1. Судья + PASS-гейт (A2); ПАРАЛЛЕЛЬНО — черновик тьютора (латентность, A23). Решение
    // о выпуске — только ПОСЛЕ вердикта: при PASS / лимите / потолке черновик выбрасывается
    // (токены — в стоимость и во вспомогательные, не в потолок); иначе он проходит санитизацию
    // и обе проверки утечки, и лишь затем уходит студенту (A21).
    // Технические ошибки LLM пробрасываются (Errors.upstream) БЕЗ смены статуса и БЕЗ
    // расхода лимита (§5.7): сообщение студента уже сохранено, повтор хода возобновит его.
    const singleCall = session.orchestrationMode === 'SINGLE_CALL';
    const draft = singleCall ? null : draftTutorReply(ctx, history, session.id);
    let gate: GateResult;
    try {
      gate = await runJudgeGate(ctx, history, { singleCall });
    } catch (err) {
      await this.chargeDiscardedDraft(session.id, metrics, draft);
      throw err;
    }
    metrics.judgeCalls++;
    if (gate.confirm) metrics.confirmCalls++;
    addAux(metrics, gate.confirmTrace?.usage);

    const assessment: ReasoningAssessment = { ...gate.primary.reasoning_assessment, notes: gate.primary.reasoning_assessment.notes ?? '' };
    const turnAssessment = turnAssessmentRecord(gate);
    await prisma.chatMessage.update({ where: { id: studentMsg.id }, data: { turnAssessment: turnAssessment as object } });
    await logEvent({
      eventType: EventType.PRACTICAL_ASSESSMENT_RECORDED,
      userId: params.userId,
      sessionId: session.id,
      enrollmentId: session.enrollmentId,
      cohortId: params.cohortId,
      payload: turnAssessment,
    });

    // Потолок: только основной судья и тьютор, накопительно и «сырыми» токенами (A3).
    const tokensBeforeTutor = session.tokensUsed + raw(gate.primaryTrace.usage);
    const trace: TurnTrace = {
      judge: gate.primaryTrace,
      confirm: gate.confirmTrace,
      tutor: null,
      leak: null,
      totalMs: 0,
      rawTutorText: null,
      hadMarkdown: false,
      fallback: null,
      lengthRetries: 0,
      counted: false,
      judgeOutput: gate.primary,
      confirmOutput: gate.confirm,
    };

    // FR-6.11: верный ответ первой же репликой (до единой реплики тьютора) — сигнал
    // возможной контаминации внешним ИИ. НЕ блокирует сдачу, но фиксируется.
    if (gate.passed && session.aiMessageCount === 0) {
      const flags = ((studentMsg.integrityFlags as IntegrityFlag[] | null) ?? []).concat({ type: IntegrityFlagType.CORRECT_ON_FIRST_MESSAGE });
      await prisma.chatMessage.update({ where: { id: studentMsg.id }, data: { integrityFlags: flags as object } });
      await logEvent({ eventType: EventType.PRACTICAL_INTEGRITY_FLAG, userId: params.userId, sessionId: session.id, enrollmentId: session.enrollmentId, cohortId: params.cohortId, payload: { type: IntegrityFlagType.CORRECT_ON_FIRST_MESSAGE } });
    }

    const outcome = decideTurnOutcome({
      reached: gate.passed,
      aiMessageCount: session.aiMessageCount,
      maxAiMessages: session.maxAiMessages,
      tokensUsedBeforeTutor: tokensBeforeTutor,
      tokenCeiling: ctx.tokenCeiling,
    });

    // ── 2. Итог хода без реплики тьютора: PASS / лимит реплик / потолок ──
    if (outcome !== 'CONTINUE') {
      const final: FinalOutcome = outcome === 'PASSED' ? { kind: 'PASSED' } : { kind: outcome };
      // Черновик тьютора не нужен: выбрасываем, но его токены учитываем (стоимость, не потолок).
      const settled = draft ? await draft : null;
      const discarded = settled?.ok ? settled.value.usage : null;
      addAux(metrics, discarded);
      const turnUsage = sumUsage(gate.primaryTrace.usage, gate.confirmTrace?.usage, discarded);
      const done = await this.finalize(session, ctx, metrics, {
        outcome: final,
        primaryTokens: raw(gate.primaryTrace.usage),
        turnUsage,
        verdictReason:
          outcome === 'PASSED'
            ? 'Студент пришёл к ответу: основной и подтверждающий вызовы судьи согласны, criterion_missing пуст.'
            : outcome === 'FAILED_LIMIT'
              ? 'Исчерпан лимит реплик тьютора.'
              : 'Достигнут токен-потолок сессии (предохранитель).',
        userId: params.userId,
        cohortId: params.cohortId,
        closingAssessment: null,
      });
      trace.totalMs = Date.now() - t0;
      return { ...done, userMessageId: studentMsg.id, assessment, integrityFlags: (studentMsg.integrityFlags as IntegrityFlag[] | null) ?? undefined, trace };
    }

    // ── 3. Реплика тьютора: буфер → санитизация → проверки утечки (A21, A22) ──
    const settled = draft ? await draft : null;
    if (settled && !settled.ok) throw settled.error; // сбой тьютора — технический: ход повторится
    const reply = await produceTutorReply(ctx, history, {
      presetText: gate.tutorText,
      draft: settled?.ok ? settled.value : undefined,
      logSessionId: session.id,
    });
    const { text, fallback, leakRecord } = reply;
    const tutorUsage = reply.tutorUsage;
    trace.tutor = reply.tutorTrace;
    trace.leak = reply.leakTrace;
    trace.rawTutorText = reply.rawText;
    trace.hadMarkdown = reply.hadMarkdown;
    trace.lengthRetries = reply.lengthRetries;
    trace.fallback = fallback;
    metrics.lengthRetries += reply.lengthRetries;
    if (reply.leakChecked) metrics.leakChecks++;
    if (reply.leakIncomplete) metrics.leakCheckTimeouts++;
    if (fallback === 'verbatim_leak' || fallback === 'semantic_leak') metrics.leakPrevented++;
    addAux(metrics, reply.leakUsage);
    const counted = tutorReplyCounts(fallback);
    trace.counted = counted;

    // Персист реплики тьютора: токены ВСЕХ вызовов хода — для стоимости (A3).
    const turnUsage = sumUsage(gate.primaryTrace.usage, gate.confirmTrace?.usage, tutorUsage, trace.leak?.usage);
    addCost(metrics, turnUsage);
    const primaryTokens = raw(gate.primaryTrace.usage) + raw(tutorUsage);
    const tokensUsed = session.tokensUsed + primaryTokens;
    if (!metrics.nearCeiling && isNearCeiling(tokensUsed, ctx.tokenCeiling)) {
      metrics.nearCeiling = true;
      logger.warn({ sessionId: session.id, tokensUsed, ceiling: ctx.tokenCeiling }, 'Сессия практикума у токен-потолка (≥ 80 %)');
    }

    const aiMsg = await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'AI',
        content: text,
        tokensIn: turnUsage.inputTokens,
        tokensOut: turnUsage.outputTokens,
        cachedInputTokens: turnUsage.cachedInputTokens ?? 0,
        reasoningTokens: turnUsage.reasoningTokens ?? 0,
        leakCheck: leakRecord ? ({ ...leakRecord, fallback } as object) : undefined,
      },
    });
    const updated = await prisma.practicalSession.update({
      where: { id: session.id },
      data: {
        ...(counted ? { aiMessageCount: { increment: 1 } } : {}),
        tokensUsed: { increment: primaryTokens }, // атомарно (аудит H5)
        lastActivityAt: new Date(),
        metrics: metrics as object,
      },
    });

    trace.totalMs = Date.now() - t0;
    return {
      status: 'IN_PROGRESS',
      verdictCode: null,
      tutorMessage: text,
      tutorMessageId: aiMsg.id,
      userMessageId: studentMsg.id,
      aiMessageCount: updated.aiMessageCount,
      maxAiMessages: updated.maxAiMessages,
      remainingAiMessages: Math.max(0, updated.maxAiMessages - updated.aiMessageCount),
      assessment,
      integrityFlags: (studentMsg.integrityFlags as IntegrityFlag[] | null) ?? undefined,
      leakCheck: leakRecord,
      tokensUsed: updated.tokensUsed,
      tokenCeiling: ctx.tokenCeiling,
      trace,
    };
  }

  /**
   * Завершение сессии студентом (DONE / OTHER): финальная оценка судьи по всему
   * транскрипту тем же PASS-гейтом. PASSED, если гейт пройден, иначе ENDED_BY_STUDENT.
   * Без реплик студента — сразу ENDED_BY_STUDENT без вызова LLM.
   */
  async endSession(params: { sessionId: string; reason: 'DONE' | 'OTHER'; userId: string; cohortId: string | null }): Promise<TurnResult | null> {
    const t0 = Date.now();
    const session = await this.loadSession(params.sessionId);
    if (session.status !== 'IN_PROGRESS') return null; // уже завершена — идемпотентно
    const ctx = await this.context(session);
    const metrics = metricsOf(session);
    const history = await prisma.chatMessage.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: 'asc' } });
    const studentCount = history.filter((m) => m.role === 'STUDENT').length;

    let gate: GateResult | null = null;
    if (studentCount > 0) {
      gate = await runJudgeGate(ctx, history);
      metrics.judgeCalls++;
      if (gate.confirm) metrics.confirmCalls++;
      addAux(metrics, gate.confirmTrace?.usage);
    }
    const outcome: FinalOutcome = gate?.passed ? { kind: 'PASSED', endReason: params.reason } : { kind: 'ENDED_BY_STUDENT', endReason: params.reason };
    const done = await this.finalize(session, ctx, metrics, {
      outcome,
      primaryTokens: raw(gate?.primaryTrace.usage),
      turnUsage: sumUsage(gate?.primaryTrace.usage, gate?.confirmTrace?.usage),
      verdictReason: gate?.passed
        ? 'Студент завершил диалог; финальная оценка: ответ достигнут (оба вызова судьи согласны).'
        : `Студент завершил диалог (${params.reason}); финальная оценка: ответ не достигнут.`,
      userId: params.userId,
      cohortId: params.cohortId,
      closingAssessment: gate ? { kind: 'END_EVALUATION', ...turnAssessmentRecord(gate) } : null,
    });
    const trace: TurnTrace = {
      judge: gate?.primaryTrace ?? null,
      confirm: gate?.confirmTrace ?? null,
      tutor: null,
      leak: null,
      totalMs: Date.now() - t0,
      rawTutorText: null,
      hadMarkdown: false,
      fallback: null,
      lengthRetries: 0,
      counted: false,
      judgeOutput: gate?.primary ?? null,
      confirmOutput: gate?.confirm ?? null,
    };
    return { ...done, userMessageId: '', trace };
  }

  /* ── Внутреннее ─────────────────────────────────────────────────── */

  /** Судья упал — ход повторится, но уже потраченные токены черновика тьютора учитываем (A3). */
  private async chargeDiscardedDraft(sessionId: string, metrics: StoredMetrics, draft: Promise<Settled<TutorDraft>> | null): Promise<void> {
    const settled = draft ? await draft : null;
    if (!settled?.ok) return;
    addAux(metrics, settled.value.usage);
    addCost(metrics, settled.value.usage);
    await prisma.practicalSession.update({ where: { id: sessionId }, data: { metrics: metrics as object } }).catch(() => undefined);
  }

  private async loadSession(sessionId: string): Promise<SessionWithTask> {
    const session = (await prisma.practicalSession.findUnique({ where: { id: sessionId }, include: SESSION_INCLUDE })) as SessionWithTask | null;
    if (!session) throw Errors.notFound('Сессия не найдена');
    return session;
  }

  /** Контекст хода: язык версии, снимок задания (если есть), разделы курса, потолок. */
  private async context(session: SessionWithTask): Promise<DialogContext> {
    const task = session.practicalTask;
    const language = task.module.languageVersion.language as Language;
    const snapshot = session.taskSnapshot as PracticalTaskSnapshot | null;
    const rubric = (snapshot?.rubricSpec ?? task.rubricSpec) as Rubric;
    const modules = await prisma.module.findMany({
      where: { courseLanguageVersionId: task.module.courseLanguageVersionId, lectures: { some: {} } },
      orderBy: { orderIndex: 'asc' },
      select: { title: true },
    });
    return {
      language,
      difficulty: task.difficulty as Difficulty,
      scenario: snapshot?.scenarioPrompt ?? task.scenarioPrompt,
      rubric: { key_points: rubric?.key_points ?? [], answer_reached_criteria: rubric?.answer_reached_criteria ?? '' },
      referenceSolution: task.referenceSolution,
      sections: modules.map((m) => m.title),
      // 5.6b: потолок = бюджет задания (калибрует менеджер/CONTENT), env по языку — фолбэк.
      tokenCeiling: task.tokenBudget > 0 ? task.tokenBudget : tokenCeilingFor(language),
      maxChars: language === 'kk' ? env.TUTOR_MESSAGE_MAX_CHARS_KK : TUTOR_MESSAGE_MAX_CHARS,
    };
  }

  /** Завершение сессии: вердикт, код, причина, агрегат рубрики, фоновая итоговая оценка. */
  private async finalize(
    session: SessionWithTask,
    ctx: DialogContext,
    metrics: StoredMetrics,
    p: {
      outcome: FinalOutcome;
      primaryTokens: number;
      turnUsage: TokenUsage;
      verdictReason: string;
      userId: string;
      cohortId: string | null;
      closingAssessment: Record<string, unknown> | null;
    },
  ): Promise<Omit<TurnResult, 'userMessageId' | 'trace'>> {
    const v = mapVerdict(p.outcome);
    const reached = v.verdictCode === 'PASSED';
    const aggregate = await this.aggregateRubric(session.id, reached);
    const closing = this.closingText(v.verdictCode, ctx.language);
    addCost(metrics, p.turnUsage);
    const tokensUsed = session.tokensUsed + p.primaryTokens;
    if (!metrics.nearCeiling && isNearCeiling(tokensUsed, ctx.tokenCeiling)) metrics.nearCeiling = true;

    const closingMsg = await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'SYSTEM',
        content: closing,
        tokensIn: p.turnUsage.inputTokens,
        tokensOut: p.turnUsage.outputTokens,
        cachedInputTokens: p.turnUsage.cachedInputTokens ?? 0,
        reasoningTokens: p.turnUsage.reasoningTokens ?? 0,
        turnAssessment: p.closingAssessment ? (p.closingAssessment as object) : undefined,
      },
    });
    const now = new Date();
    const updated = await prisma.practicalSession.update({
      where: { id: session.id },
      data: {
        status: v.status,
        verdictCode: v.verdictCode,
        endReason: v.endReason,
        verdictReason: p.verdictReason, // только для сотрудников; студенту — verdictCode
        tokensUsed,
        evaluationResult: aggregate as object,
        summaryStatus: 'PENDING',
        metrics: metrics as object,
        endedAt: now,
        lastActivityAt: now,
      },
    });
    await logEvent({
      eventType: EventType.PRACTICAL_SESSION_VERDICT,
      userId: p.userId,
      sessionId: session.id,
      enrollmentId: session.enrollmentId,
      cohortId: p.cohortId,
      payload: { status: v.status, verdictCode: v.verdictCode, reason: p.verdictReason, aggregate },
    });
    await logEvent({
      eventType: EventType.PRACTICAL_SESSION_ENDED,
      userId: p.userId,
      sessionId: session.id,
      enrollmentId: session.enrollmentId,
      cohortId: p.cohortId,
      payload: { verdictCode: v.verdictCode, endReason: v.endReason },
    });
    const { recomputeProgress } = await import('../modules/learn/progress.service.js');
    await recomputeProgress(session.enrollmentId);

    // Итоговая оценка — асинхронно: ответ с вердиктом её не ждёт (A23).
    const summary = generateEvaluationSummary(session.id).catch((err): SummaryRunResult => {
      logger.error({ err, sessionId: session.id }, 'Фоновая итоговая оценка упала');
      return { status: 'FAILED', summary: null, usage: null, droppedLines: 0, error: (err as Error)?.message };
    });

    return {
      status: updated.status,
      verdictCode: v.verdictCode,
      tutorMessage: closing,
      tutorMessageId: closingMsg.id,
      aiMessageCount: updated.aiMessageCount,
      maxAiMessages: updated.maxAiMessages,
      remainingAiMessages: Math.max(0, updated.maxAiMessages - updated.aiMessageCount),
      verdictReason: p.verdictReason,
      evaluationResult: aggregate,
      tokensUsed: updated.tokensUsed,
      tokenCeiling: ctx.tokenCeiling,
      summary,
    };
  }

  private closingText(code: VerdictCode, language: Language): string {
    const key =
      code === 'PASSED' ? 'passed' : code === 'FAILED_LIMIT' ? 'failedLimit' : code === 'FAILED_CEILING' ? 'failedCeiling' : 'endedByStudent';
    return CLOSING[key][language] ?? CLOSING[key].ru;
  }

  /** Агрегирование пошаговых оценок рубрики по всей сессии. */
  async aggregateRubric(sessionId: string, reached: boolean): Promise<RubricAggregate> {
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
}

export const orchestrator = new SocraticOrchestrator();
