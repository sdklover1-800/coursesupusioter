import type { Prisma } from '@prisma/client';
import { CourseHealthCode, type CourseHealthItem, type CourseHealthTitleKind, type PublishStatus } from '@edu/shared';
import { LECTURE_TITLE_MAX, lectureTitleProblemCode, lectureTitleProblemText } from './lectureTitle.js';

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

const item = (code: CourseHealthCode, params: CourseHealthItem['params'] = {}): CourseHealthItem => ({ code, params });

/**
 * Проблемы, мешающие публикации версии (FR-2.9): у каждой лекции — видео,
 * расшифровка и чистое название (оно публично видно в каталоге), у каждого модуля —
 * готовое оценивание. Пустой список — можно публиковать. Код + параметры — клиент
 * переводит сам (kk/en-интерфейс редактора); русский текст — healthItemText.
 */
export function publishProblemItems(version: VersionForPublish): CourseHealthItem[] {
  const problems: CourseHealthItem[] = [];
  if (version.modules.length === 0) problems.push(item(CourseHealthCode.NO_MODULES));
  for (const m of version.modules) {
    const module = short(m.title);
    if (m.lectures.length === 0) problems.push(item(CourseHealthCode.MODULE_NO_LECTURES, { module }));
    for (const l of m.lectures) {
      const lecture = short(l.title);
      if (!l.youtubeVideoId) problems.push(item(CourseHealthCode.LECTURE_NO_VIDEO, { lecture }));
      if (!l.transcriptText?.trim()) problems.push(item(CourseHealthCode.LECTURE_NO_TRANSCRIPT, { lecture }));
      const titleProblem = lectureTitleProblemCode(l.title);
      if (titleProblem === 'METADATA') problems.push(item(CourseHealthCode.LECTURE_TITLE_METADATA, { lecture }));
      if (titleProblem === 'TOO_LONG') problems.push(item(CourseHealthCode.LECTURE_TITLE_TOO_LONG, { lecture, max: LECTURE_TITLE_MAX }));
    }
    if (m.assessmentType === 'QUIZ' && (!m.quiz || m.quiz.questions.length === 0)) problems.push(item(CourseHealthCode.MODULE_NO_QUIZ, { module }));
    if (m.assessmentType === 'PRACTICAL' && !m.practicalTask) problems.push(item(CourseHealthCode.MODULE_NO_PRACTICAL, { module }));
  }
  return problems;
}

/**
 * Блокеры публикации русским текстом. Общая для API и CLI (scripts/publish-course),
 * чтобы правила не разошлись.
 */
export function publishProblems(version: VersionForPublish): string[] {
  return publishProblemItems(version).map(healthItemText);
}

/**
 * Русские служебные префиксы в названиях тестов/практикума: в kk/en-версии это
 * след непереведённой генерации (студент видит «Тест: …» в казахском курсе).
 * «Мини-квиз» — принятый и в казахском термин (kk-локаль интерфейса: «Мини-квиз»,
 * «Қорытынды мини-квиз»), поэтому в kk-версии он не предупреждение.
 */
const RU_TITLE_PREFIXES = ['Тест:', 'Мини-квиз', 'Итоговый мини-квиз', 'Практическое задание'] as const;
const KK_OWN_TERMS: readonly string[] = ['Мини-квиз'];

/** Префиксы, которые в названиях версии этого языка — непереведённый русский. */
export function ruTitlePrefixesFor(language: string): readonly string[] {
  if (language === 'ru') return [];
  return language === 'kk' ? RU_TITLE_PREFIXES.filter((p) => !KK_OWN_TERMS.includes(p)) : RU_TITLE_PREFIXES;
}

/**
 * Предупреждения перед публикацией — НЕ блокируют её (в отличие от publishProblems):
 *  - в параллельных версиях разное число (неархивных) вопросов в тесте модуля —
 *    межъязыковое сравнение результатов некорректно (USER_DECISIONS §5);
 *  - в kk/en-названиях тестов и практикума остались русские префиксы;
 *  - у лекций не задана длительность видео (оценка оставшегося времени);
 *  - открытые системные отметки (экспертная проверка вопросов) — только если передан
 *    opts.openReviewIssues (редактор показывает их отдельным счётчиком и не передаёт).
 */
export function publishWarningItems(
  version: VersionForPublish,
  siblings: readonly SiblingVersion[],
  opts: { openReviewIssues?: number } = {},
): CourseHealthItem[] {
  const warnings: CourseHealthItem[] = [];
  for (const m of version.modules) {
    if (!m.quiz) continue;
    const own = m.quiz.questions.length;
    for (const s of siblings) {
      if (s.language === version.language) continue;
      const other = s.modules.find((x) => x.orderIndex === m.orderIndex)?.quiz;
      if (other && other.questions.length !== own) {
        warnings.push(item(CourseHealthCode.QUESTION_COUNT_MISMATCH, { module: short(m.title), count: own, otherLanguage: s.language, otherCount: other.questions.length }));
      }
    }
  }

  const prefixes = ruTitlePrefixesFor(version.language);
  if (prefixes.length) {
    const titled: { kind: CourseHealthTitleKind; title: string }[] = [];
    for (const m of version.modules) {
      if (m.quiz) titled.push({ kind: 'MODULE_QUIZ', title: m.quiz.title });
      if (m.practicalTask) titled.push({ kind: 'PRACTICAL', title: m.practicalTask.title });
      for (const l of m.lectures) if (l.miniQuiz) titled.push({ kind: 'MINI_QUIZ', title: l.miniQuiz.title });
    }
    if (version.finalMiniQuiz) titled.push({ kind: 'FINAL_MINI_QUIZ', title: version.finalMiniQuiz.title });
    for (const t of titled) {
      const prefix = prefixes.find((p) => t.title.trim().startsWith(p));
      if (prefix) warnings.push(item(CourseHealthCode.RU_TITLE_PREFIX, { kind: t.kind, title: short(t.title), prefix, language: version.language }));
    }
  }

  const lectures = version.modules.flatMap((m) => m.lectures);
  const noDuration = lectures.filter((l) => l.durationSec === null).length;
  if (noDuration > 0) warnings.push(item(CourseHealthCode.NO_VIDEO_DURATION, { count: noDuration, total: lectures.length }));

  if (opts.openReviewIssues && opts.openReviewIssues > 0) {
    warnings.push(item(CourseHealthCode.REVIEW_PENDING, { count: opts.openReviewIssues }));
  }
  return warnings;
}

/** Предупреждения публикации русским текстом (см. publishWarningItems). */
export function publishWarnings(
  version: VersionForPublish,
  siblings: readonly SiblingVersion[],
  opts: { openReviewIssues?: number } = {},
): string[] {
  return publishWarningItems(version, siblings, opts).map(healthItemText);
}

/** «1 вопрос ждёт», «3 вопроса ждут», «5 вопросов ждут» — склонение для сообщения менеджеру. */
function questionsAwaiting(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} вопрос ждёт`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} вопроса ждут`;
  return `${n} вопросов ждут`;
}

const TITLE_KIND_RU: Record<CourseHealthTitleKind, string> = {
  MODULE_QUIZ: 'Тест модуля',
  PRACTICAL: 'Практикум',
  MINI_QUIZ: 'Мини-квиз',
  FINAL_MINI_QUIZ: 'Итоговый мини-квиз',
};

/** Русский текст пункта «здоровья» (ru-интерфейс, CLI, аудит). */
export function healthItemText(i: CourseHealthItem): string {
  const p = i.params;
  const upper = (v: string | number | undefined) => String(v ?? '').toUpperCase();
  switch (i.code) {
    case CourseHealthCode.NO_MODULES:
      return 'Нет модулей';
    case CourseHealthCode.MODULE_NO_LECTURES:
      return `Модуль «${p.module}»: нет лекций`;
    case CourseHealthCode.LECTURE_NO_VIDEO:
      return `Лекция «${p.lecture}»: не задано видео`;
    case CourseHealthCode.LECTURE_NO_TRANSCRIPT:
      return `Лекция «${p.lecture}»: пустая расшифровка`;
    case CourseHealthCode.LECTURE_TITLE_METADATA:
      return `Лекция «${p.lecture}»: ${lectureTitleProblemText('METADATA')}`;
    case CourseHealthCode.LECTURE_TITLE_TOO_LONG:
      return `Лекция «${p.lecture}»: ${lectureTitleProblemText('TOO_LONG')}`;
    case CourseHealthCode.MODULE_NO_QUIZ:
      return `Модуль «${p.module}»: нет готового теста`;
    case CourseHealthCode.MODULE_NO_PRACTICAL:
      return `Модуль «${p.module}»: нет практического задания`;
    case CourseHealthCode.QUESTION_COUNT_MISMATCH:
      return `Модуль «${p.module}»: вопросов в тесте — ${p.count}, а в версии ${upper(p.otherLanguage)} — ${p.otherCount}`;
    case CourseHealthCode.RU_TITLE_PREFIX:
      return `${TITLE_KIND_RU[p.kind as CourseHealthTitleKind] ?? p.kind} «${p.title}»: русский префикс «${p.prefix}» в ${upper(p.language)}-версии`;
    case CourseHealthCode.NO_VIDEO_DURATION:
      return `Не задана длительность видео у ${p.count} из ${p.total} лекций — оставшееся время не рассчитывается`;
    case CourseHealthCode.REVIEW_PENDING:
      return `${questionsAwaiting(Number(p.count))} экспертной проверки`;
  }
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
