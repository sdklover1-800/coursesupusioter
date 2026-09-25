import { clsx } from 'clsx';
import {
  useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '../icons';
import { Button, type ButtonVariant } from './Button';

/* ── Общее поведение модальных слоёв: фокус-ловушка, Esc, блок прокрутки, стек ── */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Стек открытых слоёв: клавиши обрабатывает только верхний (Sheet → ConfirmDialog)
const stack: symbol[] = [];
let savedOverflow = '';

/**
 * Поведение модального слоя (Dialog/Sheet): порталы в body, поэтому fixed-оверлей
 * всегда покрывает весь экран, включая боковую панель.
 */
export function useModalBehavior(open: boolean, panelRef: RefObject<HTMLElement>, onClose: () => void, busy?: boolean) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;
    const token = Symbol('modal');
    if (stack.length === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    stack.push(token);
    const prevFocus = document.activeElement as HTMLElement | null;
    // Фокус — на [data-autofocus], иначе на первый элемент (или на саму панель)
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    function onKey(e: KeyboardEvent) {
      if (stack[stack.length - 1] !== token) return;
      if (e.key === 'Escape') {
        if (!busyRef.current) {
          e.stopPropagation();
          closeRef.current();
        }
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      if (!panelRef.current.contains(document.activeElement)) {
        e.preventDefault();
        firstEl.focus();
      } else if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = stack.indexOf(token);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0) document.body.style.overflow = savedOverflow;
      prevFocus?.focus?.();
    };
    // panelRef стабилен; открываем/закрываем только по open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

function CloseButton({ onClick, disabled, className }: { onClick: () => void; disabled?: boolean; className?: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={t('ui.dialog.close')}
      className={clsx(
        'grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-brand-soft hover:text-fg disabled:opacity-40',
        className,
      )}
    >
      <Icon name="x" size={18} />
    </button>
  );
}

/* ── Dialog (модальное окно; на мобильных — нижний лист) ── */
export function Dialog({
  open, onClose, title, description, children, footer, busy, size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** во время запроса не закрываем по Esc/клику по фону */
  busy?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useModalBehavior(open, panelRef, onClose, busy);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 animate-fade-in bg-ink/50 backdrop-blur-[2px]" onClick={() => !busy && onClose()} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={clsx(
          'card relative max-h-[90vh] w-full animate-fade-up overflow-y-auto !rounded-b-none p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] shadow-float focus:outline-none sm:!rounded-2xl sm:pb-6',
          size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : 'max-w-md',
        )}
      >
        <h2 id={titleId} className="pr-10 text-lg font-semibold leading-snug">
          {title}
        </h2>
        {description && (
          <div id={descId} className="mt-1.5 text-body text-fg-2">
            {description}
          </div>
        )}
        <CloseButton onClick={onClose} disabled={busy} className="absolute right-3 top-3" />
        {children && <div className="mt-5">{children}</div>}
        {footer && <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ── Sheet: нижний лист на мобильных, правая панель на десктопе ── */
export function Sheet({
  open, onClose, title, description, children, footer, busy, size = 'md', side = 'auto', headerExtra,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  /** Ширина правой панели: md 420px, lg 560px */
  size?: 'md' | 'lg';
  /** auto — снизу до sm, справа от sm; bottom/right — всегда так */
  side?: 'auto' | 'bottom' | 'right';
  /** Доп. элементы в шапке (слева от ✕), например «‹ Назад» */
  headerExtra?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useModalBehavior(open, panelRef, onClose, busy);

  if (!open) return null;
  const width = size === 'lg' ? 'sm:w-[560px]' : 'sm:w-[420px]';
  const bottom = 'inset-x-0 bottom-0 max-h-[88vh] rounded-t-2xl animate-sheet-up';
  const right = 'inset-y-0 right-0 h-full w-full max-w-full rounded-l-2xl animate-sheet-left';
  const placement =
    side === 'bottom'
      ? bottom
      : side === 'right'
        ? clsx(right, width)
        : clsx(bottom, 'sm:inset-x-auto sm:bottom-auto sm:inset-y-0 sm:right-0 sm:h-full sm:max-h-none sm:rounded-none sm:rounded-l-2xl sm:animate-sheet-left', width);
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 animate-fade-in bg-ink/50 backdrop-blur-[2px]" onClick={() => !busy && onClose()} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={clsx('absolute flex flex-col border border-border bg-card shadow-float focus:outline-none', placement)}
      >
        {side !== 'right' && <div className={clsx('mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border-strong', side === 'auto' && 'sm:hidden')} aria-hidden />}
        <div className="flex shrink-0 items-start gap-2 border-b border-border px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold leading-snug">
              {title}
            </h2>
            {description && (
              <div id={descId} className="mt-0.5 text-sm text-fg-2">
                {description}
              </div>
            )}
          </div>
          {headerExtra}
          <CloseButton onClick={onClose} disabled={busy} className="-mr-2 -mt-1" />
        </div>
        {/* Без подвала — отступ под домашний индикатор (safe area) у нижнего листа */}
        <div className={clsx('min-h-0 flex-1 overflow-y-auto px-5 py-4', !footer && 'pb-[calc(1rem+env(safe-area-inset-bottom,0px))]')}>{children}</div>
        {footer && (
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ── ConfirmDialog — единственная замена native confirm() ── */
export function ConfirmDialog({
  open, title, body, confirmLabel, cancelLabel, tone = 'primary', busy, onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** primary — обычное подтверждение, danger — необратимое, spark — действие тьютора/практикума */
  tone?: Extract<ButtonVariant, 'primary' | 'danger' | 'spark'>;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={body}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy} data-autofocus={tone === 'danger' ? true : undefined}>
            {cancelLabel ?? t('ui.dialog.cancel')}
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={busy} data-autofocus={tone === 'danger' ? undefined : true}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

/* ── Menu — выпадающее меню (кнопка + role=menu) ─────────── */
export interface MenuItem {
  key: string;
  label: ReactNode;
  icon?: IconName;
  onSelect: () => void;
  /** Для радио-пунктов (язык, тема) */
  checked?: boolean;
  lang?: string;
  danger?: boolean;
}

/**
 * Лёгкое меню для мобильной шапки: Esc/клик вне — закрыть, ↑/↓ — по пунктам,
 * aria-haspopup/aria-expanded на кнопке. Пункты с checked — menuitemradio.
 */
export function Menu({
  trigger, triggerLabel, items, align = 'right', className, triggerClassName,
}: {
  trigger: ReactNode;
  triggerLabel: string;
  items: MenuItem[];
  align?: 'left' | 'right';
  className?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const first = rootRef.current?.querySelector<HTMLElement>('[role^="menuitem"]');
    first?.focus();
    function onDoc(e: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function onMenuKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const els = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? els.length - 1 : e.key === 'ArrowDown' ? (i + 1) % els.length : (i - 1 + els.length) % els.length;
    els[next]?.focus();
  }

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerLabel}
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'grid h-11 min-w-[2.75rem] place-items-center rounded-full text-fg transition-colors hover:bg-brand-soft',
          triggerClassName,
        )}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={triggerLabel}
          onKeyDown={onMenuKey}
          className={clsx(
            'card absolute top-full z-50 mt-1.5 min-w-[13rem] animate-fade-in p-1 shadow-float',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role={it.checked === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={it.checked}
              lang={it.lang}
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className={clsx(
                'flex min-h-[2.75rem] w-full items-center gap-3 rounded-lg px-3 text-left text-body font-medium transition-colors hover:bg-brand-soft focus:bg-brand-soft focus:outline-none',
                it.danger ? 'text-danger-ink' : 'text-fg',
              )}
            >
              {it.icon && <Icon name={it.icon} size={18} className="text-muted" />}
              <span className="flex-1">{it.label}</span>
              {it.checked && <Icon name="check" size={16} className="text-brand" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
