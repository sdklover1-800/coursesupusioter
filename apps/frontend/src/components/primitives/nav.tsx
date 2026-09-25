import { clsx } from 'clsx';
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../icons';

/* ── Tabs (role=tablist, стрелки, управляемые) ───────────── */
export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  /** Счётчик справа от подписи */
  badge?: ReactNode;
  disabled?: boolean;
}

/** Градиент-маска у края прокрутки: вкладки продолжаются за краем (мобильные, длинные kk-подписи). */
const TAB_FADE = '1.5rem';
function edgeMask(start: boolean, end: boolean): CSSProperties | undefined {
  if (!start && !end) return undefined;
  const g = `linear-gradient(to right, ${start ? 'transparent' : '#000'} 0, #000 ${start ? TAB_FADE : '0px'}, #000 calc(100% - ${end ? TAB_FADE : '0px'}), ${end ? 'transparent' : '#000'} 100%)`;
  return { maskImage: g, WebkitMaskImage: g };
}

/**
 * Вкладки WAI-ARIA: ←/→/Home/End переводят фокус и выбирают вкладку.
 * Панели — <TabPanel idPrefix=… id=…> с тем же idPrefix (связь aria-controls/labelledby).
 * Не помещаются — прокрутка по горизонтали с маской у края; выбранная вкладка прокручивается в вид.
 */
export function Tabs<T extends string>({
  tabs, value, onChange, ariaLabel, idPrefix, className, size = 'md',
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
  idPrefix?: string;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const auto = useId();
  const prefix = idPrefix ?? auto;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const enabled = tabs.map((tab, i) => ({ tab, i })).filter((x) => !x.tab.disabled);
  const selectedIndex = tabs.findIndex((tab) => tab.id === value);

  // Есть ли скрытые вкладки слева/справа: прокрутка, ресайз, смена подписей (язык)
  const measure = () => {
    const el = listRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const start = max > 1 && el.scrollLeft > 1;
    const end = max > 1 && el.scrollLeft < max - 1;
    setEdges((p) => (p.start === start && p.end === end ? p : { start, end }));
  };
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
    // measure читает только ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(measure);

  // Выбранная вкладка — в видимую область (с запасом на маску); вертикальную прокрутку страницы не трогаем
  useEffect(() => {
    const list = listRef.current;
    const el = refs.current[selectedIndex];
    if (!list || !el || list.scrollWidth <= list.clientWidth) return;
    const lr = list.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const pad = 24;
    if (er.left < lr.left + pad) list.scrollLeft -= lr.left + pad - er.left;
    else if (er.right > lr.right - pad) list.scrollLeft += er.right - (lr.right - pad);
  }, [selectedIndex]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const pos = enabled.findIndex((x) => x.i === index);
    let target: number | null = null;
    if (e.key === 'ArrowRight') target = enabled[(pos + 1) % enabled.length]?.i ?? null;
    else if (e.key === 'ArrowLeft') target = enabled[(pos - 1 + enabled.length) % enabled.length]?.i ?? null;
    else if (e.key === 'Home') target = enabled[0]?.i ?? null;
    else if (e.key === 'End') target = enabled[enabled.length - 1]?.i ?? null;
    if (target === null) return;
    e.preventDefault();
    const tab = tabs[target];
    if (!tab) return;
    onChange(tab.id);
    refs.current[target]?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      className={clsx('flex gap-1 overflow-x-auto border-b border-border', className)}
      style={edgeMask(edges.start, edges.end)}
    >
      {tabs.map((tab, i) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${prefix}-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`${prefix}-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={clsx(
              '-mb-px inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              // md: на мобильных px-2 — четыре вкладки лекции (ru) помещаются в 358px без прокрутки
              size === 'sm' ? 'h-9 px-2.5 text-sm' : 'h-11 px-2 text-body sm:px-3',
              selected ? 'border-brand text-fg' : 'border-transparent text-fg-2 hover:text-fg',
            )}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge !== null && (
              <span className={clsx('rounded-full px-1.5 font-mono text-xs leading-5 tabular-nums', selected ? 'bg-brand-soft text-brand' : 'bg-border/60 text-fg-2')}>
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idPrefix, id, children, className }: { idPrefix: string; id: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${id}`} aria-labelledby={`${idPrefix}-tab-${id}`} tabIndex={0} className={clsx('focus-visible:outline-offset-4', className)}>
      {children}
    </div>
  );
}

/* ── SegmentedControl (aria-pressed) ─────────────────────── */
export interface SegmentOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Полное имя для скринридера (например, «Қазақша» для «Қаз») */
  ariaLabel?: string;
  /** lang атрибут подписи (родное письмо) */
  lang?: string;
}

/**
 * Сегментированный переключатель. Активный сегмент — ink (в тёмной теме — светлый fg),
 * tone='brand' — для выбора внутри контента.
 */
export function SegmentedControl<T extends string>({
  options, value, onChange, ariaLabel, size = 'md', tone = 'ink', fullWidth, className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
  tone?: 'ink' | 'brand';
  fullWidth?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={clsx('inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5', fullWidth && 'flex w-full', className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            aria-label={o.ariaLabel}
            lang={o.lang}
            onClick={() => onChange(o.value)}
            className={clsx(
              'inline-flex items-center justify-center whitespace-nowrap rounded-full font-semibold transition-colors',
              size === 'sm' ? 'h-8 px-2.5 text-small' : 'h-9 px-3 text-sm',
              fullWidth && 'flex-1',
              active
                ? tone === 'ink'
                  ? 'bg-ink text-white dark:bg-fg dark:text-ink'
                  : 'bg-brand-fill text-white'
                : 'text-fg-2 hover:text-fg',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Breadcrumb ─────────────────────────────────────────── */
export interface Crumb {
  label: string;
  to?: string;
}

/**
 * Хлебные крошки: nav[aria-label] + ol; последний элемент — aria-current="page".
 * Уже sm сворачиваются в «‹ последний родитель».
 */
export function Breadcrumb({ items, className }: { items: Crumb[]; className?: string }) {
  const { t } = useTranslation();
  if (!items.length) return null;
  const parents = items.slice(0, -1).filter((i) => i.to);
  const back = parents[parents.length - 1];
  return (
    <nav aria-label={t('ui.breadcrumb')} className={clsx('min-w-0', className)}>
      {back?.to && (
        <Link
          to={back.to}
          className="inline-flex max-w-full items-center gap-1 rounded-md py-1 text-sm font-medium text-fg-2 transition-colors hover:text-fg sm:hidden"
          aria-label={t('ui.backTo', { label: back.label })}
        >
          <Icon name="chevron-left" size={16} />
          <span className="truncate">{back.label}</span>
        </Link>
      )}
      <ol className="hidden min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-sm text-fg-2 sm:flex">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${item.label}`} className="flex min-w-0 items-center gap-1">
              {i > 0 && <Icon name="chevron-right" size={14} className="text-muted/70" />}
              {last || !item.to ? (
                <span aria-current={last ? 'page' : undefined} className={clsx('truncate', last ? 'max-w-[28rem] font-medium text-fg' : 'max-w-[16rem]')}>
                  {item.label}
                </span>
              ) : (
                <Link to={item.to} className="max-w-[16rem] truncate rounded-md transition-colors hover:text-fg">
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
