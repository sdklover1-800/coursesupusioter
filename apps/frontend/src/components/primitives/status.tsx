import { clsx } from 'clsx';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ItemState, LearnItemKind } from '@edu/shared';
import { formatDuration } from '../../lib/format';
import { Icon } from '../icons';

const c = (v: string, a?: number) => (a === undefined ? `rgb(var(--${v}))` : `rgb(var(--${v}) / ${a})`);

/* ── StatusIcon (design_direction §7, state glyphs) ─────── */
export type StatusState = ItemState | 'NEXT';

const STATE_TEXT: Record<StatusState, string> = {
  NOT_STARTED: 'text-fg-2',
  IN_PROGRESS: 'text-brand',
  DONE: 'text-fg',
  PASSED: 'text-teal-ink',
  FAILED: 'text-danger-ink',
  LOCKED: 'text-fg-2',
  NEXT: 'text-spark-ink',
};

/**
 * Глиф состояния элемента пути. Всегда с доступной подписью (sr-only), withLabel — видимая.
 * NEXT — кольцо spark-ink (на светлых поверхностях амбер-заливка даёт 1.85:1, A24);
 * маркер «далее» всегда сопровождается видимым текстом «Далее» — withLabel или рядом.
 */
export function StatusIcon({
  state, progress, size = 20, withLabel, label, className,
}: {
  state: StatusState;
  /** 0..1 — доля для IN_PROGRESS */
  progress?: number;
  size?: number;
  /** Показать подпись рядом с глифом */
  withLabel?: boolean;
  /** Своя подпись вместо стандартной */
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const pct = Math.round(Math.min(1, Math.max(0, progress ?? 0.5)) * 100);
  const text = label ?? (state === 'IN_PROGRESS' && progress !== undefined ? `${t('ui.state.IN_PROGRESS')} · ${pct}%` : t(`ui.state.${state}`));
  const r = 9;
  const circ = 2 * Math.PI * r;
  let glyph: ReactNode;
  switch (state) {
    case 'NOT_STARTED':
      glyph = <circle cx="12" cy="12" r={r} fill="none" style={{ stroke: c('muted') }} strokeWidth="1.75" />;
      break;
    case 'IN_PROGRESS':
      glyph = (
        <>
          <circle cx="12" cy="12" r={r} fill="none" style={{ stroke: c('border-strong') }} strokeWidth="2" />
          <circle
            cx="12" cy="12" r={r} fill="none" strokeWidth="2.25" strokeLinecap="round"
            style={{ stroke: c('brand') }}
            strokeDasharray={`${(circ * pct) / 100} ${circ}`}
            transform="rotate(-90 12 12)"
          />
        </>
      );
      break;
    case 'DONE':
      // «Чернильный» диск: в тёмной теме — светлый (fg) с галочкой цвета карточки
      glyph = (
        <>
          <circle cx="12" cy="12" r="10" style={{ fill: c('fg') }} />
          <path d="m7.5 12.2 3 3 6-6.2" fill="none" style={{ stroke: c('card') }} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
      break;
    case 'PASSED':
      glyph = (
        <>
          <circle cx="12" cy="12" r="9.25" style={{ fill: c('teal', 0.14), stroke: c('teal-ink') }} strokeWidth="1.75" />
          <path d="m7.5 12.2 3 3 6-6.2" fill="none" style={{ stroke: c('teal-ink') }} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
      break;
    case 'FAILED':
      glyph = (
        <>
          <circle cx="12" cy="12" r="9.25" fill="none" style={{ stroke: c('danger-ink') }} strokeWidth="1.75" />
          <path d="m8.8 8.8 6.4 6.4M15.2 8.8l-6.4 6.4" fill="none" style={{ stroke: c('danger-ink') }} strokeWidth="2" strokeLinecap="round" />
        </>
      );
      break;
    case 'LOCKED':
      glyph = (
        <g fill="none" style={{ stroke: c('muted') }} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <rect width="14" height="9" x="5" y="11" rx="2" />
          <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
        </g>
      );
      break;
    case 'NEXT':
      glyph = (
        <>
          <circle cx="12" cy="12" r="9" fill="none" style={{ stroke: c('spark-ink') }} strokeWidth="2" />
          <circle cx="12" cy="12" r="3.75" style={{ fill: c('spark') }} />
        </>
      );
      break;
  }
  return (
    <span className={clsx('inline-flex shrink-0 items-center gap-1.5', className)}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
        {glyph}
      </svg>
      {withLabel ? (
        <span className={clsx('text-small font-semibold', STATE_TEXT[state])}>{text}</span>
      ) : (
        <span className="sr-only">{text}</span>
      )}
    </span>
  );
}

/* ── KindIcon — тип элемента пути (design_direction §7) ─── */
const KIND_BOX: Record<LearnItemKind, string> = {
  LECTURE: 'border border-border-strong bg-card text-fg',
  MINI_QUIZ: 'border border-dashed border-brand/60 bg-brand-soft/50 text-brand',
  FINAL_MINI_QUIZ: 'border border-dashed border-brand/60 bg-brand-soft/50 text-brand',
  MODULE_QUIZ: 'border border-ink bg-ink text-white dark:border-fg dark:bg-fg dark:text-ink',
  PRACTICAL: 'border border-spark bg-spark text-ink',
  CERTIFICATE: 'border border-border-strong bg-card text-fg',
};

/**
 * Скруглённый квадрат с глифом типа: лекция ▶, мини-квиз (тренировка) — пунктир,
 * модульный тест ◆ на ink, итоговый практикум — «?» на амбере, сертификат — награда.
 * done — 10px бейдж-галочка в углу (иконка не заменяется, как у Khan); current — кольцо spark-ink.
 * По умолчанию декоративна (подпись даёт строка рядом); label — сделать доступной.
 */
export function KindIcon({
  kind, done, current, size = 24, label, className,
}: {
  kind: LearnItemKind;
  done?: boolean;
  current?: boolean;
  size?: 20 | 24 | number;
  label?: string;
  className?: string;
}) {
  const g = Math.round(size * 0.58);
  let glyph: ReactNode;
  switch (kind) {
    case 'LECTURE':
      glyph = <Icon name="play" size={g - 2} fill="currentColor" strokeWidth={1.5} />;
      break;
    case 'MINI_QUIZ':
    case 'FINAL_MINI_QUIZ':
      glyph = <Icon name="list-check" size={g} strokeWidth={1.75} />;
      break;
    case 'MODULE_QUIZ':
      glyph = (
        <svg width={g - 2} height={g - 2} viewBox="0 0 10 10" aria-hidden>
          <path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" fill="currentColor" />
        </svg>
      );
      break;
    case 'PRACTICAL':
      glyph = (
        <span className="font-display font-bold leading-none" style={{ fontSize: Math.round(size * 0.55) }} aria-hidden>
          ?
        </span>
      );
      break;
    case 'CERTIFICATE':
      glyph = <Icon name="award" size={g} strokeWidth={1.75} />;
      break;
  }
  const style: CSSProperties = { width: size, height: size };
  return (
    <span
      className={clsx(
        'relative inline-grid shrink-0 place-items-center rounded-md',
        KIND_BOX[kind],
        current && 'ring-2 ring-spark-ink ring-offset-2 ring-offset-card',
        className,
      )}
      style={style}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {glyph}
      {done && (
        <svg width="12" height="12" viewBox="0 0 12 12" className="absolute -right-1.5 -top-1.5" aria-hidden>
          <circle cx="6" cy="6" r="5.5" style={{ fill: c('fg'), stroke: c('card') }} strokeWidth="1" />
          <path d="m3.6 6.1 1.6 1.6 3.2-3.3" fill="none" style={{ stroke: c('card') }} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

/* ── TimeChip — таймкод/длительность (моно, tabular-nums) ─ */
export function TimeChip({
  seconds, label, active, onClick, className, title,
}: {
  seconds?: number | null;
  /** Готовая подпись вместо секунд (например, «≈ 1 ч 20 мин») */
  label?: string;
  /** Текущий фрагмент — амбер (единственный маркер «вы здесь») */
  active?: boolean;
  /** Кликабельный чип (перемотка) → <button> */
  onClick?: () => void;
  className?: string;
  title?: string;
}) {
  const { t } = useTranslation();
  const text = label ?? formatDuration(seconds ?? null, 'clock');
  const cls = clsx(
    // Таймкод — число: моно 14/20 (.num, §12); активный — spark/15 (≥ 4.5:1 и на brand-soft, A24)
    'inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-num tabular-nums',
    active ? 'bg-spark/15 text-spark-ink' : 'bg-brand-soft text-brand',
    className,
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-label={t('ui.seekTo', { time: text })}
        aria-current={active ? 'true' : undefined}
        className={clsx(cls, 'transition-colors hover:ring-1 hover:ring-brand/40')}
      >
        {text}
      </button>
    );
  }
  return (
    <span className={cls} title={title}>
      {text}
    </span>
  );
}
