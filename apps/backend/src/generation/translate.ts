import type { Language } from '@edu/shared';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { Errors } from '../lib/errors.js';
import {
  questionTranslationSchema,
  transcriptSectionSchema,
  practicalTranslationSchema,
  practicalRubricSchema,
  type PracticalTranslation,
} from '../llm/schemas/generation.js';
import {
  questionTranslateSystemPrompt,
  questionTranslateUserPrompt,
  transcriptSectionSystemPrompt,
  transcriptSectionUserPrompt,
  practicalTranslateSystemPrompt,
  practicalTranslateUserPrompt,
} from '../llm/prompts/generation.js';
import {
  TRUE_FALSE_LABELS,
  callStructured,
  cleanText,
  emptyReport,
  languageWarnings,
  mapTimecodeBetween,
  parseTranscript,
  type DraftEffort,
  type DraftQuestion,
  type DraftReport,
} from './common.js';
import { lengthCue } from './quality.js';
import { localizedTitle } from './titles.js';
import {
  mockPracticalTranslationPayload,
  mockQuestionTranslationPayload,
  mockTranscriptSectionPayload,
} from './mockDrafts.js';

/**
 * Переводы канонического контента (USER_DECISIONS §4, §5): вопросы (ru → kk/en с тем же
 * порядком вариантов и ключом), расшифровки (перевод или корректура по разделам с
 * байт-в-байт таймкодами), практическое задание (ключевые тезисы 1:1). В БД НЕ пишут.
 */

type Glossary = Record<string, string> | string;

/** Размер пачки вопросов на один вызов (тест модуля — 8 вопросов — один вызов). */
const QUESTION_BATCH = 10;

/* ── Вопросы ─────────────────────────────────────────────────────── */

export interface TranslateQuestionsOptions {
  /** Языковая версия перевода — для сопоставления лекций-источников. */
  targetVersionId: string;
  glossary?: Glossary;
  /** Язык оригинала; по умолчанию — язык лекции-источника, иначе ru. */
  sourceLanguage?: Language;
  onReport?: (r: DraftReport) => void;
}

/**
 * Перевод канонических вопросов. СОХРАНЯЕТ порядок вариантов, ключ, тип, сложность
 * и canonicalKey; лекция-источник сопоставляется по (module.orderIndex, lecture.orderIndex),
 * таймкод — по номеру раздела расшифровки. Один вызов на пачку (модуль).
 */
export async function translateQuestions(
  items: DraftQuestion[],
  targetLanguage: Language,
  opts: TranslateQuestionsOptions,
): Promise<DraftQuestion[]> {
  if (!items.length) return [];
  const report = emptyReport();

  // Лекции оригинала и перевода: (модуль, лекция) → id и расшифровка.
  const srcIds = [...new Set(items.map((i) => i.sourceLectureId).filter((x): x is string => !!x))];
  const srcLectures = await prisma.lecture.findMany({
    where: { id: { in: srcIds } },
    select: {
      id: true,
      orderIndex: true,
      transcriptText: true,
      module: { select: { orderIndex: true, languageVersion: { select: { language: true } } } },
    },
  });
  const tgtLectures = await prisma.lecture.findMany({
    where: { module: { courseLanguageVersionId: opts.targetVersionId } },
    select: { id: true, orderIndex: true, transcriptText: true, module: { select: { orderIndex: true } } },
  });
  const tgtVersion = await prisma.courseLanguageVersion.findUnique({ where: { id: opts.targetVersionId }, select: { language: true } });
  if (!tgtVersion) throw Errors.notFound('Языковая версия перевода не найдена');
  if (tgtVersion.language !== targetLanguage) {
    throw Errors.badRequest(`Язык версии ${tgtVersion.language} ≠ целевому ${targetLanguage}`);
  }
  const sourceLanguage = (opts.sourceLanguage ?? srcLectures[0]?.module.languageVersion.language ?? 'ru') as Language;
  if (sourceLanguage === targetLanguage) throw Errors.badRequest('Язык оригинала совпадает с целевым');

  const mapSource = (d: DraftQuestion): { lectureId: string | null; timecode: string | null } => {
    if (!d.sourceLectureId) return { lectureId: null, timecode: null };
    const src = srcLectures.find((l) => l.id === d.sourceLectureId);
    const tgt = src && tgtLectures.find((l) => l.module.orderIndex === src.module.orderIndex && l.orderIndex === src.orderIndex);
    if (!src || !tgt) {
      report.warnings.push(`нет парной лекции для источника ${d.sourceLectureId}: ${d.prompt.slice(0, 60)}`);
      return { lectureId: null, timecode: null };
    }
    return { lectureId: tgt.id, timecode: mapTimecodeBetween(src.transcriptText, tgt.transcriptText, d.sourceTimecode) };
  };

  const out: DraftQuestion[] = new Array(items.length);
  for (let start = 0; start < items.length; start += QUESTION_BATCH) {
    let pending = items.slice(start, start + QUESTION_BATCH).map((d, k) => ({ d, key: start + k }));
    for (let attempt = 0; attempt < 2 && pending.length; attempt++) {
      const batch = pending.map(({ d, key }) => ({
        key,
        type: d.type,
        prompt: d.prompt,
        ...(d.type === 'SINGLE_CHOICE' ? { options: d.options } : {}),
        ...(d.optionRationales ? { option_rationales: d.optionRationales } : {}),
        ...(d.explanation ? { explanation: d.explanation } : {}),
      }));
      const data = await callStructured(
        'question_translate',
        {
          system: questionTranslateSystemPrompt(sourceLanguage, targetLanguage, opts.glossary),
          user: questionTranslateUserPrompt(batch),
          maxTokens: Math.min(16000, 1500 + pending.length * 1000),
          mock: () => mockQuestionTranslationPayload(targetLanguage, batch),
        },
        questionTranslationSchema,
        report,
      );
      const byKey = new Map(data.items.map((i) => [i.key, i]));
      const retry: typeof pending = [];
      for (const p of pending) {
        const tr = byKey.get(p.key);
        const d = p.d;
        const optionsOk = d.type === 'TRUE_FALSE' || tr?.options?.length === d.options.length;
        const rationalesOk = !d.optionRationales || tr?.option_rationales?.length === d.optionRationales.length;
        const explanationOk = !d.explanation || !!tr?.explanation?.trim();
        if (!tr || !tr.prompt.trim() || !optionsOk || !rationalesOk || !explanationOk) {
          retry.push(p);
          continue;
        }
        const { lectureId, timecode } = mapSource(d);
        const translated: DraftQuestion = {
          type: d.type,
          prompt: cleanText(tr.prompt),
          options: d.type === 'TRUE_FALSE' ? [...TRUE_FALSE_LABELS[targetLanguage]] : tr.options!.map(cleanText),
          correctOptionIds: [...d.correctOptionIds],
          explanation: d.explanation ? cleanText(tr.explanation!) : null,
          optionRationales: d.optionRationales ? tr.option_rationales!.map(cleanText) : null,
          sourceLectureId: lectureId,
          sourceTimecode: timecode,
          difficulty: d.difficulty,
          ...(d.canonicalKey ? { canonicalKey: d.canonicalKey } : {}),
        };
        const where = d.canonicalKey ?? `вопрос ${p.key + 1}`;
        report.warnings.push(
          ...languageWarnings([translated.prompt, ...translated.options, translated.explanation ?? '', ...(translated.optionRationales ?? [])].join(' '), targetLanguage, where),
        );
        if (translated.type === 'SINGLE_CHOICE' && lengthCue(translated.options, translated.correctOptionIds) && !lengthCue(d.options, d.correctOptionIds)) {
          report.warnings.push(`${where}: после перевода ключ заметно длиннее дистракторов`);
        }
        out[p.key] = translated;
      }
      pending = retry;
    }
    if (pending.length) {
      throw Errors.upstream(
        `Перевод не сохранил структуру вопросов (${pending.map((p) => p.d.canonicalKey ?? p.key + 1).join(', ')}) — повторите`,
      );
    }
  }
  if (report.warnings.length) logger.warn({ warnings: report.warnings.slice(0, 20) }, 'Перевод вопросов: предупреждения');
  opts.onReport?.(report);
  return out;
}

/* ── Расшифровки ─────────────────────────────────────────────────── */

export interface TranslateTranscriptOptions {
  /** translate — полный перевод; correct — корректура существующего текста (напр. kk-01) по reference. */
  mode: 'translate' | 'correct';
  glossary?: Glossary;
  /** Уровень рассуждений: CONTENT использует medium для казахского (llm_calibration_plan §B). */
  effort?: 'low' | 'medium';
  model?: string;
  /** Параллельный текст (напр. ru-раздел) — для смысла; разбивается на разделы так же. */
  reference?: string;
  /** Язык оригинала (для режима translate) — только для промпта. */
  sourceLanguage?: Language;
}

export interface TranslateTranscriptResult {
  text: string;
  /** Пометки по разделам: изменения (correct), термины и предупреждения проверки. */
  notes: string[];
}

/**
 * Перевод или корректура расшифровки ПО РАЗДЕЛАМ. Таймкод-префикс каждого заголовка
 * «[mm:ss–mm:ss] » переносится байт-в-байт (модель его не видит); переводится/правится
 * только заголовок раздела и текст. Преамбула (до первого таймкода) — отдельным разделом.
 */
export async function translateTranscript(
  text: string,
  targetLanguage: Language,
  opts: TranslateTranscriptOptions,
): Promise<TranslateTranscriptResult> {
  const parsed = parseTranscript(text);
  const ref = opts.reference ? parseTranscript(opts.reference) : null;
  const notes: string[] = [];
  const report = emptyReport();
  const effort: DraftEffort = opts.effort ?? 'low';

  // Разделы исходника: преамбула (без таймкода) + разделы с таймкодом.
  const units: { prefix: string | null; title: string; body: string; refText?: string; label: string }[] = [];
  if (parsed.preamble.trim()) {
    units.push({ prefix: null, title: '', body: parsed.preamble, refText: ref?.preamble.trim() ? ref.preamble : undefined, label: 'преамбула' });
  }
  parsed.sections.forEach((s, i) => {
    let refText: string | undefined;
    if (ref) {
      if (!parsed.sections.length || parsed.sections.length === 1) refText = opts.reference;
      else {
        const r = ref.sections.length === parsed.sections.length ? ref.sections[i] : ref.sections.find((x) => x.start === s.start);
        refText = r ? `${r.title}\n${r.body}` : undefined;
        if (!r) notes.push(`${s.headerPrefix.trim()}: нет парного раздела в reference`);
      }
    }
    units.push({ prefix: s.headerPrefix, title: s.title, body: s.body, refText, label: s.headerPrefix.trim() });
  });
  // Текст без таймкодов вовсе — одним разделом.
  if (!units.length && text.trim()) units.push({ prefix: null, title: '', body: text, refText: opts.reference, label: 'текст' });

  const outParts: string[] = [];
  for (const u of units) {
    if (!u.body.trim() && !u.title.trim()) {
      outParts.push(u.prefix !== null ? `${u.prefix}${u.title}`.trimEnd() : u.body);
      continue;
    }
    const data = await callStructured(
      opts.mode === 'translate' ? 'transcript_translate' : 'transcript_correct',
      {
        system: transcriptSectionSystemPrompt({
          mode: opts.mode,
          target: targetLanguage,
          source: opts.sourceLanguage,
          glossary: opts.glossary,
        }),
        user: transcriptSectionUserPrompt({ title: u.title, text: u.body.trim(), reference: u.refText }),
        maxTokens: Math.min(24000, Math.ceil(u.body.length / 1.5) + 1500),
        effort,
        ...(opts.model ? { model: opts.model } : {}),
        mock: () => mockTranscriptSectionPayload(opts.mode, targetLanguage, { title: u.title, text: u.body.trim() }),
      },
      transcriptSectionSchema,
      report,
    );
    const body = data.text.replace(/\r\n/g, '\n').trim();
    const title = u.prefix !== null && u.title.trim() ? cleanText(data.title ?? u.title) : '';
    if (u.prefix !== null) outParts.push(`${u.prefix}${title}`.trimEnd(), body);
    else outParts.push(body);

    for (const n of data.notes ?? []) if (n.trim()) notes.push(`${u.label}: ${n.trim()}`);
    for (const w of languageWarnings(`${title} ${body}`, targetLanguage, u.label)) notes.push(`ПРОВЕРКА ${w}`);
    if (opts.mode === 'translate' && body.length < u.body.trim().length * 0.5) {
      notes.push(`ПРОВЕРКА ${u.label}: перевод заметно короче оригинала (${body.length} / ${u.body.trim().length})`);
    }
    if (/\[\s*\d{1,3}\s*:\s*\d{2}\s*[–—-]/.test(body)) notes.push(`ПРОВЕРКА ${u.label}: модель вставила таймкод в текст`);
  }
  return { text: outParts.join('\n'), notes };
}

/* ── Практическое задание ────────────────────────────────────────── */

export interface TranslatedPracticalTask {
  title: string;
  scenarioPrompt: string;
  referenceSolution: string;
  /** { key_points[] (1:1 с оригиналом), answer_reached_criteria, …прочие поля оригинала } */
  rubricSpec: Record<string, unknown>;
  agenda: string[] | null;
  introMessage: string | null;
  /** Эвристические предупреждения (обращение «сен», «ауызша», язык). */
  warnings: string[];
}

/**
 * Перевод канонического практического задания (USER_DECISIONS §4: один сценарий
 * «Полисия» на все языки). Ключевые тезисы — 1:1 (то же число и порядок),
 * answer_reached_criteria — точно; kk — на «Сіз», без «ауызша». В БД НЕ пишет.
 */
export async function translatePracticalTask(
  sourceTaskId: string,
  targetLanguage: Language,
  opts: { glossary?: Glossary; onReport?: (r: DraftReport) => void } = {},
): Promise<TranslatedPracticalTask> {
  const task = await prisma.practicalTask.findUnique({
    where: { id: sourceTaskId },
    include: { module: { select: { title: true, coversWholeCourse: true, languageVersion: { select: { language: true } } } } },
  });
  if (!task) throw Errors.notFound('Практическое задание не найдено');
  const sourceLanguage = task.module.languageVersion.language as Language;
  if (sourceLanguage === targetLanguage) throw Errors.badRequest('Язык оригинала совпадает с целевым');
  const rubricRaw = (task.rubricSpec ?? {}) as Record<string, unknown>;
  const rubric = practicalRubricSchema.parse(rubricRaw);
  const agenda = Array.isArray(task.agenda) ? (task.agenda as unknown[]).filter((x): x is string => typeof x === 'string') : null;
  const report = emptyReport();

  const source = {
    scenario_prompt: task.scenarioPrompt,
    reference_solution: task.referenceSolution,
    key_points: rubric.key_points,
    answer_reached_criteria: rubric.answer_reached_criteria,
    ...(agenda?.length ? { agenda } : {}),
    ...(task.introMessage ? { intro_message: task.introMessage } : {}),
  };
  let result: PracticalTranslation | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const data = await callStructured(
      'practical_translate',
      {
        system: practicalTranslateSystemPrompt(sourceLanguage, targetLanguage, opts.glossary),
        user: practicalTranslateUserPrompt(source),
        maxTokens: 8000,
        mock: () => mockPracticalTranslationPayload(targetLanguage, source),
      },
      practicalTranslationSchema,
      report,
    );
    const agendaOk = !agenda?.length || data.agenda?.length === agenda.length;
    const introOk = !task.introMessage || !!data.intro_message?.trim();
    if (data.key_points.length === rubric.key_points.length && agendaOk && introOk) {
      result = data;
      break;
    }
    report.warnings.push(
      `попытка ${attempt + 1}: тезисов ${data.key_points.length} из ${rubric.key_points.length}` +
        (agendaOk ? '' : ', план беседы не совпал') +
        (introOk ? '' : ', нет первой реплики'),
    );
  }
  if (!result) throw Errors.upstream('Перевод практического задания не сохранил тезисы рубрики 1:1 — повторите');

  const warnings: string[] = [];
  const all = [result.scenario_prompt, result.reference_solution, ...result.key_points, result.answer_reached_criteria, ...(result.agenda ?? []), result.intro_message ?? ''].join('\n');
  warnings.push(...languageWarnings(all, targetLanguage, 'практическое'));
  if (targetLanguage === 'kk') {
    const informal = all.match(/(^|[^\p{L}])(сен|сенің|саған|сені|сенде)(?=[^\p{L}]|$)/giu);
    if (informal) warnings.push(`обращение на «сен»: ${[...new Set(informal.map((x) => x.trim()))].join(', ')}`);
    if (/ауызша/i.test(all)) warnings.push('слово «ауызша» (задание письменное)');
  }
  if (warnings.length) logger.warn({ sourceTaskId, targetLanguage, warnings }, 'Перевод практического: предупреждения');
  opts.onReport?.(report);

  const { key_points: _kp, answer_reached_criteria: _arc, ...otherRubric } = rubricRaw;
  return {
    // Итоговое (весь курс) — только метка; обычный модуль — метка без названия модуля
    // (название модуля перевода здесь неизвестно — его подставит вызывающий код).
    title: localizedTitle('PRACTICAL', targetLanguage),
    scenarioPrompt: result.scenario_prompt.trim(),
    referenceSolution: result.reference_solution.trim(),
    rubricSpec: {
      ...otherRubric,
      key_points: result.key_points.map((k) => k.trim()),
      answer_reached_criteria: result.answer_reached_criteria.trim(),
    },
    agenda: agenda?.length ? (result.agenda ?? []).map(cleanText) : null,
    introMessage: task.introMessage ? (result.intro_message ?? '').trim() : null,
    warnings: [...report.warnings, ...warnings],
  };
}
