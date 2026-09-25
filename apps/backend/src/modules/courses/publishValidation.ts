import type { Prisma } from '@prisma/client';

/** Версия курса со всем, что проверяется перед публикацией. */
export const publishCheckInclude = {
  modules: { include: { lectures: true, quiz: { include: { questions: true } }, practicalTask: true } },
} satisfies Prisma.CourseLanguageVersionInclude;

export type VersionForPublish = Prisma.CourseLanguageVersionGetPayload<{ include: typeof publishCheckInclude }>;

/**
 * Проблемы, мешающие публикации версии (FR-2.9): у каждой лекции — видео и
 * расшифровка, у каждого модуля — готовое оценивание. Пустой список — можно публиковать.
 * Общая для API и CLI (scripts/publish-course), чтобы правила не разошлись.
 */
export function publishProblems(version: VersionForPublish): string[] {
  const problems: string[] = [];
  if (version.modules.length === 0) problems.push('Нет модулей');
  for (const m of version.modules) {
    if (m.lectures.length === 0) problems.push(`Модуль «${m.title}»: нет лекций`);
    for (const l of m.lectures) {
      if (!l.youtubeVideoId) problems.push(`Лекция «${l.title}»: не задано видео`);
      if (!l.transcriptText?.trim()) problems.push(`Лекция «${l.title}»: пустая расшифровка`);
    }
    if (m.assessmentType === 'QUIZ' && (!m.quiz || m.quiz.questions.length === 0)) problems.push(`Модуль «${m.title}»: нет готового теста`);
    if (m.assessmentType === 'PRACTICAL' && !m.practicalTask) problems.push(`Модуль «${m.title}»: нет практического задания`);
  }
  return problems;
}
