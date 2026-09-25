import { clsx } from 'clsx';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ReviewItem as ReviewItemData } from '@edu/shared';
import { routes } from '../../lib/learn';
import { optionLetter } from '../../lib/quiz';
import { Icon } from '../icons';
import { ReportIssueButton } from '../ReportIssue';
import { OptionTile, type OptionMark, type ReviewTag } from './OptionTile';

/**
 * Вопрос полного разбора (уровень FULL, FE3 §7): варианты в порядке ЭТОЙ попытки с метками
 * «Ваш ответ» / «Верный ответ», обоснование под каждым вариантом, блок «Почему» и ссылка
 * на фрагмент лекции «▶ Лекция N · мм:сс». Показывается только после финала теста.
 */
export function ReviewItem({
  item, index, courseId, enrollmentId,
}: {
  item: ReviewItemData;
  /** Номер вопроса в попытке (с 1) */
  index: number;
  courseId: string;
  enrollmentId: string;
}) {
  const { t } = useTranslation();
  const selected = item.selected ?? [];
  const correct = item.correctOptionIds ?? [];
  const options = item.options ?? [];
  const src = item.source ?? null;
  const promptId = `review-q-${item.questionId}`;

  return (
    <article id={`q-${index}`} aria-labelledby={promptId} className="card scroll-mt-40 p-4 sm:p-6">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-label tabular-nums text-fg-2">{t('quiz.question')} {index}</span>
        <span className={clsx('inline-flex items-center gap-1 text-label font-semibold', item.isCorrect ? 'text-teal-ink' : 'text-danger-ink')}>
          <Icon name={item.isCorrect ? 'check' : 'x'} size={15} strokeWidth={2.5} />
          {item.isCorrect ? t('quiz.review.itemCorrect') : t('quiz.review.itemWrong')}
        </span>
      </div>
      <h3 id={promptId} className="text-title text-fg">
        {item.prompt}
      </h3>

      <ul className="mt-4 space-y-2.5">
        {options.map((opt, i) => {
          const isSel = selected.includes(opt.id);
          const isKey = correct.includes(opt.id);
          const mark: OptionMark | null = isKey ? (isSel ? 'correct' : 'key') : isSel ? 'wrong' : null;
          const tags: ReviewTag[] = [];
          if (isSel) tags.push('yours');
          if (isKey) tags.push('correct');
          const rationale = item.optionRationales?.[opt.id] ?? null;
          return (
            <li key={opt.id}>
              <OptionTile mode="review" letter={optionLetter(i)} text={opt.text} selected={isSel} mark={mark} tags={tags} rationale={rationale} />
            </li>
          );
        })}
      </ul>
      {selected.length === 0 && <p className="mt-2 text-sm font-medium text-fg-2">{t('quiz.review.noAnswer')}</p>}

      {item.explanation && (
        <div className="mt-4 rounded-xl bg-surface-2 px-4 py-3">
          <div className="text-label font-semibold text-fg">{t('quiz.review.why')}</div>
          <p className="mt-1 text-sm leading-[1.6] text-fg/80">{item.explanation}</p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {src ? (
          <Link
            to={routes.lecture(courseId, enrollmentId, src.lectureId, { t: src.seconds ?? undefined })}
            className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-lg text-sm font-medium text-brand hover:underline"
          >
            <Icon name="play" size={14} fill="currentColor" />
            <span>
              {src.lectureNumber ? t('quiz.review.source', { n: src.lectureNumber }) : t('quiz.review.sourcePlain')}
              {src.timecode && <span className="num"> · {src.timecode}</span>}
              <span className="text-fg-2"> — {t('quiz.review.rewatch')}</span>
            </span>
          </Link>
        ) : (
          <span />
        )}
        <ReportIssueButton targetType="QUIZ_QUESTION" targetId={item.questionId} context="REVIEW" enrollmentId={enrollmentId} className="-mr-2.5" />
      </div>
    </article>
  );
}
