import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Card, Skeleton } from './ui';
import { Icon } from './icons';

/** Заголовок страницы с опциональным действием справа (h1 — Geologica display-xl). */
export function PageHeader({ title, subtitle, eyebrow, action }: { title: string; subtitle?: string; eyebrow?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="font-display text-display-xl">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-body text-fg-2">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Карточка метрики для дашбордов (FR-10). */
export function StatCard({ label, value, hint, tone = 'brand' }: { label: string; value: ReactNode; hint?: string; tone?: 'brand' | 'spark' | 'teal' | 'danger' }) {
  const bar = { brand: 'bg-brand', spark: 'bg-spark', teal: 'bg-teal', danger: 'bg-danger' }[tone];
  return (
    <Card className="relative overflow-hidden !p-5">
      <div className={clsx('absolute left-0 top-0 h-full w-1', bar)} />
      {/* Подпись из слов — sentence case, fg-2 (§12: без капса и разрядки) */}
      <div className="text-label text-fg-2">{label}</div>
      <div className="mt-2 font-display text-3xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-small text-fg-2">{hint}</div>}
    </Card>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft font-display text-xl text-brand" aria-hidden>?</span>
      <div className="font-semibold">{title}</div>
      {hint && <div className="max-w-sm text-body text-fg-2">{hint}</div>}
      {action}
    </Card>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-danger/30 text-center" >
      <div role="alert" className="inline-flex items-center gap-2 text-danger-ink">
        <Icon name="alert" size={18} />
        {message}
      </div>
    </Card>
  );
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}
    </div>
  );
}

/** Горизонтальная полоса-бар для рубрики/прогресса (0..1). */
export function MeterBar({ value, tone = 'brand', label }: { value: number; tone?: 'brand' | 'spark' | 'teal' | 'danger' | 'ink'; label?: string }) {
  const bar = { brand: 'bg-brand', spark: 'bg-spark', teal: 'bg-teal', danger: 'bg-danger', ink: 'bg-ink dark:bg-fg' }[tone];
  const pct = Math.min(100, Math.max(0, value * 100));
  return (
    <div>
      {label && <div className="mb-1 flex justify-between gap-3 text-small text-fg-2"><span>{label}</span><span className="font-mono tabular-nums">{Math.round(value * 100)}%</span></div>}
      <div className="h-2 overflow-hidden rounded-full bg-border/60" aria-hidden={label ? true : undefined}>
        <div className={clsx('h-full rounded-full transition-all', bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
