import { clsx } from 'clsx';
import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../icons';

/**
 * Поиск по конспекту (screen_specs «Transcript», YouTube transcript search):
 * счётчик «3 из 12», ↑/↓ и Enter / Shift+Enter — между совпадениями, Esc — очистить.
 * Совпадения подсвечивает TranscriptView: <mark> через разбиение текста, без вставки HTML.
 */
export function TranscriptSearch({
  query, onQueryChange, total, current, onPrev, onNext, inputId, extra, className,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  total: number;
  /** 0-based индекс текущего совпадения */
  current: number;
  onPrev: () => void;
  onNext: () => void;
  inputId?: string;
  /** Правый слот: таймкод раздела совпадения, «Следить за видео» */
  extra?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const active = query.trim().length >= 2;

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    } else if (e.key === 'Escape' && query) {
      e.preventDefault();
      e.stopPropagation();
      onQueryChange('');
    }
  }

  return (
    <div role="search" className={clsx('flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
      <div className="relative min-w-0 flex-1 basis-40">
        <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-2" />
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('lecture.search.placeholder')}
          aria-label={t('lecture.search.label')}
          autoComplete="off"
          spellCheck={false}
          className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-10 text-body text-fg placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label={t('lecture.search.clear')}
            className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-fg-2 hover:bg-brand-soft hover:text-fg"
          >
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
      {active && (
        <div className="flex shrink-0 items-center gap-1">
          <span className="min-w-[3.5rem] text-center text-sm text-fg-2" aria-live="polite">
            {total > 0 ? <NumText text={t('lecture.search.count', { current: current + 1, total })} /> : t('lecture.search.none')}
          </span>
          <button
            type="button"
            onClick={onPrev}
            disabled={total === 0}
            aria-label={t('lecture.search.prev')}
            className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-card text-fg transition-colors hover:bg-brand-soft disabled:opacity-40"
          >
            <Icon name="chevron-up" size={18} />
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={total === 0}
            aria-label={t('lecture.search.next')}
            className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-card text-fg transition-colors hover:bg-brand-soft disabled:opacity-40"
          >
            <Icon name="chevron-down" size={18} />
          </button>
        </div>
      )}
      {extra}
    </div>
  );
}

/** Числа в строке — моноширинные (.num), слова — Onest (§12 «читаемость»): «3 из 12». */
export function NumText({ text }: { text: string }) {
  const parts = text.split(/(\d+(?:[:/.]\d+)*)/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="num">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}

/** Переключатель «Следить за видео» (role=switch). */
export function FollowToggle({ on, onChange, className }: { on: boolean; onChange: (v: boolean) => void; className?: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={clsx('inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-2 text-sm font-medium text-fg-2 transition-colors hover:text-fg', className)}
    >
      <span className={clsx('relative inline-block h-5 w-9 rounded-full transition-colors', on ? 'bg-brand-fill' : 'bg-border-strong')} aria-hidden>
        <span className={clsx('absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', on ? 'translate-x-[1.125rem]' : 'translate-x-0.5')} />
      </span>
      {t('lecture.follow')}
    </button>
  );
}
