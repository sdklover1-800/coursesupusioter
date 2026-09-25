import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProgressBreakdown } from '../../lib/learn';
import { useFormat } from '../../lib/format';
import { Card, Icon, ProgressRing } from '../ui';

/**
 * Карточка прогресса (Open edX Progress): кольцо 88px с процентом курса и строки
 * «Лекции 6/15 · Модульные тесты 1/4 · Практикум ✓», «Осталось видео ≈ …».
 * Только собственные результаты студента — без сравнений с другими (валидность исследования).
 */
export function ProgressCard({
  progress, className, headingLevel = 2, eyebrow,
}: {
  progress: ProgressBreakdown;
  className?: string;
  headingLevel?: 2 | 3;
  /** Название курса над заголовком (главная: к какому курсу относится рельс) */
  eyebrow?: string;
}) {
  const { t } = useTranslation();
  const { formatDuration } = useFormat();
  const pct = Math.round(progress.percent ?? 0);
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const rows: { key: string; label: string; value: ReactNode }[] = [
    { key: 'lectures', label: t('course.progress.lectures'), value: <span className="num">{progress.lecturesDone}/{progress.lecturesTotal}</span> },
  ];
  if (progress.quizzesTotal > 0) {
    rows.push({ key: 'quizzes', label: t('course.progress.quizzes'), value: <span className="num">{progress.quizzesPassed}/{progress.quizzesTotal}</span> });
  }
  if (progress.practicalTotal > 0) {
    rows.push({
      key: 'practical',
      label: t('course.progress.practical'),
      value: progress.practicalPassed ? (
        <span className="inline-flex items-center gap-1 text-label font-semibold text-teal-ink">
          <Icon name="check" size={16} strokeWidth={2.25} />
          {t('course.progress.passed')}
        </span>
      ) : (
        <span className="num text-fg-2">—</span>
      ),
    });
  }
  return (
    <Card className={clsx('!p-5', className)}>
      {eyebrow && <p className="eyebrow mb-0.5 line-clamp-1">{eyebrow}</p>}
      <H className="font-sans text-title">{t('course.progress.title')}</H>
      <div className="mt-4 flex items-center gap-5">
        <ProgressRing value={pct / 100} size={88} stroke={8} label={t('course.progress.ring', { value: pct })}>
          <span className="font-display text-display-md tabular-nums text-fg">{pct}%</span>
        </ProgressRing>
        <dl className="min-w-0 flex-1 space-y-1.5">
          {rows.map((r) => (
            <div key={r.key} className="flex items-baseline justify-between gap-3">
              <dt className="text-meta text-fg-2">{r.label}</dt>
              <dd className="shrink-0 text-fg">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {progress.remainingSec !== null && progress.remainingSec !== undefined && progress.remainingSec > 0 && (
        <p className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-meta text-fg-2">
          <Icon name="clock" size={16} />
          <span>
            {t('course.progress.remaining')} <span className="font-medium text-fg">{formatDuration(progress.remainingSec, 'human')}</span>
          </span>
        </p>
      )}
    </Card>
  );
}
