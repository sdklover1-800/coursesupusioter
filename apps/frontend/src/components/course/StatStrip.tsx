import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface StatCell {
  key: string;
  /** Значение: цифры Geologica display-md (или глиф) */
  value: ReactNode;
  /** Подпись из слов — Onest, sentence case, fg-2 (§12) */
  label: string;
}

/**
 * «≈» — в Onest: в Geologica нет U+2248, и глиф брался бы из системного шрифта
 * (две гарнитуры в одной цифре героя, design_direction §3).
 */
function approxInSans(value: ReactNode): ReactNode {
  if (typeof value !== 'string' || !value.includes('≈')) return value;
  return value.split('≈').flatMap((part, i) => (i === 0 ? [part] : [<span key={i} className="font-sans">≈</span>, part]));
}

/**
 * Полоса ключевых цифр курса (Coursera stat strip): 2×2 на мобильных, в ряд от sm.
 * Ячейки без данных страница просто не передаёт (null-длительность скрыта).
 */
export function StatStrip({ cells, className, tone = 'light' }: { cells: StatCell[]; className?: string; tone?: 'light' | 'dark' }) {
  if (!cells.length) return null;
  return (
    <dl
      className={clsx(
        'grid grid-cols-2 gap-px overflow-hidden rounded-xl border',
        cells.length >= 4 ? 'sm:grid-cols-4' : cells.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2',
        tone === 'dark' ? 'border-white/10 bg-white/10' : 'border-border bg-border',
        className,
      )}
    >
      {cells.map((c) => (
        <div key={c.key} className={clsx('flex min-w-0 flex-col gap-1 px-4 py-3 odd:last:col-span-2 sm:odd:last:col-span-1', tone === 'dark' ? 'bg-[rgb(22,24,43)]' : 'bg-card')}>
          {/* Для скринридера подпись идёт первой, визуально — значение сверху */}
          <dt className="order-2 text-label text-fg-2">{c.label}</dt>
          <dd className="order-1 font-display text-display-md tabular-nums text-fg">{approxInSans(c.value)}</dd>
        </div>
      ))}
    </dl>
  );
}
