import type { Prisma } from '@prisma/client';
import { lectureTitleProblem } from './lectureTitle.js';

/** Версия курса со всем, что проверяется перед публикацией. */
export const publishCheckInclude = {
  modules: { include: { lectures: true, quiz: { include: { questions: true } }, practicalTask: true } },
} satisfies Prisma.CourseLanguageVersionInclude;

export type VersionForPublish = Prisma.CourseLanguageVersionGetPayload<{ include: typeof publishCheckInclude }>;

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
