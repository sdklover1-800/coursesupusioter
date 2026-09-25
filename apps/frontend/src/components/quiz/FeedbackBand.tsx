import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { Icon } from '../icons';

/** Вид обратной связи тренировки: верно / первый неверный / раскрыт разбор. */
export type FeedbackKind = 'correct' | 'wrong' | 'revealed';

/**
 * Полоса обратной связи — ТОЛЬКО тренировка (design_direction §8, Duolingo-лента).
 * mode — литерал 'practice': в официальной попытке (mode 'official') эту полосу
 * отрисовать нельзя — ни здесь (тип), ни через QuestionShell (band?: never в ветке official).
 */
export interface FeedbackBandProps {
  mode: 'practice';
  kind: FeedbackKind;
  title: string;
  /** Пояснение, обоснование выбранного варианта, подсказка «что дальше» */
  children?: ReactNode;
  /** Кнопки действий («Попробовать ещё», «Показать разбор», «Дальше») */
  actions?: ReactNode;
  /** footer — внутри фиксированного подвала режима фокуса; inline — внутри карточки мини-квиза */
  variant?: 'footer' | 'inline';
  className?: string;
}

const TONE: Record<FeedbackKind, { box: string; icon: string; title: string; glyph: 'check' | 'x' | 'info' }> = {
  correct: { box: 'bg-teal/12', icon: 'bg-teal-ink text-white dark:text-ink', title: 'text-teal-ink', glyph: 'check' },
  wrong: { box: 'bg-danger/8', icon: 'bg-danger-ink text-white dark:text-ink', title: 'text-danger-ink', glyph: 'x' },
  revealed: { box: 'bg-brand-soft/70', icon: 'bg-brand-fill text-white', title: 'text-fg', glyph: 'info' },
};

export function FeedbackBand({ kind, title, children, actions, variant = 'inline', className }: FeedbackBandProps) {
  const tone = TONE[kind];
  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        'animate-fade-in',
        tone.box,
        variant === 'inline' ? 'mt-4 rounded-xl px-4 py-3.5' : 'rounded-xl px-4 py-3.5 sm:px-5',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className={clsx('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full', tone.icon)} aria-hidden>
          <Icon name={tone.glyph} size={16} strokeWidth={2.5} />
        </span>
        <div className="min-w-0 flex-1">
          <div className={clsx('text-body font-semibold leading-7', tone.title)}>{title}</div>
          {children && <div className="mt-1 space-y-1.5 text-body leading-6 text-fg">{children}</div>}
        </div>
      </div>
      {actions && <div className="mt-3 flex flex-wrap items-center justify-end gap-2">{actions}</div>}
    </div>
  );
}
