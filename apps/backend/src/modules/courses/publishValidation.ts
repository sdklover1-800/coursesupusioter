import type { Prisma } from '@prisma/client';
import type { PublishStatus } from '@edu/shared';
import { lectureTitleProblem } from './lectureTitle.js';

const activeQuestions = { where: { archivedAt: null } } as const;

/**
 * Версия курса со всем, что проверяется перед публикацией. Вопросы — только
 * НЕархивные (архивные остаются лишь для разбора старых попыток).
 */
export const publishCheckInclude = {
  modules: {
    orderBy: { orderIndex: 'asc' },
    include: {
      lectures: {
        orderBy: { orderIndex: 'asc' },
        include: { miniQuiz: { select: { id: true, title: true, _count: { select: { questions: activeQuestions } } } } },
      },
      quiz: { include: { questions: activeQuestions } },
      practicalTask: true,
    },
  },
  finalMiniQuiz: { select: { id: true, title: true } },
} satisfies Prisma.CourseLanguageVersionInclude;

export type VersionForPublish = Prisma.CourseLanguageVersionGetPayload<{ include: typeof publishCheckInclude }>;

/** Параллельная версия курса — для сверки числа вопросов в тестах модулей. */
export interface SiblingVersion {
  language: string;
  modules: { orderIndex: number; quiz: { questions: unknown[] } | null }[];
}

/** Короткая форма названия для сообщений (длинное склеенное название не раздувает список). */
const short = (t: string) => (t.length > 70 ? `${t.slice(0, 70)}…` : t);

/**
 * Проблемы, мешающие публикации версии (FR-2.9): у каждой лекции — видео,
 * расшифровка и чистое название (оно публично видно в каталоге), у каждого модуля —
 * готовое оценивание. Пустой список — можно публиковать.
 * Общая для API и CLI (scripts/publish-course), чтобы правила не разошлись.
 */
export function publishProblems(version: VersionForPublish): string[] {
  const problems: string[] = [];
  if (version.modules.length === 0) problems.push('Нет модулей');
  for (const m of version.modules) {
    if (m.lectures.length === 0) problems.push(`Модуль «${m.title}»: нет лекций`);
    for (const l of m.lectures) {
      if (!l.youtubeVideoId) problems.push(`Лекция «${short(l.title)}»: не задано видео`);
      if (!l.transcriptText?.trim()) problems.push(`Лекция «${short(l.title)}»: пустая расшифровка`);
      const titleProblem = lectureTitleProblem(l.title);
      if (titleProblem) problems.push(`Лекция «${short(l.title)}»: ${titleProblem}`);
    }
    if (m.assessmentType === 'QUIZ' && (!m.quiz || m.quiz.questions.length === 0)) problems.push(`Модуль «${m.title}»: нет готового теста`);
    if (m.assessmentType === 'PRACTICAL' && !m.practicalTask) problems.push(`Модуль «${m.title}»: нет практического задания`);
  }
  return problems;
}

/**
 * Русские служебные префиксы в названиях тестов/практикума: в kk/en-версии это
 * след непереведённой генерации (студент видит «Тест: …» в казахском курсе).
 */
const RU_TITLE_PREFIXES = ['Тест:', 'Мини-квиз', 'Итоговый мини-квиз', 'Практическое задание'] as const;
const ruPrefix = (title: string): string | null => RU_TITLE_PREFIXES.find((p) => title.trim().startsWith(p)) ?? null;

/** «1 вопрос ждёт», «3 вопроса ждут», «5 вопросов ждут» — склонение для сообщения менеджеру. */
function questionsAwaiting(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} вопрос ждёт`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} вопроса ждут`;
  return `${n} вопросов ждут`;
}

/**
 * Предупреждения перед публикацией — НЕ блокируют её (в отличие от publishProblems):
 *  - в параллельных версиях разное число (неархивных) вопросов в тесте модуля —
 *    межъязыковое сравнение результатов некорректно (USER_DECISIONS §5);
 *  - в kk/en-названиях тестов и практикума остались русские префиксы;
 *  - у лекций не задана длительность видео (оценка оставшегося времени);
 *  - открытые системные отметки (экспертная проверка вопросов).
 */
export function publishWarnings(
  version: VersionForPublish,
  siblings: readonly SiblingVersion[],
  opts: { openReviewIssues?: number } = {},
): string[] {
  const warnings: string[] = [];
  for (const m of version.modules) {
    if (!m.quiz) continue;
    const own = m.quiz.questions.length;
    for (const s of siblings) {
      if (s.language === version.language) continue;
      const other = s.modules.find((x) => x.orderIndex === m.orderIndex)?.quiz;
      if (other && other.questions.length !== own) {
        warnings.push(`Модуль «${short(m.title)}»: вопросов в тесте — ${own}, а в версии ${s.language.toUpperCase()} — ${other.questions.length}`);
      }
    }
  }

  if (version.language !== 'ru') {
    const titled: { kind: string; title: string }[] = [];
    for (const m of version.modules) {
      if (m.quiz) titled.push({ kind: 'Тест модуля', title: m.quiz.title });
      if (m.practicalTask) titled.push({ kind: 'Практикум', title: m.practicalTask.title });
      for (const l of m.lectures) if (l.miniQuiz) titled.push({ kind: 'Мини-квиз', title: l.miniQuiz.title });
    }
    if (version.finalMiniQuiz) titled.push({ kind: 'Итоговый мини-квиз', title: version.finalMiniQuiz.title });
    for (const t of titled) {
      const prefix = ruPrefix(t.title);
      if (prefix) warnings.push(`${t.kind} «${short(t.title)}»: русский префикс «${prefix}» в ${version.language.toUpperCase()}-версии`);
    }
  }

  const lectures = version.modules.flatMap((m) => m.lectures);
  const noDuration = lectures.filter((l) => l.durationSec === null).length;
  if (noDuration > 0) warnings.push(`Не задана длительность видео у ${noDuration} из ${lectures.length} лекций — оставшееся время не рассчитывается`);

  if (opts.openReviewIssues && opts.openReviewIssues > 0) {
    warnings.push(`${questionsAwaiting(opts.openReviewIssues)} экспертной проверки`);
  }
  return warnings;
}

/**
 * Статус курса по статусам его версий: PUBLISHED — есть опубликованная; ARCHIVED —
 * все версии в архиве; иначе DRAFT (снятие последней опубликованной версии).
 */
export function courseStatusFrom(statuses: readonly PublishStatus[]): PublishStatus {
  if (statuses.includes('PUBLISHED')) return 'PUBLISHED';
  if (statuses.length > 0 && statuses.every((s) => s === 'ARCHIVED')) return 'ARCHIVED';
  return 'DRAFT';
}
