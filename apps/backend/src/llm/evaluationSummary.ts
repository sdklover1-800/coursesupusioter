import type { Language, RubricCriterion } from '@edu/shared';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { getGateway, addUsage } from './gateway.js';
import type { CompletionResult, TokenUsage } from './types.js';
import {
  evaluationSummaryOutputSchema,
  summaryLeakCheckOutputSchema,
  reasoningAssessmentSchema,
  rubricAggregateSchema,
  RUBRIC_CRITERIA,
  type EvaluationSummaryOutput,
} from './schemas/dialog.js';
import {
  evaluationSummarySystemPrompt,
  evaluationSummaryUserMessage,
  summaryLeakCheckSystemPrompt,
  scoreLevel,
  DIALOG_PROMPT_VERSION,
  type ScoreLevel,
} from './prompts/dialog.js';
import { detectAnswerLeak } from './leakDetector.js';
import { informalAddress } from './addressForm.js';
import { sanitizeTutorReply } from './sanitize.js';
import { costUsd } from './rules.js';

/**
 * Итоговая оценка сессии практикума для студента (калибровка A.5, A6, A23).
 *
 * Один вызов после вердикта (любого): судья, effort low, ≤ 500 токенов вывода, язык
 * сессии, формальное обращение. На вход — ТОЛЬКО реплики студента (с id) и пошаговые
 * баллы; эталон, тезисы, missing/criterion_missing не передаются (A6). Текст отзыва
 * проходит проверку на раскрытие ответа: раскрывающие строки выбрасываются, баллы
 * остаются. На вердикт не влияет никогда. Сбой → summaryStatus FAILED (студент видит
 * баллы без строк). Запускается асинхронно — ответ со статусом не ждёт отзыва (A23).
 */

const SUMMARY_MAX_TOKENS = 500;
const SUMMARY_LINE_MAX_CHARS = 240;
const SUMMARY_LEAK_TIMEOUT_MS = 15_000; // фоновая задача (A23): студент её не ждёт
const STUDENT_TURN_MAX_CHARS = 1200;

/** Сохранённая оценка (PracticalSession.summary). Что из неё видно студенту — решает sessions.view.ts. */
export interface StoredSessionSummary {
  criteria: { key: RubricCriterion; score: number; line: string | null }[];
  strengths: string[];
  toDevelop: string[];
  highlights: { messageId: string; criterion: RubricCriterion; polarity: 'plus' | 'minus'; note: string }[];
  /** Сколько строк выброшено проверкой утечки */
  droppedLines: number;
  /** Сколько строк выброшено проверкой формы обращения (ru «вы», kk «Сіз», A.2) */
  addressDropped?: number;
  promptVersion: string;
  generatedAt: string;
}

/** Пошаговые баллы реплик студента по id (null — у реплики нет оценки судьи). */
export type TurnScores = ReadonlyMap<string, Record<RubricCriterion, number> | null>;

interface SummaryLine {
  text: string;
  drop: () => void;
}

function cleanLine(s: string): string {
  const t = sanitizeTutorReply(s, SUMMARY_LINE_MAX_CHARS).text;
  return t.length > SUMMARY_LINE_MAX_CHARS ? t.slice(0, SUMMARY_LINE_MAX_CHARS) : t;
}

/**
 * Нейтральная строка критерия по уровню итогового балла — когда строки модели нет или она
 * выброшена проверкой. Ничего не говорит о содержании ответа (A6), только об уровне.
 */
const LEVEL_LINE: Record<Language, Record<ScoreLevel, string>> = {
  ru: {
    0: 'Пока почти не проявлялось в ваших репликах.',
    1: 'Проявлялось эпизодически, не во всех ваших репликах.',
    2: 'Проявлялось в большинстве ваших реплик.',
    3: 'Устойчиво проявлялось на протяжении всего диалога.',
  },
  kk: {
    0: 'Бұл Сіздің репликаларыңызда әзірге сирек байқалды.',
    1: 'Бұл Сіздің кейбір репликаларыңызда ғана байқалды.',
    2: 'Бұл Сіздің репликаларыңыздың көбінде байқалды.',
    3: 'Бұл диалог бойы тұрақты байқалды.',
  },
  en: {
    0: 'This has barely shown in your replies so far.',
    1: 'This showed only in some of your replies.',
    2: 'This showed in most of your replies.',
    3: 'This showed consistently throughout the dialogue.',
  },
};

export function levelLine(score: number, language: Language): string {
  return (LEVEL_LINE[language] ?? LEVEL_LINE.ru)[scoreLevel(score)];
}

/**
 * Отметка реплики согласована с пошаговым баллом судьи: plus — только при балле 2–3 по этому
 * критерию, minus — при 0–1. Иначе отзыв хвалит то, что судья не засчитал (например, просьбу
 * выдать критерии как «методичность»), или ругает засчитанное.
 */
function highlightAgrees(h: { message_id: string; criterion: RubricCriterion; polarity: 'plus' | 'minus' }, turnScores: TurnScores): boolean {
  const s = turnScores.get(h.message_id);
  if (!s) return false;
  const v = s[h.criterion];
  return h.polarity === 'plus' ? v >= 2 : v <= 1;
}

/**
 * Нормализация вывода модели: только допустимые id реплик студента, отметки, согласованные с
 * пошаговыми баллами, лимиты по числу пунктов.
 */
export function normalizeSummary(
  data: EvaluationSummaryOutput,
  turnScores: TurnScores,
  scores: Record<RubricCriterion, number>,
): StoredSessionSummary {
  const lineFor = (key: RubricCriterion) => {
    const found = data.criteria.find((c) => c.key === key)?.line;
    return found ? cleanLine(found) || null : null;
  };
  return {
    criteria: RUBRIC_CRITERIA.map((key) => ({ key, score: scores[key], line: lineFor(key) })),
    strengths: data.strengths.map(cleanLine).filter(Boolean).slice(0, 2),
    toDevelop: data.to_develop.map(cleanLine).filter(Boolean).slice(0, 2),
    highlights: data.highlights
      .filter((h) => turnScores.has(h.message_id) && highlightAgrees(h, turnScores))
      .slice(0, 6)
      .map((h) => ({ messageId: h.message_id, criterion: h.criterion, polarity: h.polarity, note: cleanLine(h.note) }))
      .filter((h) => h.note),
    droppedLines: 0,
    addressDropped: 0,
    promptVersion: DIALOG_PROMPT_VERSION,
    generatedAt: new Date().toISOString(),
  };
}

/** Строки на неформальном обращении («ты», «сен», «репликаңда») выбрасываются. Возвращает число выброшенных. */
export function dropInformalLines(s: StoredSessionSummary, language: Language): number {
  let n = 0;
  for (const l of summaryLines(s)) {
    if (informalAddress(l.text, language).length) {
      l.drop();
      n++;
    }
  }
  return n;
}

/** Критерий без строки (не пришла или выброшена проверкой) получает нейтральную строку по уровню балла. */
export function fillLevelLines(s: StoredSessionSummary, language: Language): void {
  for (const c of s.criteria) if (!c.line) c.line = levelLine(c.score, language);
}

/** Все текстовые строки отзыва с возможностью выбросить конкретную. */
function summaryLines(s: StoredSessionSummary): SummaryLine[] {
  const lines: SummaryLine[] = [];
  for (const c of s.criteria) if (c.line) lines.push({ text: c.line, drop: () => (c.line = null) });
  s.strengths.forEach((t, i) => lines.push({ text: t, drop: () => (s.strengths[i] = '') }));
  s.toDevelop.forEach((t, i) => lines.push({ text: t, drop: () => (s.toDevelop[i] = '') }));
  s.highlights.forEach((h) => lines.push({ text: h.note, drop: () => (h.note = '') }));
  return lines;
}

function compact(s: StoredSessionSummary): void {
  s.strengths = s.strengths.filter(Boolean);
  s.toDevelop = s.toDevelop.filter(Boolean);
  s.highlights = s.highlights.filter((h) => h.note);
}

/** Баллы критериев — из агрегата рубрики (авторитетный серверный расчёт, §5.5). */
function scoresFrom(evaluationResult: unknown): Record<RubricCriterion, number> {
  const agg = rubricAggregateSchema.safeParse(evaluationResult);
  return {
    methodicalness: agg.success ? agg.data.avg_methodicalness : 0,
    question_quality: agg.success ? agg.data.avg_question_quality : 0,
    logical_progression: agg.success ? agg.data.avg_logical_progression : 0,
    self_correction: agg.success ? agg.data.avg_self_correction : 0,
  };
}

async function withTimeout<T>(p: Promise<T>, ms: number, controller: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('таймаут проверки отзыва'));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface SummaryRunResult {
  status: 'READY' | 'FAILED';
  summary: StoredSessionSummary | null;
  usage: TokenUsage | null;
  droppedLines: number;
  error?: string;
}

/** Реплика студента для отзыва: id, текст и пошаговые баллы судьи (без вывода по тезисам). */
export interface SummaryTurn {
  id: string;
  content: string;
  scores: Record<RubricCriterion, number> | null;
}

export interface SummaryCoreResult {
  summary: StoredSessionSummary;
  usage: TokenUsage | null;
  droppedLines: number;
}

/**
 * Ядро отзыва без БД (его вызывает и харнесс калибровки): вызов модели → нормализация →
 * проверка строк на раскрытие ответа (дословная + семантическая, fail-closed).
 * Бросает при сбое вызова/проверки — вызывающий ставит summaryStatus FAILED.
 */
export async function summarizeTurns(p: {
  language: Language;
  turns: SummaryTurn[];
  scores: Record<RubricCriterion, number>;
  rubricKeyPoints: string[];
  referenceSolution: string;
}): Promise<SummaryCoreResult> {
  const gateway = getGateway();
  let usage: TokenUsage | null = null;
  const track = (r: CompletionResult) => {
    usage = usage ? addUsage(usage, r.usage) : r.usage;
  };
  if (p.turns.length === 0) {
    // Студент не написал ни одной реплики — оценивать нечего, вызова LLM нет.
    return { summary: normalizeSummary({ criteria: [], strengths: [], to_develop: [], highlights: [] }, new Map(), p.scores), usage: null, droppedLines: 0 };
  }
  const { data, result } = await gateway.completeStructured(
    {
      model: env.LLM_MODEL_JUDGE,
      purpose: 'judge',
      reasoningEffort: 'low',
      maxTokens: SUMMARY_MAX_TOKENS,
      system: evaluationSummarySystemPrompt(p.language),
      messages: [
        {
          role: 'user',
          content: evaluationSummaryUserMessage(
            p.turns.map((t) => ({ ...t, content: t.content.slice(0, STUDENT_TURN_MAX_CHARS) })),
            p.scores,
          ),
        },
      ],
    },
    evaluationSummaryOutputSchema,
    'evaluation_summary',
  );
  track(result);
  if (result.finishReason === 'length') throw new Error('отзыв оборван по лимиту токенов');
  const summary = normalizeSummary(data, new Map(p.turns.map((t) => [t.id, t.scores])), p.scores);

  // Форма обращения (A.2): строки на «ты»/«сен» не показываем.
  summary.addressDropped = dropInformalLines(summary, p.language);

  // Проверка на раскрытие ответа (A6): дословный детектор по каждой строке + семантическая.
  for (const l of summaryLines(summary)) {
    if (detectAnswerLeak(l.text, p.referenceSolution).leaked) {
      l.drop();
      summary.droppedLines++;
    }
  }
  const remaining = summaryLines(summary);
  if (remaining.length > 0) {
    const controller = new AbortController();
    const check = await withTimeout(
      gateway.completeStructured(
        {
          model: env.LLM_MODEL_JUDGE,
          purpose: 'judge',
          reasoningEffort: 'low',
          maxTokens: 120,
          cacheSystem: true,
          signal: controller.signal,
          system: summaryLeakCheckSystemPrompt({ rubricKeyPoints: p.rubricKeyPoints, referenceSolution: p.referenceSolution }),
          messages: [{ role: 'user', content: `ОТЗЫВ:\n${remaining.map((l, i) => `${i + 1}. ${l.text}`).join('\n')}` }],
        },
        summaryLeakCheckOutputSchema,
        'summary_leak_check',
      ),
      SUMMARY_LEAK_TIMEOUT_MS,
      controller,
    );
    track(check.result);
    if (check.data.leaks) {
      const idx = check.data.lines.filter((n) => n >= 1 && n <= remaining.length);
      // Модель сказала «утечка», но не назвала строки — выбрасываем весь текст (fail-closed).
      const toDrop = idx.length ? idx : remaining.map((_, i) => i + 1);
      for (const n of toDrop) remaining[n - 1]!.drop();
      summary.droppedLines += toDrop.length;
    }
  }
  compact(summary);
  // Строка критерия не пришла или выброшена — нейтральная строка по уровню балла, а не пусто.
  fillLevelLines(summary, p.language);
  return { summary, usage, droppedLines: summary.droppedLines };
}

/**
 * Генерирует и сохраняет итоговую оценку сессии. Никогда не бросает (фоновая задача).
 * Возвращает результат для харнесса калибровки.
 */
export async function generateEvaluationSummary(sessionId: string): Promise<SummaryRunResult> {
  try {
    const session = await prisma.practicalSession.findUnique({
      where: { id: sessionId },
      include: {
        practicalTask: { include: { module: { include: { languageVersion: { select: { language: true } } } } } },
        messages: { where: { role: 'STUDENT' }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!session) return { status: 'FAILED', summary: null, usage: null, droppedLines: 0, error: 'session not found' };
    const snapshot = session.taskSnapshot as { rubricSpec?: unknown } | null;
    const rubric = (snapshot?.rubricSpec ?? session.practicalTask.rubricSpec) as { key_points?: string[] };
    const turns: SummaryTurn[] = session.messages.map((m) => {
      const a = reasoningAssessmentSchema.safeParse(m.turnAssessment);
      return {
        id: m.id,
        content: m.content,
        scores: a.success
          ? {
              methodicalness: a.data.methodicalness,
              question_quality: a.data.question_quality,
              logical_progression: a.data.logical_progression,
              self_correction: a.data.self_correction,
            }
          : null,
      };
    });
    let core: SummaryCoreResult;
    try {
      core = await summarizeTurns({
        language: session.practicalTask.module.languageVersion.language as Language,
        turns,
        scores: scoresFrom(session.evaluationResult),
        rubricKeyPoints: rubric.key_points ?? [],
        referenceSolution: session.practicalTask.referenceSolution,
      });
    } catch (err) {
      logger.warn({ err, sessionId }, 'Итоговая оценка сессии не сформирована — студент увидит только баллы');
      await persist(sessionId, 'FAILED', null, null);
      return { status: 'FAILED', summary: null, usage: null, droppedLines: 0, error: (err as Error)?.message };
    }
    await persist(sessionId, 'READY', core.summary, core.usage);
    return { status: 'READY', summary: core.summary, usage: core.usage, droppedLines: core.droppedLines };
  } catch (err) {
    logger.error({ err, sessionId }, 'Итоговая оценка: сбой сохранения');
    return { status: 'FAILED', summary: null, usage: null, droppedLines: 0, error: (err as Error)?.message };
  }
}

/** Сохраняет отзыв и учитывает токены вызовов в metrics (вспомогательные, не в потолок, A3). */
async function persist(sessionId: string, status: 'READY' | 'FAILED', summary: StoredSessionSummary | null, usage: TokenUsage | null) {
  const current = await prisma.practicalSession.findUnique({ where: { id: sessionId }, select: { metrics: true } });
  const metrics = { ...((current?.metrics as Record<string, unknown> | null) ?? {}) };
  if (usage) {
    const u = usage as TokenUsage;
    const aux = (metrics.auxTokens as { input: number; cachedInput: number; output: number; reasoning: number } | undefined) ?? {
      input: 0,
      cachedInput: 0,
      output: 0,
      reasoning: 0,
    };
    metrics.auxTokens = {
      input: aux.input + u.inputTokens,
      cachedInput: aux.cachedInput + (u.cachedInputTokens ?? 0),
      output: aux.output + u.outputTokens,
      reasoning: aux.reasoning + (u.reasoningTokens ?? 0),
    };
    metrics.summaryTokens = { input: u.inputTokens, cachedInput: u.cachedInputTokens ?? 0, output: u.outputTokens, reasoning: u.reasoningTokens ?? 0 };
    const add = costUsd(
      { input: u.inputTokens, cachedInput: u.cachedInputTokens ?? 0, output: u.outputTokens },
      { input: env.LLM_PRICE_INPUT_PER_MTOK, cachedInput: env.LLM_PRICE_CACHED_INPUT_PER_MTOK, output: env.LLM_PRICE_OUTPUT_PER_MTOK },
    );
    metrics.costUsd = +(((metrics.costUsd as number | undefined) ?? 0) + add).toFixed(6);
  }
  await prisma.practicalSession.update({
    where: { id: sessionId },
    data: {
      summaryStatus: status,
      summary: summary ? (summary as unknown as object) : undefined,
      metrics: metrics as object,
    },
  });
}
