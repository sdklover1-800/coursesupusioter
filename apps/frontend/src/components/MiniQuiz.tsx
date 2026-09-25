import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMiniQuiz, type PracticeItem } from '../lib/quiz';
import { ModeBadge, Skeleton } from './ui';
import { PracticeRunner } from './quiz/PracticeRunner';

/**
 * Мини-квиз — тренировочное закрепление материала (retrieval practice, FE3 §4).
 * НЕ оценивается: не создаёт попыток, не влияет на прогресс и не попадает в оценочную
 * телеметрию (валидность исследования). Та же плитка вариантов и полоса обратной связи,
 * что в тренировке по модулю, но в карточке, без режима фокуса.
 *
 * hideHeading (A29) — не рисовать заголовок «Мини-квиз · N вопросов» и плашку режима:
 * FE1 встраивает квиз в карточку итогового мини-квиза со своим заголовком.
 * Нет квиза или вопросов — ничего не рисуем (без «сиротского» заголовка); загрузка — скелет.
 */
export function MiniQuiz({ url, enrollmentId, hideHeading }: { url: string; enrollmentId: string; hideHeading?: boolean }) {
  const { t } = useTranslation();
  const { data, isLoading } = useMiniQuiz(url, enrollmentId);
  const quiz = data?.quiz ?? null;

  const items = useMemo<PracticeItem[]>(
    () => (quiz ? quiz.questions.map((q, i) => ({ quizId: quiz.id, question: { ...q, orderIndex: i }, source: 'MINI' as const })) : []),
    [quiz],
  );

  if (isLoading) {
    return (
      <div className="surface-practice space-y-3 p-5 sm:p-6" aria-busy="true">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  if (!quiz || items.length === 0) return null;

  const header = hideHeading ? null : (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <h3 className="text-title text-fg">{t('quiz.mini.heading', { questions: t('quiz.questions', { count: items.length }) })}</h3>
      <ModeBadge mode="practice" long />
    </div>
  );

  return <PracticeRunner key={quiz.id} variant="inline" items={items} enrollmentId={enrollmentId} header={header} />;
}
