import type { Language } from '@edu/shared';
import { parseTranscript } from './common.js';
import { overlapsWith } from './quality.js';
import { seededRandom } from './shuffle.js';

/**
 * Офлайн-ответы черновиков генерации для LLM_PROVIDER=mock (README: «генерация и диалог
 * работают без реальных вызовов LLM»). Статичный мок-адаптер всегда возвращает одни и
 * те же 2 вопроса — цикл качества gen-2.0 (ровно N различных вопросов без пересечений
 * формулировок, A11) на нём не сходится. Поэтому в mock-режиме callStructured берёт
 * детерминированную заглушку [MOCK] отсюда: из фрагментов расшифровок, по тому же
 * контракту (ответ всё равно проходит Zod-схему вызова). Реальные провайдеры сюда
 * не попадают.
 */

const TAG = '[MOCK]';

const OPTION_LABEL: Record<Language, string> = { ru: 'Вариант', kk: 'Нұсқа', en: 'Option' };
const EXPLANATION: Record<Language, string> = {
  ru: `${TAG} Пояснение к ответу (офлайн-заглушка).`,
  kk: `${TAG} Жауапқа түсініктеме (офлайн үлгі).`,
  en: `${TAG} Explanation of the answer (offline stub).`,
};
const RATIONALE: Record<Language, { right: string; wrong: string }> = {
  ru: { right: `${TAG} Верный ответ по материалу.`, wrong: `${TAG} Неверный ответ по материалу.` },
  kk: { right: `${TAG} Материал бойынша дұрыс жауап.`, wrong: `${TAG} Материал бойынша қате жауап.` },
  en: { right: `${TAG} Correct according to the material.`, wrong: `${TAG} Incorrect according to the material.` },
};

const fmt = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

export interface MockLecture {
  /** Номер лекции по меткам «#N» в промпте (source_lecture_index). */
  index: number;
  title: string;
  transcript: string;
}

interface Fragment {
  text: string;
  timecode?: string;
}

/** Фрагменты расшифровки — предложения средней длины с таймкодом начала раздела. */
function fragments(transcript: string): Fragment[] {
  const parsed = parseTranscript(transcript);
  const parts = parsed.sections.length
    ? parsed.sections.map((s) => ({ body: s.body, timecode: fmt(s.start) as string | undefined }))
    : [{ body: transcript, timecode: undefined }];
  const out: Fragment[] = [];
  for (const p of parts) {
    for (const raw of p.body.replace(/\s+/g, ' ').split(/(?<=[.!?…])\s+/)) {
      const text = raw.trim();
      if (text.length >= 40 && text.length <= 220) out.push({ text, timecode: p.timecode });
    }
  }
  return out;
}

const SYLLABLES = ['ра', 'ло', 'ми', 'ке', 'ту', 'са', 'ны', 'во', 'ди', 'пе', 'зу', 'го', 'ба', 'ри', 'фа', 'чо'];

/** Детерминированная «псевдофраза» — когда в расшифровке не хватило фрагментов. */
function pseudoPhrase(seed: string): string {
  const rnd = seededRandom(seed);
  return Array.from({ length: 6 }, () =>
    Array.from({ length: 3 }, () => SYLLABLES[Math.floor(rnd() * SYLLABLES.length)]!).join(''),
  ).join(' ');
}

/**
 * Заглушка ответа генерации вопросов (quizGenerationSchema): ровно sc + tf вопросов,
 * по лекциям согласно perLecture (иначе по кругу), формулировки не пересекаются с avoid
 * и между собой, варианты одной длины (без подсказки длиной), обоснования и источник есть.
 */
export function mockQuizPayload(p: {
  language: Language;
  lectures: MockLecture[];
  sc: number;
  tf: number;
  tfTrue?: number;
  optionCount: number;
  perLecture?: { index: number; count: number }[];
  avoid: string[];
}): unknown {
  const total = p.sc + p.tf;
  if (!p.lectures.length || total <= 0) return { questions: [] };
  const plan = (p.perLecture ?? []).flatMap((x) => Array<number>(x.count).fill(x.index));
  while (plan.length < total) plan.push(p.lectures[plan.length % p.lectures.length]!.index);

  const pools = new Map(p.lectures.map((l) => [l.index, fragments(l.transcript)]));
  const cursor = new Map<number, number>();
  const picked: string[] = [];
  const clear = (prompt: string) => !overlapsWith(prompt, [...p.avoid, ...picked]);

  const takePrompt = (lecture: MockLecture, n: number): { prompt: string; timecode?: string } => {
    const pool = pools.get(lecture.index) ?? [];
    for (let i = cursor.get(lecture.index) ?? 0; i < pool.length; i++) {
      const prompt = `${TAG} ${pool[i]!.text}`;
      if (clear(prompt)) {
        cursor.set(lecture.index, i + 1);
        return { prompt, timecode: pool[i]!.timecode };
      }
    }
    cursor.set(lecture.index, pool.length);
    for (let attempt = 0; attempt < 50; attempt++) {
      const prompt = `${TAG} ${lecture.title}: ${pseudoPhrase(`${lecture.index}:${n}:${attempt}:${p.avoid.length}`)}`;
      if (clear(prompt)) return { prompt };
    }
    return { prompt: `${TAG} ${pseudoPhrase(`fallback:${lecture.index}:${n}`)}` };
  };

  let tfTrueLeft = p.tfTrue ?? Math.ceil(p.tf / 2);
  const r = RATIONALE[p.language];
  const questions = plan.slice(0, total).map((lectureIndex, n) => {
    const lecture = p.lectures.find((l) => l.index === lectureIndex) ?? p.lectures[0]!;
    const { prompt, timecode } = takePrompt(lecture, n);
    picked.push(prompt);
    const source = { source_lecture_index: lecture.index, ...(timecode ? { source_timecode: timecode } : {}) };
    if (n >= p.sc) {
      const isTrue = tfTrueLeft > 0;
      if (isTrue) tfTrueLeft--;
      return {
        type: 'TRUE_FALSE',
        prompt,
        correct_option_indexes: [isTrue ? 0 : 1],
        explanation: EXPLANATION[p.language],
        option_rationales: isTrue ? [r.right, r.wrong] : [r.wrong, r.right],
        difficulty: 'MEDIUM',
        ...source,
      };
    }
    return {
      type: 'SINGLE_CHOICE',
      prompt,
      options: Array.from({ length: p.optionCount }, (_, k) => `${TAG} ${OPTION_LABEL[p.language]} ${k + 1}`),
      correct_option_indexes: [0],
      explanation: EXPLANATION[p.language],
      option_rationales: Array.from({ length: p.optionCount }, (_, k) => (k === 0 ? r.right : r.wrong)),
      difficulty: 'MEDIUM',
      ...source,
    };
  });
  return { questions };
}

/** Заглушка ремонта дистракторов: новые дистракторы целевой длины. */
export function mockRepairPayload(language: Language, items: { key: number; target_chars: number[] }[]): unknown {
  return {
    items: items.map((i) => ({
      key: i.key,
      distractors: i.target_chars.map((t, k) => `${TAG} ${OPTION_LABEL[language]} ${k + 2}`.padEnd(Math.max(t, 1), '.')),
      distractor_rationales: i.target_chars.map(() => RATIONALE[language].wrong),
    })),
  };
}

/** Заглушка обоснований существующих вопросов (формулировка, варианты и ключ не меняются). */
export function mockRationalePayload(
  language: Language,
  items: { key: number; options: string[]; correct_option_indexes: number[] }[],
): unknown {
  const r = RATIONALE[language];
  return {
    items: items.map((i) => ({
      key: i.key,
      option_rationales: i.options.map((_, k) => (i.correct_option_indexes.includes(k) ? r.right : r.wrong)),
    })),
  };
}

const tagFor = (target: Language) => `${TAG}[${target}]`;

/** Заглушка перевода вопросов: тот же порядок и число вариантов/обоснований. */
export function mockQuestionTranslationPayload(
  target: Language,
  items: { key: number; prompt: string; options?: string[]; option_rationales?: string[]; explanation?: string }[],
): unknown {
  const t = tagFor(target);
  return {
    items: items.map((i) => ({
      key: i.key,
      prompt: `${t} ${i.prompt}`,
      ...(i.options ? { options: i.options.map((o) => `${t} ${o}`) } : {}),
      ...(i.option_rationales ? { option_rationales: i.option_rationales.map((o) => `${t} ${o}`) } : {}),
      ...(i.explanation ? { explanation: `${t} ${i.explanation}` } : {}),
    })),
  };
}

const SUMMARY: Record<Language, (title: string) => string> = {
  ru: (title) => `${TAG} Краткое содержание лекции «${title}» (офлайн-заглушка).`,
  kk: (title) => `${TAG} «${title}» дәрісінің қысқаша мазмұны (офлайн үлгі).`,
  en: (title) => `${TAG} Summary of the lecture “${title}” (offline stub).`,
};

export function mockSummaryPayload(language: Language, title: string): unknown {
  return { summary: SUMMARY[language](title) };
}

/** Заглушка раздела расшифровки: корректура возвращает текст без изменений. */
export function mockTranscriptSectionPayload(
  mode: 'translate' | 'correct',
  target: Language,
  section: { title: string; text: string },
): unknown {
  const text = mode === 'translate' ? `${tagFor(target)} ${section.text}` : section.text;
  return { title: section.title, text, notes: [] };
}

/** Заглушка перевода практического: тезисы и план — 1:1. */
export function mockPracticalTranslationPayload(
  target: Language,
  task: {
    scenario_prompt: string;
    reference_solution: string;
    key_points: string[];
    answer_reached_criteria: string;
    agenda?: string[];
    intro_message?: string;
  },
): unknown {
  const t = tagFor(target);
  return {
    scenario_prompt: `${t} ${task.scenario_prompt}`,
    reference_solution: `${t} ${task.reference_solution}`,
    key_points: task.key_points.map((k) => `${t} ${k}`),
    answer_reached_criteria: `${t} ${task.answer_reached_criteria}`,
    ...(task.agenda ? { agenda: task.agenda.map((a) => `${t} ${a}`) } : {}),
    ...(task.intro_message ? { intro_message: `${t} ${task.intro_message}` } : {}),
  };
}

const DESCRIPTION: Record<Language, { description: (title: string) => string; outcome: (n: number) => string }> = {
  ru: {
    description: (title) => `${TAG} Описание курса «${title}» (офлайн-заглушка).`,
    outcome: (n) => `${TAG} Результат обучения ${n}.`,
  },
  kk: {
    description: (title) => `${TAG} «${title}» курсының сипаттамасы (офлайн үлгі).`,
    outcome: (n) => `${TAG} Оқыту нәтижесі ${n}.`,
  },
  en: {
    description: (title) => `${TAG} Description of the course “${title}” (offline stub).`,
    outcome: (n) => `${TAG} Learning outcome ${n}.`,
  },
};

export function mockCourseDescriptionPayload(language: Language, courseTitle: string): unknown {
  const d = DESCRIPTION[language];
  return { description: d.description(courseTitle), outcomes: [1, 2, 3, 4].map(d.outcome) };
}
