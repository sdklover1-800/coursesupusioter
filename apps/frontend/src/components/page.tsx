import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Card, Skeleton } from './ui';

/** Заголовок страницы с опциональным действием справа. */
export function PageHeader({ title, subtitle, eyebrow, action }: { title: string; subtitle?: string; eyebrow?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="mb-1 font-mono text-xs font-semibold uppercase tracking-wider text-brand">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-muted">{subtitle}</p>}
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
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 font-display text-3xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft font-display text-xl text-brand">?</span>
      <div className="font-semibold">{title}</div>
      {hint && <div className="max-w-sm text-sm text-muted">{hint}</div>}
      {action}
    </Card>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-danger/30 text-center">
      <div className="text-danger">⚠ {message}</div>
    </Card>
  );
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}
    </div>
  );
}

/** Горизонтальная полоса-бар для рубрики/прогресса (0..1). */
export function MeterBar({ value, tone = 'brand', label }: { value: number; tone?: 'brand' | 'spark' | 'teal'; label?: string }) {
  const bar = { brand: 'bg-brand', spark: 'bg-spark', teal: 'bg-teal' }[tone];
  return (
    <div>
      {label && <div className="mb-1 flex justify-between text-xs text-muted"><span>{label}</span><span className="font-mono tabular-nums">{Math.round(value * 100)}%</span></div>}
      <div className="h-2 overflow-hidden rounded-full bg-border/60">
        <div className={clsx('h-full rounded-full transition-all', bar)} style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
      </div>
    </div>
  );
}
