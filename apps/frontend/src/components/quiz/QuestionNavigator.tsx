import { clsx } from 'clsx';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../icons';

export interface NavigatorItem {
  id: string;
  answered: boolean;
  flagged: boolean;
}

/**
 * Навигатор официальной попытки (FE3 §6, Moodle/Canvas): ТОЛЬКО четыре нейтральных
 * состояния — отвечен (ink), без ответа (контур), текущий (кольцо brand), отмечен (флажок).
 * Никаких цветов правильности. strip — горизонтальная лента (мобильные), rail — правая колонка (lg).
 */
export function QuestionNavigator({
  items, current, onJump, variant,
}: {
  items: NavigatorItem[];
  current: number;
  onJump: (index: number) => void;
  variant: 'strip' | 'rail';
}) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLOListElement>(null);
  const answered = items.filter((i) => i.answered).length;
  const flagged = items.filter((i) => i.flagged).length;

  // Лента: текущий вопрос всегда в поле зрения
  useEffect(() => {
    if (variant !== 'strip') return;
    const el = listRef.current?.children[current] as HTMLElement | undefined;
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [current, variant]);

  const chips = (
    <ol
      ref={listRef}
      className={clsx(variant === 'strip' ? 'flex gap-2 overflow-x-auto px-0.5 py-3' : 'grid grid-cols-5 gap-2.5 p-0.5')}
    >
      {items.map((it, i) => {
        const isCurrent = i === current;
        const label = [
          t('quiz.runner.navItem', { n: i + 1 }),
          it.answered ? t('quiz.runner.navAnswered') : t('quiz.runner.navUnanswered'),
          it.flagged ? t('quiz.runner.navFlagged') : null,
          isCurrent ? t('quiz.runner.navCurrent') : null,
        ]
          .filter(Boolean)
          .join(', ');
        return (
          <li key={it.id} className="shrink-0">
            <button
              type="button"
              onClick={() => onJump(i)}
              aria-label={label}
              aria-current={isCurrent ? 'step' : undefined}
              className={clsx(
                'relative grid h-9 w-9 place-items-center rounded-lg font-mono text-sm font-semibold tabular-nums transition-colors',
                it.answered
                  ? 'bg-ink text-white dark:bg-fg dark:text-ink'
                  : 'border border-border-strong bg-card text-fg hover:border-brand/60',
                isCurrent && 'ring-2 ring-brand ring-offset-2 ring-offset-surface',
              )}
            >
              {i + 1}
              {it.flagged && (
                <span className="absolute -right-1.5 -top-1.5 grid h-[18px] w-[18px] place-items-center rounded-full border border-border bg-card text-brand" aria-hidden>
                  <Icon name="flag" size={11} strokeWidth={2} />
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );

  if (variant === 'strip') {
    return (
      <nav aria-label={t('quiz.runner.navLabel')} className="min-w-0">
        {chips}
      </nav>
    );
  }

  return (
    <nav aria-label={t('quiz.runner.navLabel')} className="card p-5">
      <div className="text-label text-fg-2">{t('quiz.runner.navLabel')}</div>
      <div className="mb-3 mt-0.5 text-body font-semibold text-fg">
        {t('quiz.submit.summary', { answered, total: items.length, flagged })}
      </div>
      {chips}
      {/* Легенда: только нейтральные состояния */}
      <ul className="mt-4 space-y-1.5 text-small text-fg-2">
        <li className="flex items-center gap-2">
          <span className="h-3.5 w-3.5 rounded bg-ink dark:bg-fg" aria-hidden />
          <span className="inline-block first-letter:uppercase">{t('quiz.runner.navAnswered')}</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="h-3.5 w-3.5 rounded border border-border-strong bg-card" aria-hidden />
          <span className="inline-block first-letter:uppercase">{t('quiz.runner.navUnanswered')}</span>
        </li>
        <li className="flex items-center gap-2">
          <Icon name="flag" size={14} className="text-brand" />
          <span className="inline-block first-letter:uppercase">{t('quiz.runner.navFlagged')}</span>
        </li>
      </ul>
    </nav>
  );
}
