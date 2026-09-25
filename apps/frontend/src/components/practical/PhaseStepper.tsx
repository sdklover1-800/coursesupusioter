import { clsx } from 'clsx';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import type { Phase } from '../../lib/practical';
import { Icon } from '../icons';

const STEPS = ['task', 'dialog', 'evaluation', 'review'] as const;

/**
 * «Задание → Диалог → Оценка → Разбор» (screen_specs «Socratic practical: dialogue»).
 * Этап меняется ТОЛЬКО по структурным событиям (старт, конец сессии, открытие разбора),
 * никогда по баллам. Пройденные — ink-диск с галочкой, текущий — кольцо spark-ink.
 * compact — уже sm: подпись только у текущего этапа (казахские подписи не влезают в 390px).
 */
export function PhaseStepper({ current, className }: { current: Phase; className?: string }) {
  const { t } = useTranslation();
  return (
    <ol aria-label={t('practical.phase.label')} className={clsx('flex min-w-0 items-center gap-1.5 sm:gap-2', className)}>
      {STEPS.map((key, i) => {
        const done = i < current;
        const now = i === current;
        const label = t(`practical.phase.${key}`);
        return (
          <Fragment key={key}>
            {i > 0 && <li aria-hidden className={clsx('h-px w-3 shrink-0 sm:w-5', i <= current ? 'bg-fg-2/60' : 'bg-border-strong')} />}
            <li aria-current={now ? 'step' : undefined} className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden
                className={clsx(
                  'grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-xs font-semibold tabular-nums',
                  done && 'bg-ink text-white dark:bg-fg dark:text-ink',
                  now && 'bg-spark/15 text-spark-ink ring-2 ring-spark-ink',
                  !done && !now && 'border border-border-strong text-fg-2',
                )}
              >
                {done ? <Icon name="check" size={13} strokeWidth={2.5} /> : i + 1}
              </span>
              <span className={clsx('whitespace-nowrap text-small', now ? 'font-semibold text-fg' : 'text-fg-2', !now && 'sr-only sm:not-sr-only')}>
                {label}
                {now && <span className="sr-only"> ({t('practical.phase.current')})</span>}
              </span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
