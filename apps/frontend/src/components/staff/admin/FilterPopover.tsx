import { clsx } from 'clsx';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui';

/** Воронка фильтра (lucide «filter», ISC) — в общем наборе иконок её нет. */
function FunnelIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-fg-2">
      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
    </svg>
  );
}

/**
 * Кнопка «Фильтры (n)» с поповером (screen_specs «Admin»: вторичная кнопка тулбара).
 * Неблокирующий поповер (role=dialog, не модальный): Esc и клик вне закрывают, фокус
 * уходит в первое поле и возвращается на кнопку.
 */
export function FilterPopover({
  count, children, onReset, align = 'right', className,
}: {
  /** Число активных фильтров (бейдж на кнопке) */
  count: number;
  children: ReactNode;
  onReset?: () => void;
  align?: 'left' | 'right';
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[data-popover-panel] select, [data-popover-panel] input')?.focus();
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <Button
        ref={btnRef}
        variant="secondary"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="whitespace-nowrap"
      >
        <FunnelIcon />
        {t('admin.usersPage.filters')}
        {count > 0 && (
          <span className="num grid h-6 min-w-[1.5rem] place-items-center rounded-full bg-brand-fill px-1.5 text-white">{count}</span>
        )}
      </Button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={t('admin.usersPage.filters')}
          data-popover-panel
          className={clsx(
            'card absolute top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] animate-fade-in space-y-4 p-4 shadow-float',
            // На мобильных кнопка стоит у левого края — панель раскрывается вправо
            align === 'right' ? 'left-0 sm:left-auto sm:right-0' : 'left-0',
          )}
        >
          {children}
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            {onReset ? (
              <Button variant="ghost" size="sm" onClick={onReset} disabled={count === 0}>
                {t('admin.resetFilters')}
              </Button>
            ) : (
              <span />
            )}
            <Button
              size="sm"
              onClick={() => {
                setOpen(false);
                btnRef.current?.focus();
              }}
            >
              {t('common.close')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
