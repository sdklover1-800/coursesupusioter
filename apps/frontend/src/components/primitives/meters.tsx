import { clsx } from 'clsx';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { RubricCriterion } from '@edu/shared';
import { RUBRIC_ORDER, rubricTone, toneClasses } from '../../lib/tones';

/* ── ProgressRing ───────────────────────────────────────── */
const RING_STROKE: Record<'brand' | 'teal' | 'spark', string> = {
  brand: 'rgb(var(--brand))',
  teal: 'rgb(var(--teal-ink))',
  spark: 'rgb(var(--spark))',
};

/**
 * Кольцо прогресса (0..1). В центре — процент (showValue) или свои children.
 * Доступное имя — label или «Прогресс: N%». animate — заполнение 600 мс (ring-fill).
 */
export function ProgressRing({
  value, size = 48, stroke = 4, label, tone = 'brand', showValue, animate = true, children, className,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  tone?: 'brand' | 'teal' | 'spark';
  showValue?: boolean;
  animate?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const pct = Math.round(v * 100);
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - v);
  const center = children ?? ((showValue ?? size >= 44) ? <span className="font-mono text-xs font-semibold tabular-nums text-fg">{pct}%</span> : null);
  return (
    <span
      className={clsx('relative inline-grid shrink-0 place-items-center', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? t('ui.progressValue', { value: pct })}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} style={{ stroke: 'rgb(var(--border))' }} />
        {v > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            className={animate ? 'animate-ring-fill' : undefined}
            style={{ stroke: RING_STROKE[tone], '--ring-circ': `${circ}` } as CSSProperties}
          />
        )}
      </svg>
      {center && <span className="absolute inset-0 grid place-items-center">{center}</span>}
    </span>
  );
}

/* ── RubricBars — 4 измерения рубрики (0..max) ───────────── */
type RubricScores =
  | Partial<Record<RubricCriterion, number | null>>
  | { key: RubricCriterion; score: number | null; line?: string | null }[];

/**
 * Полосы рубрики с фиксированными цветами измерений (tones.rubric) и «x.x / 3» моно.
 * scores — объект {criterion: score} или массив SessionEvaluation.criteria; lines — пояснения.
 */
export function RubricBars({
  scores, max = 3, lines, className,
}: {
  scores: RubricScores;
  max?: number;
  lines?: Partial<Record<RubricCriterion, string | null>>;
  className?: string;
}) {
  const { t } = useTranslation();
  const map: Partial<Record<RubricCriterion, { score: number | null; line?: string | null }>> = {};
  if (Array.isArray(scores)) for (const s of scores) map[s.key] = { score: s.score, line: s.line };
  else for (const k of RUBRIC_ORDER) if (k in scores) map[k] = { score: scores[k] ?? null };
  const rows = RUBRIC_ORDER.filter((k) => map[k] !== undefined);
  return (
    <ul className={clsx('space-y-3', className)}>
      {rows.map((k) => {
        const s = map[k]!.score;
        const line = lines?.[k] ?? map[k]!.line;
        const w = s === null || s === undefined ? 0 : Math.min(1, Math.max(0, s / max));
        return (
          <li key={k}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-fg">{t(`ui.rubric.${k}`)}</span>
              <span className="num font-semibold text-fg">
                {s === null || s === undefined ? '—' : s.toFixed(1)} <span className="text-fg-2">/ {max}</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-border/60" aria-hidden>
              <div className={clsx('h-full rounded-full transition-all', toneClasses[rubricTone[k]].fill)} style={{ width: `${w * 100}%` }} />
            </div>
            {line && <p className="mt-1 text-sm text-fg-2">{line}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/* ── InquiryMeter v2 — бюджет ответов тьютора (SIGNATURE, FR-6.7) ── */
type MeterLevel = 'normal' | 'low' | 'last' | 'none';
const levelOf = (remaining: number): MeterLevel => (remaining <= 0 ? 'none' : remaining === 1 ? 'last' : remaining <= 3 ? 'low' : 'normal');

/**
 * Оставшиеся ответы тьютора: сегменты-пипы (при max > 30 — полоса). Оставшиеся — амбер,
 * использованные — полые. «Осталось 7 из 24». ≤ 3 — рамка spark-ink и предупреждение,
 * 1 — «последний». role=meter; скринридер слышит только смену порога (не каждый ответ).
 * Токены не показываем (непрозрачны и зависят от языка).
 */
export function InquiryMeter({
  used, max, compact, className,
}: {
  used: number;
  max: number;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const total = Math.max(0, max);
  const remaining = Math.max(0, total - Math.max(0, used));
  const level = levelOf(remaining);
  const text = t('ui.meter.remaining', { count: remaining, max: total });
  const warning = level === 'low' ? t('ui.meter.low') : level === 'last' ? t('ui.meter.last') : level === 'none' ? t('ui.meter.none') : null;

  // Объявляем только смену порога (normal → low → last → none), не каждое изменение
  const prevLevel = useRef<MeterLevel>(level);
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (prevLevel.current !== level) {
      prevLevel.current = level;
      setAnnounce(warning ?? '');
    }
  }, [level, warning]);

  const meterProps = {
    role: 'meter' as const,
    'aria-valuemin': 0,
    'aria-valuemax': total,
    'aria-valuenow': remaining,
    'aria-valuetext': text,
    'aria-label': t('ui.meter.label'),
  };
  const live = (
    <span className="sr-only" aria-live="polite">
      {announce}
    </span>
  );

  if (compact) {
    return (
      <span className={clsx('inline-flex items-center gap-2', className)} {...meterProps}>
        <span className={clsx('h-1.5 w-12 overflow-hidden rounded-full bg-border/70', level !== 'normal' && 'ring-1 ring-spark-ink')} aria-hidden>
          <span className="block h-full rounded-full bg-spark" style={{ width: `${total ? (remaining / total) * 100 : 0}%` }} />
        </span>
        <span className={clsx('num font-semibold', level === 'normal' ? 'text-fg' : 'text-spark-ink')}>
          {remaining}/{total}
        </span>
        {live}
      </span>
    );
  }

  return (
    <div className={clsx('rounded-xl', level !== 'normal' && 'border border-spark-ink/70 px-3 py-2', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" {...meterProps}>
        {total > 30 ? (
          <span className="h-2 min-w-[8rem] flex-1 overflow-hidden rounded-full bg-border/70" aria-hidden>
            <span className="block h-full rounded-full bg-spark" style={{ width: `${total ? (remaining / total) * 100 : 0}%` }} />
          </span>
        ) : (
          <span className="flex flex-wrap gap-1" aria-hidden>
            {Array.from({ length: total }, (_, i) => {
              const filled = i < remaining;
              return (
                <span
                  key={i}
                  className={clsx(
                    'h-2.5 w-2.5 rounded-full transition-colors',
                    filled ? 'animate-pip-in bg-spark' : 'border border-border-strong bg-transparent',
                  )}
                />
              );
            })}
          </span>
        )}
        {/* Слова + числа: Onest (моно — только для чистых чисел, §12), табличные цифры */}
        <span className="whitespace-nowrap text-label font-semibold tabular-nums text-fg">{text}</span>
      </div>
      {warning && <p className="mt-1.5 text-small font-medium text-spark-ink">{warning}</p>}
      {live}
    </div>
  );
}
