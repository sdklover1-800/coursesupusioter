import type { Difficulty, Language } from '@edu/shared';

/**
 * Промпт-шаблоны ГЕНЕРАЦИИ контента: тест модуля (§5.2) и практическое задание (§5.3),
 * а с gen-2.0 — вспомогательные вызовы цикла качества и переводов (generation/drafts.ts).
 * Версионируются в БД (PromptTemplate) для воспроизводимости (FR-R.7).
 * Идентификатор версии проставляется при сохранении в задаче генерации.
 * Промпты диалога — в ./dialog.ts.
 *
 * gen-2.0 (USER_DECISIONS §5, аудит): один защитимый ключ, дистракторы ±30% длины ключа
 * и той же формы, без «согласно лекции» и «что НЕ упоминается», ≥30% заданий на
 * применение/анализ, баланс TRUE_FALSE, обоснования вариантов и источник вопроса.
 */

/** Версия промптов генерации (FR-R.7, A26). */
export const GENERATION_PROMPT_VERSION = 'gen-2.0';

// Копия таблиц из ./dialog.ts: генерация и диалог версионируются и правятся независимо.
const LANG_NAME: Record<Language, string> = { kk: 'казахском (kk)', ru: 'русском (ru)', en: 'английском (en)' };

const DIFFICULTY_GUIDE: Record<Difficulty, string> = {
  VERY_EASY: 'очень простой уровень: максимум строительных лесов, короткие подсказки-вопросы, дробление на мелкие шаги',
  EASY: 'лёгкий уровень: заметная поддержка, наводящие вопросы к очевидным следующим шагам',
  MEDIUM: 'средний уровень: умеренная поддержка, вопросы на связывание идей и проверку гипотез',
  HARD: 'сложный уровень: минимум лесов, абстрактные вопросы, ожидание самостоятельного структурирования',
};

/** Требования к тексту на целевом языке (gen-2.0). */
const LANG_RULES: Record<Language, string> = {
  ru: 'Язык: русский, нейтральный академический стиль, без канцелярита.',
  kk:
    'Язык: казахский, официально-деловой регистр (обращение только на «Сіз»); после числительных существительное ' +
    'в единственном числе («15 дәріс», «8 сұрақ»); без русских калек, русских слов и русских окончаний; ' +
    'термины — в принятой казахской форме.',
  en: 'Language: English, neutral academic register, plain wording.',
};

/**
 * Материалы с метками «#N» — номер лекции для source_lecture_index (gen-2.0).
 * Номер = index лекции, если задан, иначе позиция в списке.
 */
export function genLabelledTranscripts(lectures: { title: string; transcript: string; index?: number }[]): string {
  return lectures.map((l, i) => `=== #${l.index ?? i} · ${l.title} ===\n${l.transcript}`).join('\n\n');
}

const glossaryLine = (glossary?: Record<string, string> | string) => {
  if (!glossary) return [];
  const text =
    typeof glossary === 'string'
      ? glossary
      : Object.entries(glossary)
          .map(([k, v]) => `${k} → ${v}`)
          .join('; ');
  return text.trim() ? [`Глоссарий (используй эти соответствия терминов): ${text}`] : [];
};

/* ── Генерация теста (§5.2) ─────────────────────────────────────── */
export function quizGenSystemPrompt(language: Language): string {
  return [
    `Ты — методист-тестолог, составляющий тестовые вопросы на ${LANG_NAME[language]}.`,
    'Опирайся СТРОГО на предоставленные расшифровки лекций. Не выдумывай факты вне материала.',
    'Правила качества (для КАЖДОГО вопроса):',
    '- ровно ОДИН однозначно защитимый верный вариант; каждый дистрактор однозначно неверен по материалу, а не «частично верен»;',
    '- дистракторы правдоподобны: типичные ошибки понимания, смешение близких понятий, подмена автора или причины; без абсурдных и шуточных вариантов;',
    '- все варианты одной грамматической формы и стиля; длина каждого дистрактора — в пределах ±30% от длины верного варианта; верный вариант не выделяется ни длиной, ни подробностью, ни осторожными оговорками;',
    '- верный вариант — самый длинный не чаще, чем в каждом четвёртом вопросе; в остальных хотя бы один дистрактор длиннее верного;',
    '- без вариантов «всё перечисленное», «ничего из перечисленного» и комбинаций вариантов;',
    '- без вопросов «что НЕ упоминается» и без отсылок «согласно лекции», «в лекции говорится», «в лекции N»: проверяй понимание, а не память на текст;',
    '- не менее 30% вопросов — на применение или анализ: короткая ситуация, пример или сравнение, к которому нужно применить понятие курса;',
    '- TRUE_FALSE: однозначное утверждение без подсказок вроде «всегда/никогда»; при нескольких утверждениях — примерно поровну верных и неверных (если в задании указано число верных — строго его);',
    '- простой текст без markdown, без букв и номеров вариантов («A)», «1.») внутри текста;',
    '- explanation — 1–2 предложения: почему верный ответ верен;',
    '- варианты будут перемешаны: в explanation и option_rationales НЕ ссылайся на номер, букву или порядок варианта («первый вариант», «вариант B») — называй его суть;',
    '- option_rationales — массив той же длины, что options (для TRUE_FALSE — ровно 2 элемента: про «верно» и про «неверно»), по одному предложению на вариант: почему он верен или неверен;',
    '- source_lecture_index — номер лекции-источника по меткам «#N» в материалах; source_timecode — начало (mm:ss) раздела расшифровки «[mm:ss–mm:ss]», на который опирается вопрос.',
    LANG_RULES[language],
    'Типы вопросов: SINGLE_CHOICE (один правильный вариант + правдоподобные дистракторы) и TRUE_FALSE (однозначные утверждения).',
    'Избегай дублирования, тривиальных и двусмысленных формулировок.',
    'Верни СТРОГО JSON по схеме: { "questions": [ { "type", "prompt", "options", "correct_option_indexes", "explanation", "option_rationales", "source_lecture_index", "source_timecode", "difficulty" } ] }. Без markdown и пояснений вне JSON.',
    'Значения строго ЗАГЛАВНЫМИ: "type" — SINGLE_CHOICE | TRUE_FALSE; "difficulty" — VERY_EASY | EASY | MEDIUM | HARD.',
    'Для SINGLE_CHOICE: "options" обязателен (столько вариантов, сколько указано в задании; если не указано — 4), "correct_option_indexes" — индекс верного варианта с нуля, ровно один.',
    'Для TRUE_FALSE: "options" НЕ указывай (подписи подставит платформа); "correct_option_indexes" = [0] если утверждение верно, [1] если неверно.',
  ].join('\n');
}

export function quizGenUserPrompt(params: {
  transcripts: string;
  moduleTitle: string;
  singleChoiceCount: number;
  trueFalseCount: number;
  /** gen-2.0: ровно столько вариантов в каждом SINGLE_CHOICE. */
  optionCount?: number;
  /** gen-2.0: сколько из TRUE_FALSE-утверждений должны быть верными (баланс ключей). */
  trueFalseTrueCount?: number;
  /** gen-2.0: формулировки, которые нельзя повторять и перефразировать (A11). */
  doNotReuse?: string[];
  /**
   * gen-2.0: сколько вопросов по каждой лекции (метки «#N»). strict — ровно так и
   * только по расшифровке этой лекции (итоговый мини-квиз); иначе — ориентир
   * равномерного покрытия (тест модуля).
   */
  perLecture?: { index: number; count: number }[];
  perLectureStrict?: boolean;
}): string {
  const lines = [
    `Модуль: «${params.moduleTitle}».`,
    `Сгенерируй ${params.singleChoiceCount} вопрос(ов) SINGLE_CHOICE и ${params.trueFalseCount} вопрос(ов) TRUE_FALSE.`,
  ];
  if (params.optionCount && params.singleChoiceCount > 0) {
    lines.push(`В каждом SINGLE_CHOICE — ровно ${params.optionCount} варианта(ов) ответа.`);
  }
  if (params.trueFalseTrueCount !== undefined && params.trueFalseCount > 0) {
    const t = Math.min(params.trueFalseTrueCount, params.trueFalseCount);
    lines.push(`Из TRUE_FALSE-утверждений верных — ровно ${t}, неверных — ${params.trueFalseCount - t}.`);
  }
  if (params.perLecture?.length) {
    const list = params.perLecture.map((p) => `#${p.index} — ${p.count}`).join(', ');
    lines.push(
      params.perLectureStrict
        ? `Ровно столько вопросов по каждой лекции (номер — число): ${list}; вопрос опирается только на расшифровку своей лекции, source_lecture_index = её номер; порядок — по номерам лекций.`
        : `Распредели вопросы по лекциям (номер — число): ${list}; не сосредотачивайся на первой лекции.`,
    );
  }
  if (params.doNotReuse?.length) {
    lines.push(
      'НЕ повторяй и не перефразируй эти вопросы (они уже используются в курсе) — бери другие аспекты материала:',
      ...params.doNotReuse.map((p) => `- ${p.replace(/\s+/g, ' ').trim()}`),
    );
  }
  lines.push('Материалы (расшифровки лекций; метки «#N» — номера для source_lecture_index):', '---', params.transcripts, '---');
  return lines.join('\n');
}

/* ── gen-2.0: ремонт дистракторов (подсказка длиной) ─────────────── */
export function distractorRepairSystemPrompt(language: Language): string {
  return [
    `Ты — редактор тестовых заданий на ${LANG_NAME[language]}.`,
    'Для каждого вопроса перепиши ТОЛЬКО неверные варианты (дистракторы). Формулировку вопроса и верный вариант не меняй.',
    'Цель — убрать подсказку длиной: верный вариант не должен выделяться длиной или подробностью.',
    'Каждый новый дистрактор однозначно неверен по материалу, но правдоподобен (типичная ошибка понимания, смешение близких понятий);',
    'той же грамматической формы, стиля и степени подробности, что верный вариант (correct_chars — его длина в символах);',
    'длина i-го дистрактора — примерно target_chars[i] символов (±10%): короткий дистрактор дополни правдоподобным, но неверным уточнением (условие, автор, следствие); хотя бы один дистрактор длиннее верного варианта;',
    'без абсурдных вариантов, без «всё перечисленное» и без повторов между собой.',
    'Число дистракторов — ровно как в исходном вопросе. К каждому — одно предложение, почему он неверен (distractor_rationales, в том же порядке), без ссылок на номер или букву варианта.',
    LANG_RULES[language],
    'Верни СТРОГО JSON: {"items": [{"key": 0, "distractors": ["..."], "distractor_rationales": ["..."]}]}. Без markdown.',
  ].join('\n');
}

export function distractorRepairUserPrompt(params: {
  items: { key: number; prompt: string; correct: string; correct_chars: number; distractors: string[]; target_chars: number[] }[];
  transcripts?: string;
}): string {
  const lines = ['Вопросы для правки (JSON):', JSON.stringify(params.items, null, 1)];
  if (params.transcripts) lines.push('Материалы для сверки фактов:', '---', params.transcripts, '---');
  return lines.join('\n');
}

/* ── gen-2.0: обоснования вариантов для существующих вопросов ─────── */
export function rationaleGenSystemPrompt(language: Language): string {
  return [
    `Ты — методист, поясняющий тестовые вопросы на ${LANG_NAME[language]}.`,
    'Текст вопросов, варианты и верный ответ НЕ меняются — ты только поясняешь их, опираясь СТРОГО на материалы.',
    'option_rationales — по одному предложению на КАЖДЫЙ вариант в исходном порядке: почему он верен или неверен.',
    'Для TRUE_FALSE варианты — [«верно», «неверно»]: ровно 2 предложения.',
    'Не ссылайся на номер, букву или порядок варианта («первый вариант», «вариант B») — называй его суть.',
    'source_lecture_index — номер лекции-источника по меткам «#N»; source_timecode — начало (mm:ss) раздела «[mm:ss–mm:ss]», где есть опора для ответа.',
    'Простой текст без markdown.',
    LANG_RULES[language],
    'Верни СТРОГО JSON: {"items": [{"key": 0, "option_rationales": ["..."], "source_lecture_index": 0, "source_timecode": "mm:ss"}]}.',
  ].join('\n');
}

export function rationaleGenUserPrompt(params: {
  items: { key: number; type: string; prompt: string; options: string[]; correct_option_indexes: number[] }[];
  transcripts: string;
}): string {
  return [
    'Вопросы (JSON):',
    JSON.stringify(params.items, null, 1),
    'Материалы (метки «#N» — номера для source_lecture_index):',
    '---',
    params.transcripts,
    '---',
  ].join('\n');
}

/* ── gen-2.0: перевод канонических вопросов (USER_DECISIONS §5) ───── */
export function questionTranslateSystemPrompt(
  source: Language,
  target: Language,
  glossary?: Record<string, string> | string,
): string {
  return [
    `Ты — профессиональный переводчик учебных тестов с ${LANG_NAME[source]} на ${LANG_NAME[target]}.`,
    'Переведи каждый вопрос точно по смыслу: prompt, options, option_rationales, explanation.',
    'СОХРАНЯЙ число и ПОРЯДОК вариантов и обоснований: i-й элемент перевода соответствует i-му элементу оригинала.',
    'Не меняй, какой вариант верный; не добавляй, не убирай и не объединяй варианты.',
    'Сохраняй различимость дистракторов и соотношение длин вариантов: верный вариант не должен стать заметно длиннее других.',
    'Имена и термины — в принятой в целевом языке форме.',
    ...glossaryLine(glossary),
    LANG_RULES[target],
    'Простой текст без markdown.',
    'Верни СТРОГО JSON: {"items": [{"key": 0, "prompt": "...", "options": ["..."], "option_rationales": ["..."], "explanation": "..."}]}. Для TRUE_FALSE "options" не указывай.',
  ].join('\n');
}

export function questionTranslateUserPrompt(
  items: { key: number; type: string; prompt: string; options?: string[]; option_rationales?: string[]; explanation?: string }[],
): string {
  return ['Вопросы для перевода (JSON):', JSON.stringify(items, null, 1)].join('\n');
}

/* ── gen-2.0: краткое содержание лекции ───────────────────────────── */
export function lectureSummaryGenSystemPrompt(language: Language, maxChars = 400): string {
  return [
    `Ты — редактор учебного курса. Напиши краткое содержание лекции на ${LANG_NAME[language]}.`,
    `2–3 нейтральных предложения, всего не длиннее ${maxChars} символов: какие вопросы и понятия рассматривает лекция.`,
    'Без оценок («интересная», «важная»), без обращений к слушателю, без рекламных оборотов, без таймкодов и без markdown.',
    LANG_RULES[language],
    'Верни СТРОГО JSON: {"summary": "..."}.',
  ].join('\n');
}

export function lectureSummaryGenUserPrompt(params: { title: string; transcript: string }): string {
  return [`Лекция: «${params.title}».`, 'Расшифровка:', '---', params.transcript, '---'].join('\n');
}

/* ── gen-2.0: перевод/корректура раздела расшифровки ─────────────── */
export function transcriptSectionSystemPrompt(params: {
  mode: 'translate' | 'correct';
  target: Language;
  source?: Language;
  glossary?: Record<string, string> | string;
}): string {
  const common = [
    ...glossaryLine(params.glossary),
    LANG_RULES[params.target],
    'Таймкоды раздела обрабатывает платформа — не добавляй их в title и text.',
    'Верни СТРОГО JSON: {"title": "...", "text": "...", "notes": ["..."]}. Без markdown вне JSON.',
  ];
  if (params.mode === 'translate') {
    return [
      `Ты — профессиональный переводчик расшифровок видеолекций${params.source ? ` с ${LANG_NAME[params.source]}` : ''} на ${LANG_NAME[params.target]}.`,
      'Переведи раздел ПОЛНОСТЬЮ, абзац за абзацем, ничего не сокращая и не добавляя. Сохраняй абзацы, списки и устный стиль лекции.',
      'title — перевод заголовка раздела. notes — короткие пометки переводчика (термины, сомнительные места); если их нет — пустой массив.',
      ...common,
    ].join('\n');
  }
  return [
    `Ты — редактор-корректор расшифровок видеолекций на ${LANG_NAME[params.target]}.`,
    'Текст — расшифровка УСТНОЙ речи лектора; в нём есть опечатки, искажённые слова и вкрапления другого языка.',
    'Исправь орфографию, искажённые слова и иноязычные фрагменты. Параллельный раздел (reference) — ТОЛЬКО для понимания смысла: не переводи его заново и не переписывай текст.',
    'Сохраняй структуру, порядок мыслей, абзацы и устный характер речи; меняй только ошибочное.',
    'О КАЖДОМ изменении напиши в notes: «было → стало (причина)». title — заголовок раздела (исправленный при необходимости).',
    ...common,
  ].join('\n');
}

export function transcriptSectionUserPrompt(params: { title: string; text: string; reference?: string }): string {
  const lines = ['Раздел (JSON):', JSON.stringify({ title: params.title, text: params.text })];
  if (params.reference) lines.push('Параллельный раздел (reference, только для смысла):', '---', params.reference, '---');
  return lines.join('\n');
}

/* ── gen-2.0: перевод канонического практического задания (USER_DECISIONS §4) ── */
export function practicalTranslateSystemPrompt(
  source: Language,
  target: Language,
  glossary?: Record<string, string> | string,
): string {
  return [
    `Ты — профессиональный переводчик учебных материалов с ${LANG_NAME[source]} на ${LANG_NAME[target]}.`,
    'Переводишь каноническое практическое задание курса (письменный сократический диалог с ИИ-тьютором). Переведи все поля точно по смыслу, без сокращений и добавлений:',
    '- scenario_prompt — условие для студента;',
    '- reference_solution — скрытое эталонное решение;',
    '- key_points — ключевые тезисы рубрики СТРОГО 1:1: то же число и тот же порядок; не объединяй и не дроби тезисы;',
    '- answer_reached_criteria — критерий достижения ответа: переведи точно, не смягчая и не ужесточая;',
    '- agenda — пункты плана беседы (если есть) в том же порядке;',
    '- intro_message — первая реплика тьютора (если есть).',
    ...(target === 'kk'
      ? ['Обращение к студенту — только на «Сіз» (не «сен»); не используй слово «ауызша»: задание выполняется письменно в чате.']
      : []),
    ...glossaryLine(glossary),
    LANG_RULES[target],
    'Верни СТРОГО JSON: {"scenario_prompt": "...", "reference_solution": "...", "key_points": ["..."], "answer_reached_criteria": "...", "agenda": ["..."], "intro_message": "..."}.',
  ].join('\n');
}

export function practicalTranslateUserPrompt(task: {
  scenario_prompt: string;
  reference_solution: string;
  key_points: string[];
  answer_reached_criteria: string;
  agenda?: string[];
  intro_message?: string;
}): string {
  return ['Задание (JSON):', JSON.stringify(task, null, 1)].join('\n');
}

/* ── gen-2.0: описание курса для каталога ─────────────────────────── */
export function courseDescriptionGenSystemPrompt(language: Language): string {
  return [
    `Ты — редактор каталога курсов университета. Напиши описание курса на ${LANG_NAME[language]}.`,
    '- description: 3–5 предложений — о чём курс, для кого и чему учит; нейтрально, без рекламных штампов и восклицаний;',
    '- outcomes: 4–6 результатов обучения, каждый — одно короткое предложение, начинающееся с глагола действия.',
    'Опирайся только на перечень тем и кратких содержаний ниже. Без markdown, без чисел лекций и часов (их добавит платформа).',
    LANG_RULES[language],
    'Верни СТРОГО JSON: {"description": "...", "outcomes": ["..."]}.',
  ].join('\n');
}

export function courseDescriptionGenUserPrompt(params: {
  courseTitle: string;
  modules: { title: string; lectures: { title: string; summary?: string | null }[] }[];
}): string {
  const lines = [`Курс: «${params.courseTitle}».`, 'Структура:'];
  for (const m of params.modules) {
    lines.push(`• ${m.title}`);
    for (const l of m.lectures) lines.push(`  – ${l.title}${l.summary ? ` — ${l.summary}` : ''}`);
  }
  return lines.join('\n');
}

/* ── Генерация практического задания (§5.3) ─────────────────────── */
export function practicalGenSystemPrompt(language: Language, difficulty: Difficulty): string {
  return [
    `Ты — методист, создающий практическое (сократическое) задание на ${LANG_NAME[language]}.`,
    `Целевой уровень сложности: ${DIFFICULTY_GUIDE[difficulty]}.`,
    'Задание охватывает весь курс. Сформируй компактно (без лишних деталей):',
    '- student_facing_scenario (строка): условие/стартовый вопрос для студента;',
    '- reference_solution (строка): эталонное решение (СКРЫТО от студента);',
    '- rubric.key_points: МАССИВ СТРОК (ключевые тезисы);',
    '- rubric.answer_reached_criteria: ОДНА СТРОКА (не массив) — как понять, что студент пришёл к ответу;',
    '- recommended_token_budget (число), recommended_max_ai_messages (число): для полноценного сократического диалога рекомендуй 20–25 реплик и токен-бюджет с запасом;',
    '- difficulty: строка VERY_EASY | EASY | MEDIUM | HARD (не объект).',
    'Верни СТРОГО JSON по схеме (Приложение C). Без markdown вне JSON. Не превышай ~1500 слов суммарно.',
    'Структура (rubric содержит ТОЛЬКО key_points и answer_reached_criteria; остальные поля — на верхнем уровне):',
    '{"student_facing_scenario": "...", "reference_solution": "...", "rubric": {"key_points": ["..."], "answer_reached_criteria": "..."}, "recommended_token_budget": 0, "recommended_max_ai_messages": 0, "difficulty": "MEDIUM"}',
  ].join('\n');
}

export function practicalGenUserPrompt(params: { transcripts: string; courseTitle: string }): string {
  return [
    `Курс: «${params.courseTitle}». Материалы всего курса ниже.`,
    '---',
    params.transcripts,
    '---',
  ].join('\n');
}
