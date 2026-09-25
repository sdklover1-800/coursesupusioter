import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { ApiError } from '../../lib/api';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import {
  EXPORT_FILENAMES, EXPORT_TYPES, courseTitle, downloadExport, useAdminCohorts, useCourseOptions,
  type ExportFilter, type ExportType,
} from '../../lib/staffAdmin';
import { Badge, Button, Card, Field, Icon, Input, Select, toast } from '../../components/ui';
import { PageHeader } from '../../components/page';
import { Notice, Th } from '../../components/staff/admin/bits';
import { EXPORT_DICTIONARY } from '../../components/staff/admin/exportDictionary';

const EMPTY: ExportFilter = { courseId: '', cohortId: '', from: '', to: '' };

/**
 * Экспорт исследовательских данных в CSV (FR-R.4, FE5 §8). ADMIN.
 * Фильтры (курс, когорта, период) уходят query-параметрами во все файлы; у каждого файла —
 * словарь данных (столбцы в порядке CSV, новые столбцы 2.0 отмечены). Журнал аудита — на /admin/audit.
 */
export function ExportPage() {
  const { t, i18n } = useTranslation();
  useDocumentTitle(t('admin.export'));
  const [filter, setFilter] = useState<ExportFilter>(EMPTY);
  const courses = useCourseOptions();
  const cohorts = useAdminCohorts();

  const rangeInvalid = !!filter.from && !!filter.to && filter.from > filter.to;
  const active = Object.values(filter).some(Boolean);

  const exportM = useMutation({
    mutationFn: (type: ExportType) => downloadExport(type, filter),
    onSuccess: (_d, type) => toast(t('admin.exportPage.downloaded', { file: EXPORT_FILENAMES[type] }), 'teal'),
    onError: (err) => toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger'),
  });

  return (
    <>
      <PageHeader eyebrow={t('admin.eyebrow')} title={t('admin.export')} subtitle={t('admin.exportPage.subtitle')} />

      <Notice tone="brand" icon="lock" className="mb-6">
        {t('admin.exportPage.privacy')}
      </Notice>

      {/* Фильтры — для всех файлов */}
      <Card className="mb-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-fg">{t('admin.exportPage.filtersTitle')}</h2>
            <p className="mt-0.5 text-body text-fg-2">{t('admin.exportPage.filtersHint')}</p>
          </div>
          {active && (
            <Button variant="ghost" size="sm" onClick={() => setFilter(EMPTY)}>
              {t('admin.resetFilters')}
            </Button>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label={t('admin.exportPage.course')}>
            <Select value={filter.courseId} onChange={(e) => setFilter({ ...filter, courseId: e.target.value })}>
              <option value="">{t('admin.exportPage.allCourses')}</option>
              {(courses.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {courseTitle(c, i18n.language)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('admin.cohort')}>
            <Select value={filter.cohortId} onChange={(e) => setFilter({ ...filter, cohortId: e.target.value })}>
              <option value="">{t('admin.exportPage.allCohorts')}</option>
              {(cohorts.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('admin.from')}>
            <Input type="date" value={filter.from} max={filter.to || undefined} onChange={(e) => setFilter({ ...filter, from: e.target.value })} />
          </Field>
          <Field label={t('admin.to')} hint={t('admin.exportPage.toHint')} error={rangeInvalid ? t('admin.rangeInvalid') : undefined}>
            <Input type="date" value={filter.to} min={filter.from || undefined} onChange={(e) => setFilter({ ...filter, to: e.target.value })} />
          </Field>
        </div>
      </Card>

      {/* Файлы выгрузки со словарём данных */}
      <ul className="space-y-4">
        {EXPORT_TYPES.map((type) => {
          const spec = EXPORT_DICTIONARY[type];
          const busy = exportM.isPending && exportM.variables === type;
          return (
            <li key={type} className="card overflow-hidden">
              <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:p-6">
                <span className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand sm:grid">
                  <Icon name="file-text" size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h2 className="text-title text-fg">{t(`admin.exportPage.types.${type}.title`)}</h2>
                    {spec.newFile && <Badge tone="brand">{t('admin.exportPage.newFile')}</Badge>}
                  </div>
                  <p className="mt-1 max-w-[62ch] text-meta text-fg-2">
                    {t('admin.exportPage.rowIs', { row: t(`admin.exportPage.types.${type}.row`) })}
                  </p>
                  <code className="mt-1.5 inline-block font-mono text-sm text-fg-2">{EXPORT_FILENAMES[type]}</code>
                </div>
                <Button
                  variant="secondary"
                  className="shrink-0 sm:self-center"
                  loading={busy}
                  disabled={exportM.isPending || rangeInvalid}
                  onClick={() => exportM.mutate(type)}
                >
                  {!busy && <Icon name="download" size={18} />}
                  {t('admin.exportPage.download')}
                </Button>
              </div>

              {/* Словарь данных — нативный аккордеон */}
              <details className="group border-t border-border">
                <summary className="flex min-h-[3rem] cursor-pointer list-none items-center gap-2 px-5 py-3 text-body font-semibold text-fg hover:bg-brand-soft/30 sm:px-6 [&::-webkit-details-marker]:hidden">
                  <Icon name="chevron-down" size={18} className="text-fg-2 transition-transform group-open:rotate-180" />
                  {t('admin.exportPage.dictionary')}
                  <span className="font-normal text-fg-2">· {t('admin.exportPage.columns', { count: spec.columns.length })}</span>
                </summary>
                <div className="px-5 pb-5 sm:px-6">
                  {spec.newFrom !== undefined && <p className="mb-3 max-w-[70ch] text-body text-fg-2">{t('admin.exportPage.appended')}</p>}
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full min-w-[560px] text-body">
                      <thead className="border-b border-border bg-surface-2/60">
                        <tr>
                          <Th className="w-12">#</Th>
                          <Th className="w-[20rem]">{t('admin.exportPage.colName')}</Th>
                          <Th>{t('admin.exportPage.colMeaning')}</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {spec.columns.map(([col, key], i) => {
                          const isNew = spec.newFrom !== undefined && i >= spec.newFrom;
                          return (
                            <tr key={col} className={clsx('align-top', isNew && 'bg-brand-soft/25')}>
                              <td className="num px-4 py-2.5 text-fg-2">{i + 1}</td>
                              <td className="px-4 py-2.5">
                                <code className="break-all font-mono text-sm font-medium text-fg">{col}</code>
                                {isNew && (
                                  <Badge tone="brand" className="ml-2 align-middle">
                                    {t('admin.exportPage.newCol')}
                                  </Badge>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-fg-2">{t(`admin.exportPage.cols.${key}`)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </>
  );
}
