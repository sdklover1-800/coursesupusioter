import type { ZodTypeAny, output } from 'zod';
import type { Difficulty, Language } from '@edu/shared';
import { getGateway } from '../llm/gateway.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import type { CompletionResult } from '../llm/types.js';

/**
 * Общая «сантехника» черновиков генерации (generation/drafts.ts, generation/translate.ts):
 * вызов LLM со структурированным выводом и учётом расхода, разбор расшифровок
 * на разделы по таймкодам, языковые эвристики. Публичный API — в drafts.ts.
 */

/** Метки вариантов для TRUE_FALSE — фиксированы платформой, индекс 0 = «верно». */
export const TRUE_FALSE_LABELS: Record<Language, string[]> = {
  ru: ['Верно', 'Неверно'],
  kk: ['Дұрыс', 'Қате'],
  en: ['True', 'False'],
};

/**
 * Черновик вопроса (контракт с CONTENT): функции draft* возвращают такие объекты
 * БЕЗ записи в БД, функции write* пишут их БЕЗ вызова LLM. Индексы вариантов —
 * канонические id (порядок options уже перемешан, ключ пересчитан).
 */
export interface DraftQuestion {
  type: 'SINGLE_CHOICE' | 'TRUE_FALSE';
  prompt: string;
  options: string[];
  correctOptionIds: number[];
  explanation: string | null;
  optionRationales: string[] | null;
  sourceLectureId: string | null;
  sourceTimecode: string | null;
  difficulty: Difficulty;
  canonicalKey?: string;
}

/** Отчёт цикла качества: что чинили и о чём предупредить рецензента. */
export interface DraftReport {
  llmCalls: number;
  /** Вопросов, у которых была подсказка длиной и её пытались устранить. */
  lengthCueRepaired: number;
  /** Вопросов, отброшенных из-за пересечения с doNotReuse / между собой. */
  overlapsDropped: number;
  /** Вопросов, отброшенных как невалидные (не тот тип, не 4 варианта, не один ключ…). */
  invalidDropped: number;
  warnings: string[];
}

export const emptyReport = (): DraftReport => ({
  llmCalls: 0,
  lengthCueRepaired: 0,
  overlapsDropped: 0,
  invalidDropped: 0,
  warnings: [],
});

/* ── Учёт расхода LLM (для отчётов CONTENT и живых проверок) ─────── */

export interface DraftUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Оценка по ценам env LLM_PRICE_* (кешированные входные — по своей цене, если известны). */
  costUsd: number;
}

const usage: DraftUsage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };

/** Накопленный расход вызовов черновиков с момента старта процесса / последнего сброса. */
export function getDraftUsage(): DraftUsage {
  return { ...usage };
}

export function resetDraftUsage(): void {
  usage.calls = 0;
  usage.inputTokens = 0;
  usage.outputTokens = 0;
  usage.costUsd = 0;
}

function track(result: CompletionResult): void {
  const u = result.usage;
  const cached = Math.min(u.cachedInputTokens ?? 0, u.inputTokens);
  usage.calls++;
  usage.inputTokens += u.inputTokens;
  usage.outputTokens += u.outputTokens;
  usage.costUsd +=
    ((u.inputTokens - cached) * env.LLM_PRICE_INPUT_PER_MTOK +
      cached * env.LLM_PRICE_CACHED_INPUT_PER_MTOK +
      u.outputTokens * env.LLM_PRICE_OUTPUT_PER_MTOK) /
    1_000_000;
}

export type DraftEffort = 'none' | 'low' | 'medium' | 'high';

/**
 * Один структурированный вызов генерации: JSON → Zod (ремонт — в шлюзе, §5.2).
 * purpose = generation; уровень рассуждений — из options (напр. medium для
 * казахских расшифровок, llm_calibration_plan §B), иначе — env по назначению.
 */
export async function callStructured<S extends ZodTypeAny>(
  label: string,
  req: {
    system: string;
    user: string;
    maxTokens: number;
    effort?: DraftEffort;
    model?: string;
    /**
     * Офлайн-заглушка ответа для LLM_PROVIDER=mock (generation/mockDrafts.ts): статичный
     * мок-адаптер не даёт N различных вопросов, и цикл качества на нём не сходится.
     * Ответ всё равно проходит schema — контракт тот же, что у реальной модели.
     */
    mock?: () => unknown;
  },
  schema: S,
  report?: DraftReport,
): Promise<output<S>> {
  const gateway = getGateway();
  if (req.mock && gateway.provider === 'mock') {
    const data = schema.parse(req.mock()) as output<S>;
    usage.calls++;
    if (report) report.llmCalls++;
    return data;
  }
  const { data, result } = await gateway.completeStructured(
    {
      model: req.model ?? env.LLM_MODEL_GENERATION,
      system: req.system,
      cacheSystem: true,
      purpose: 'generation',
      maxTokens: req.maxTokens,
      ...(req.effort ? { reasoningEffort: req.effort } : {}),
      messages: [{ role: 'user', content: req.user }],
    },
    schema,
    label,
  );
  track(result);
  if (report) report.llmCalls++;
  if (result.finishReason === 'length') {
    // JSON распарсился, но ответ упёрся в лимит — часть элементов могла потеряться.
    logger.warn({ label, maxTokens: req.maxTokens }, 'Ответ генерации упёрся в max_tokens');
    report?.warnings.push(`${label}: ответ упёрся в лимит токенов — проверьте полноту`);
  }
  return data;
}

/* ── Текст ───────────────────────────────────────────────────────── */

/** Чистит текст модели: markdown-выделения, лишние пробелы. */
export function cleanText(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

/**
 * Снимает буквенную/цифровую разметку вариантов («A) …», «Б. …», «1) …»), но только
 * если она есть у ВСЕХ вариантов подряд — иначе «A. Gramsci» потерял бы инициал.
 */
export function stripOptionLabels(options: string[]): string[] {
  const re = /^\s*([A-Fa-fА-Еа-е1-6])[).:]\s+/;
  const labels = options.map((o) => re.exec(o)?.[1]?.toLowerCase());
  if (labels.some((l) => l === undefined)) return options;
  const seqs = ['abcdef', 'абвгде', '123456'];
  const sequential = seqs.some((seq) => labels.every((l, i) => l === seq[i]));
  return sequential ? options.map((o) => o.replace(re, '')) : options;
}

/* ── Расшифровки: разделы по таймкодам ───────────────────────────── */

// «[mm:ss–mm:ss] Заголовок» (терпимо к пробелам и дефисам: «[00:00 –01 : 30 ]»).
const HEADER_RE = /^(\s*\[\s*(\d{1,3}\s*:\s*\d{2})\s*[–—-]\s*(\d{1,3}\s*:\s*\d{2})\s*\]\s*)(.*)$/;

const toSeconds = (tc: string): number => {
  const [m, s] = tc.replace(/\s+/g, '').split(':');
  return Number(m) * 60 + Number(s);
};

const fmt = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

export interface TranscriptSection {
  /** Сырой префикс строки заголовка («[05:00–09:00] ») — байт-в-байт. */
  headerPrefix: string;
  /** Заголовок раздела после таймкода (может быть пустым). */
  title: string;
  /** Начало/конец раздела, сек. */
  start: number;
  end: number;
  /** Текст раздела без строки заголовка. */
  body: string;
}

export interface ParsedTranscript {
  /** Текст до первого таймкода (название лекции и т. п.). */
  preamble: string;
  sections: TranscriptSection[];
}

export function parseTranscript(text: string): ParsedTranscript {
  const lines = text.split('\n');
  const preamble: string[] = [];
  const sections: TranscriptSection[] = [];
  let body: string[] | null = null;
  for (const line of lines) {
    const m = HEADER_RE.exec(line);
    if (m) {
      if (body && sections.length) sections[sections.length - 1]!.body = body.join('\n');
      sections.push({ headerPrefix: m[1]!, title: m[4] ?? '', start: toSeconds(m[2]!), end: toSeconds(m[3]!), body: '' });
      body = [];
    } else if (body) {
      body.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (body && sections.length) sections[sections.length - 1]!.body = body.join('\n');
  return { preamble: preamble.join('\n'), sections };
}

/** Индекс раздела, в который попадает таймкод (или ближайший предыдущий); -1 — нет разделов. */
export function sectionIndexAt(transcript: string | ParsedTranscript, timecode: string): number {
  const parsed = typeof transcript === 'string' ? parseTranscript(transcript) : transcript;
  if (!parsed.sections.length) return -1;
  const sec = toSeconds(timecode);
  let idx = 0;
  parsed.sections.forEach((s, i) => {
    if (s.start <= sec) idx = i;
  });
  return idx;
}

/**
 * Привязывает таймкод к НАЧАЛУ раздела расшифровки, в который он попадает
 * (source_timecode — «начало раздела-опоры», gen-2.0). Без разделов — как есть.
 */
export function snapTimecode(transcript: string, timecode: string | null | undefined): string | null {
  if (!timecode) return null;
  const parsed = parseTranscript(transcript);
  const i = sectionIndexAt(parsed, timecode);
  return i === -1 ? timecode : fmt(parsed.sections[i]!.start);
}

/**
 * Таймкод источника в параллельной лекции другого языка: тот же по номеру раздел
 * (видео разных языков могут расходиться по времени, напр. kk-15).
 */
export function mapTimecodeBetween(srcTranscript: string, tgtTranscript: string, timecode: string | null): string | null {
  if (!timecode) return null;
  const i = sectionIndexAt(srcTranscript, timecode);
  if (i === -1) return timecode;
  const tgt = parseTranscript(tgtTranscript);
  const s = tgt.sections[i];
  return s ? fmt(s.start) : timecode;
}

/** Конец последнего таймкода расшифровки, сек (оценка длительности видео). */
export function transcriptEndSeconds(text: string): number | null {
  const { sections } = parseTranscript(text);
  return sections.length ? Math.max(...sections.map((s) => s.end)) : null;
}

/* ── Языковые эвристики переводов ────────────────────────────────── */

// Частотные служебные слова, которых нет в казахском (признак непереведённого русского).
const RU_FUNCTION_WORDS = new Set([
  'и', 'в', 'на', 'что', 'это', 'как', 'который', 'которая', 'которые', 'также', 'является', 'для', 'не',
  'по', 'из', 'от', 'или', 'но', 'если', 'чтобы', 'при', 'так', 'его', 'их', 'она', 'они', 'был', 'была',
  'были', 'быть', 'только', 'уже', 'где', 'когда', 'между', 'через',
]);
const KK_LETTERS = /[әғқңөұүһіӘҒҚҢӨҰҮҺІ]/;

/** Простые предупреждения о языке текста (не блокируют запись; рецензент проверит). */
export function languageWarnings(text: string, language: Language, where = ''): string[] {
  const out: string[] = [];
  const at = where ? `${where}: ` : '';
  if (!text.trim()) return out;
  if (language === 'en' && /[А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]/.test(text)) {
    out.push(`${at}кириллица в английском тексте`);
  }
  if (language === 'kk') {
    const words = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
    const hits = [...new Set(words.filter((w) => RU_FUNCTION_WORDS.has(w)))];
    if (hits.length >= 2) out.push(`${at}русские служебные слова в казахском тексте: ${hits.slice(0, 6).join(', ')}`);
    if (text.length > 60 && !KK_LETTERS.test(text) && /[А-Яа-я]/.test(text)) out.push(`${at}нет казахских букв — похоже на русский`);
  }
  if (language === 'ru' && /[әғқңөұүһӘҒҚҢӨҰҮҺ]/.test(text)) out.push(`${at}казахские буквы в русском тексте`);
  return out;
}
