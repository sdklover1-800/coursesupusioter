import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { formatPercent } from '../../lib/format';
import { romanNumeral, type MatrixCellState, type MatrixColumn, type MatrixResponse } from '../../lib/staff';
import { StatusIcon } from '../ui';

/** Столбцы, сгруппированные по модулю: «I: 1 2 3 ◆ | II: 4 5 6 7 ◆ | … | V: 14 15 ?». */
function groupColumns(columns: MatrixColumn[]): { module: number; cols: { col: MatrixColumn; index: number }[] }[] {
  const out: { module: number; cols: { col: MatrixColumn; index: number }[] }[] = [];
  columns.forEach((col, index) => {
    const last = out[out.length - 1];
    if (last && last.module === col.moduleOrderIndex) last.cols.push({ col, index });
    else out.push({ module: col.moduleOrderIndex, cols: [{ col, index }] });
  });
  return out;
}

/** ◆ — тест модуля (оценивание), ? — итоговый практикум. */
function ColumnGlyph({ col }: { col: MatrixColumn }) {
  if (col.kind === 'LECTURE') return <span className="num text-small">{col.label}</span>;
  if (col.kind === 'MODULE_QUIZ') {
    return (
      <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden className="mx-auto">
        <path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <span className="mx-auto grid h-5 w-5 place-items-center rounded-full bg-spark font-display text-small font-bold leading-none text-ink" aria-hidden>
      ?
    </span>
  );
}

const STATE_FOR: Record<MatrixCellState, 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'PASSED' | 'FAILED'> = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
  PASSED: 'PASSED',
  FAILED: 'FAILED',
};

/**
 * Матрица «студенты × элементы курса» (FE5 §5, Moodle Activity completion + Grader report):
 * липкий столбец студента, сгруппированные заголовки, ячейки-иконки (у теста — зачётный %),
 * итоговая строка средних; горизонтальная прокрутка — только внутри своего контейнера.
 */
export function CohortMatrix({ data }: { data: MatrixResponse }) {
  const { t } = useTranslation();
  const groups = groupColumns(data.columns);
  const avgByKey = new Map(data.averages.map((a) => [a.key, a]));
  const stickyCell = 'sticky left-0 z-10 border-r border-border bg-card';

  return (
    <div>
      <div className="relative overflow-x-auto rounded-xl border border-border" role="region" aria-label={t('dashboard.matrix.title')} tabIndex={0}>
        <table className="w-max min-w-full border-separate border-spacing-0 text-small">
          <thead>
            <tr>
              <th rowSpan={2} scope="col" className={clsx(stickyCell, 'min-w-[11rem] max-w-[14rem] border-b px-3 py-2 text-left align-bottom font-semibold text-fg-2')}>
                {t('dashboard.student')}
              </th>
              {groups.map((g) => (
                <th
                  key={g.module}
                  colSpan={g.cols.length}
                  scope="colgroup"
                  className="border-b border-l border-border bg-surface-2 px-2 py-1.5 text-center font-display text-small font-semibold text-fg"
                >
                  {romanNumeral(g.module)}
                </th>
              ))}
            </tr>
            <tr>
              {groups.map((g) =>
                g.cols.map(({ col }, i) => (
                  <th
                    key={col.key}
                    scope="col"
                    title={col.title}
                    className={clsx('border-b border-border px-1 py-1.5 text-center font-medium text-fg-2', i === 0 && 'border-l', col.kind === 'LECTURE' ? 'min-w-[2.25rem]' : 'min-w-[3.75rem] text-fg')}
                  >
                    <ColumnGlyph col={col} />
                    <span className="sr-only">{col.title}</span>
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.enrollmentId} className="group">
                <th scope="row" className={clsx(stickyCell, 'max-w-[14rem] border-b px-3 py-1.5 text-left font-normal group-hover:bg-brand-soft/40')}>
                  <span className="block truncate text-body font-medium text-fg" title={r.name}>{r.name}</span>
                  {r.cohort && <span className="block truncate text-small text-fg-2">{r.cohort.name}</span>}
                </th>
                {groups.map((g) =>
                  g.cols.map(({ col, index }, i) => {
                    const cell = r.cells[index];
                    const state = cell ? STATE_FOR[cell.state] : 'NOT_STARTED';
                    return (
                      <td key={col.key} className={clsx('border-b border-border px-1 py-1.5 text-center group-hover:bg-brand-soft/20', i === 0 && 'border-l')}>
                        <span className="inline-flex items-center justify-center gap-1">
                          <StatusIcon state={state} size={16} />
                          {col.kind === 'MODULE_QUIZ' && cell?.score !== undefined && (
                            <span className={clsx('num text-small', state === 'PASSED' ? 'text-teal-ink' : state === 'FAILED' ? 'text-danger-ink' : 'text-fg')}>
                              {formatPercent(cell.score)}
                            </span>
                          )}
                        </span>
                      </td>
                    );
                  }),
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className={clsx(stickyCell, 'bg-surface-2 px-3 py-2 text-left font-semibold text-fg')}>
                {t('dashboard.matrix.average')}
                <span className="block text-small font-normal text-fg-2">{t('dashboard.matrix.averageHint')}</span>
              </th>
              {groups.map((g) =>
                g.cols.map(({ col }, i) => {
                  const a = avgByKey.get(col.key);
                  return (
                    <td
                      key={col.key}
                      title={a ? `n = ${a.n}` : undefined}
                      className={clsx('bg-surface-2 px-1 py-2 text-center', i === 0 && 'border-l border-border')}
                    >
                      <span className="num text-small text-fg">{a?.value === null || a?.value === undefined ? '—' : formatPercent(a.value)}</span>
                    </td>
                  );
                }),
              )}
            </tr>
          </tfoot>
        </table>
      </div>
      <MatrixLegend />
    </div>
  );
}

export function MatrixLegend() {
  const { t } = useTranslation();
  const items: { state: 'DONE' | 'IN_PROGRESS' | 'NOT_STARTED' | 'PASSED' | 'FAILED'; label: string }[] = [
    { state: 'DONE', label: t('dashboard.matrix.legendDone') },
    { state: 'IN_PROGRESS', label: t('dashboard.matrix.legendInProgress') },
    { state: 'NOT_STARTED', label: t('dashboard.matrix.legendNotStarted') },
    { state: 'PASSED', label: t('dashboard.matrix.legendPassed') },
    { state: 'FAILED', label: t('dashboard.matrix.legendFailed') },
  ];
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-small text-fg-2">
      {items.map((it) => (
        <li key={it.state} className="inline-flex items-center gap-1.5">
          <StatusIcon state={it.state} size={16} label={it.label} />
          <span aria-hidden>{it.label}</span>
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <svg width="11" height="11" viewBox="0 0 10 10" aria-hidden><path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" fill="currentColor" /></svg>
        {t('dashboard.matrix.legendQuiz')}
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="grid h-4 w-4 place-items-center rounded-full bg-spark font-display text-small font-bold leading-none text-ink" aria-hidden>?</span>
        {t('dashboard.matrix.legendPractical')}
      </li>
    </ul>
  );
}

/** Строки матрицы для CSV (скачивание в браузере). */
export function matrixCsvRows(data: MatrixResponse, t: (k: string) => string): (string | number | null)[][] {
  const header = [t('dashboard.student'), t('dashboard.matrix.cohort'), ...data.columns.map((c) => `${romanNumeral(c.moduleOrderIndex)}·${c.kind === 'LECTURE' ? c.label : c.kind === 'MODULE_QUIZ' ? 'Q' : 'P'} ${c.title}`)];
  const rows = data.rows.map((r) => [
    r.name,
    r.cohort?.name ?? '',
    ...r.cells.map((c) => (c.score !== undefined ? `${c.state} ${Math.round(c.score * 100)}%` : c.state)),
  ]);
  const avg = [t('dashboard.matrix.average'), '', ...data.columns.map((c) => {
    const a = data.averages.find((x) => x.key === c.key);
    return a?.value === null || a?.value === undefined ? '' : `${Math.round(a.value * 100)}% (n=${a.n})`;
  })];
  return [header, ...rows, avg];
}
