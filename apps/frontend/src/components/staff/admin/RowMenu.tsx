import { clsx } from 'clsx';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../../ui';

export interface RowMenuItem {
  key: string;
  label: string;
  icon?: IconName;
  danger?: boolean;
  onSelect: () => void;
}

const MENU_W = 232;

/**
 * Меню «⋮» строки таблицы. В отличие от Menu из примитивов, панель рендерится в портал
 * с position: fixed — контейнер таблицы с overflow-x-auto её не обрезает.
 * Esc / клик вне / прокрутка — закрыть; ↑/↓/Home/End — по пунктам; фокус возвращается на кнопку.
 */
export function RowMenu({ label, items, className }: { label: string; items: RowMenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = (focusBack = true) => {
    setOpen(false);
    if (focusBack) btnRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const h = menuRef.current?.offsetHeight ?? items.length * 44 + 8;
    const below = r.bottom + 6 + h <= window.innerHeight - 8;
    const top = below ? r.bottom + 6 : Math.max(8, r.top - 6 - h);
    const left = Math.min(Math.max(8, r.right - MENU_W), window.innerWidth - MENU_W - 8);
    setPos({ top, left });
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDoc = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !btnRef.current?.contains(target)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      close(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
    // close стабилен по смыслу; подписка — только на открытие
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onMenuKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(e.key)) return;
    if (e.key === 'Tab') {
      close(false);
      return;
    }
    e.preventDefault();
    const els = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? els.length - 1 : e.key === 'ArrowDown' ? (i + 1) % els.length : (i - 1 + els.length) % els.length;
    els[next]?.focus();
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'grid h-10 w-10 shrink-0 place-items-center rounded-full text-fg-2 transition-colors hover:bg-brand-soft hover:text-fg',
          open && 'bg-brand-soft text-fg',
          className,
        )}
      >
        <Icon name="more" size={20} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKey}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: MENU_W }}
            className="card fixed z-50 animate-fade-in p-1 shadow-float"
          >
            {items.map((it) => (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  close(false);
                  it.onSelect();
                }}
                className={clsx(
                  'flex min-h-[2.75rem] w-full items-center gap-3 rounded-lg px-3 text-left text-body font-medium transition-colors hover:bg-brand-soft focus:bg-brand-soft focus:outline-none',
                  it.danger ? 'text-danger-ink' : 'text-fg',
                )}
              >
                {it.icon && <Icon name={it.icon} size={18} className={it.danger ? '' : 'text-fg-2'} />}
                <span className="flex-1">{it.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
