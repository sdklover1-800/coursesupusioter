import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { formatPercent } from '../../lib/format';
import { optionLetter, type ItemStatRow } from '../../lib/staff';
import { Icon } from '../icons';
import { SampleSize } from './primitives';

/** Цвета дистракторов — нейтральные ступени; ключ — teal (у сотрудника разбор после сбора данных). */
const DISTRACTOR_FILLS = ['bg-brand/70', 'bg-border-strong', 'bg-muted/70', 'bg-brand/35', 'bg-ink/40 dark:bg-fg/40', 'bg-spark/60'];

/**
 * Трудность вопроса: p-value (доля верных среди показов; пропуск = неверно).
 * Метка словами — не только число (цвет не единственный носитель смысла).
 */
export function pValueBand(p: number | null): 'none' | 'hard' | 'ok' | 'easy' {
  if (p === null) return 'none';
  if (p < 0.3) return 'hard';
  if (p > 0.9) return 'easy';
  return 'ok';
}

export function PValue({ p, className }: { p: number | null; className?: string }) {
  const { t } = useTranslation();
  const band = pValueBand(p);
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap', className)} title={t('manager.item.pHint')}>
      <span className="num text-small text-fg">p = {p === null ? '—' : p.toFixed(2)}</span>
      {band === 'hard' && <span className="text-small font-medium text-danger-ink">{t('manager.item.hard')}</span>}
      {band === 'easy' && <span className="text-small font-medium text-fg-2">{t('manager.item.easy')}</span>}
    </span>
  );
}

/** Распределение выборов по вариантам (канонические id) + пропуски. */
export function DistractorBar({ stat, options, correct }: { stat: ItemStatRow; options: string[]; correct: number[] }) {
  const { t } = useTranslation();
  const total = stat.n || 1;
  const segments = [
    ...stat.optionCounts.map((c, i) => ({ key: `o${i}`, count: c, label: optionLetter(i), text: options[i] ?? '', isKey: correct.includes(i), fill: correct.includes(i) ? 'bg-teal' : DISTRACTOR_FILLS[i % DISTRACTOR_FILLS.length]! })),
    ...(stat.unansweredCount > 0 ? [{ key: 'none', count: stat.unansweredCount, label: '—', text: t('manager.item.unanswered'), isKey: false, fill: 'bg-surface-2 bg-inquiry-grid' }] : []),
  ];
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-border/50" aria-hidden>
        {segments.map((s) => (s.count > 0 ? <div key={s.key} className={clsx('h-full', s.fill)} style={{ width: `${(s.count / total) * 100}%` }} /> : null))}
      </div>
      <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {segments.map((s) => (
          <li key={s.key} className="flex min-w-0 items-center gap-2 text-small text-fg-2">
            <span className={clsx('h-2.5 w-2.5 shrink-0 rounded-sm', s.fill)} aria-hidden />
            <span className={clsx('font-semibold', s.isKey ? 'text-teal-ink' : 'text-fg')}>{s.label}</span>
            {s.isKey && <Icon name="check" size={14} className="-ml-1 text-teal-ink" label={t('manager.item.key')} />}
            <span className="min-w-0 flex-1 truncate" title={s.text}>{s.text}</span>
            <span className="num shrink-0 text-small text-fg">
              {s.count} · {formatPercent(s.count / total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Подпанель анализа задания в развёрнутом вопросе (FE5 §2): p-value, распределение, n. */
export function ItemAnalysisPanel({ stat, options, correct }: { stat: ItemStatRow | undefined; options: string[]; correct: number[] }) {
  const { t } = useTranslation();
  return (
    <section className="rounded-xl border border-border bg-surface px-4 py-3" aria-label={t('manager.item.title')}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-fg">{t('manager.item.title')}</h4>
        {stat && (
          <div className="flex flex-wrap items-center gap-3">
            <PValue p={stat.pValue} />
            <SampleSize n={stat.n} unit="answers" />
          </div>
        )}
      </div>
      {!stat || stat.n === 0 ? (
        <p className="text-small text-fg-2">{t('manager.item.noData')}</p>
      ) : (
        <DistractorBar stat={stat} options={options} correct={correct} />
      )}
    </section>
  );
}
