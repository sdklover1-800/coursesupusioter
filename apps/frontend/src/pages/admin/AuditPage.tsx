import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { ApiError } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import {
  AUDIT_ACTIONS, AUDIT_TARGETS, courseTitle, useAdminCohorts, useAuditLog, useCourseOptions, useStaffUsers,
  type AuditEntry, type AuditFilter,
} from '../../lib/staffAdmin';
import { Button, Card, Field, Icon, Input, Select } from '../../components/ui';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '../../components/page';
import { EmailText, RoleBadge, Th } from '../../components/staff/admin/bits';
import { AuditDetail } from '../../components/staff/admin/AuditDetail';

const PARAMS: Record<keyof AuditFilter, string> = { action: 'action', actorId: 'actor', targetType: 'target', from: 'from', to: 'to' };

/**
 * Журнал аудита (/admin/audit, NFR-2.9, FE5 §8). ADMIN.
 * Курсорная пагинация «Показать ещё», фильтры (действие, кто, объект, период) в адресе,
 * переведённые коды действий (admin.actions.*) и объектов, даты — formatDate.
 */
export function AuditPage() {
  const { t, i18n } = useTranslation();
  const { formatDate } = useFormat();
  useDocumentTitle(t('admin.audit'));

  const [params, setParams] = useSearchParams();
  const filter: AuditFilter = {
    action: params.get(PARAMS.action) ?? '',
    actorId: params.get(PARAMS.actorId) ?? '',
    targetType: params.get(PARAMS.targetType) ?? '',
    from: params.get(PARAMS.from) ?? '',
    to: params.get(PARAMS.to) ?? '',
  };
  const setFilter = (patch: Partial<AuditFilter>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch) as [keyof AuditFilter, string][]) {
      if (v) next.set(PARAMS[k], v);
      else next.delete(PARAMS[k]);
    }
    setParams(next, { replace: true });
  };
  const active = Object.values(filter).some(Boolean);
  const rangeInvalid = !!filter.from && !!filter.to && filter.from > filter.to;

  const log = useAuditLog(filter);
  const staff = useStaffUsers();
  const cohorts = useAdminCohorts();
  const courses = useCourseOptions();

  // Имя выбранного «Кто», если он не сотрудник (выбран кликом по строке)
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  const staffList = staff.data ?? [];
  const actorKnown = !filter.actorId || staffList.some((s) => s.id === filter.actorId);

  const cohortMap = useMemo(() => new Map((cohorts.data?.items ?? []).map((c) => [c.id, c.name])), [cohorts.data]);
  const courseMap = useMemo(() => new Map((courses.data ?? []).map((c) => [c.id, courseTitle(c, i18n.language)])), [courses.data, i18n.language]);
  const cohortName = (id: string | null | undefined) => (id ? cohortMap.get(id) ?? id : t('admin.noCohort'));
  const courseName = (id: string) => courseMap.get(id) ?? id;

  const actionOptions = useMemo(
    () => [...AUDIT_ACTIONS].map((a) => ({ value: a, label: t(`admin.actions.${a}`) })).sort((a, b) => a.label.localeCompare(b.label, i18n.language)),
    [t, i18n.language],
  );
  const targetOptions = useMemo(
    () => [...AUDIT_TARGETS].map((a) => ({ value: a, label: t(`admin.targets.${a}`) })).sort((a, b) => a.label.localeCompare(b.label, i18n.language)),
    [t, i18n.language],
  );

  const items = log.data?.pages.flatMap((p) => p.items) ?? [];
  const filterByActor = (e: AuditEntry) => {
    setActorNames((m) => ({ ...m, [e.actorId]: e.actor.name }));
    setFilter({ actorId: e.actorId });
  };
  const actionLabel = (a: string) => t(`admin.actions.${a}`, { defaultValue: a });
  const targetLabel = (tt: string | null) => (tt ? t(`admin.targets.${tt}`, { defaultValue: tt }) : '—');

  return (
    <>
      <PageHeader eyebrow={t('admin.eyebrow')} title={t('admin.audit')} subtitle={t('admin.auditPage.subtitle')} />

      <Card className="mb-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,22rem)]">
          <Field label={t('admin.action')}>
            <Select value={filter.action} onChange={(e) => setFilter({ action: e.target.value })}>
              <option value="">{t('admin.auditPage.anyAction')}</option>
              {actionOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('admin.actor')}>
            <Select value={filter.actorId} onChange={(e) => setFilter({ actorId: e.target.value })}>
              <option value="">{t('admin.auditPage.anyActor')}</option>
              {!actorKnown && <option value={filter.actorId}>{actorNames[filter.actorId] ?? filter.actorId}</option>}
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {t(`roles.${s.role}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('admin.auditPage.target')}>
            <Select value={filter.targetType} onChange={(e) => setFilter({ targetType: e.target.value })}>
              <option value="">{t('admin.auditPage.anyTarget')}</option>
              {targetOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          {/* Период: на мобильных — два поля в ряд; с xl — отдельные столбцы сетки */}
          <div className="grid grid-cols-2 gap-3 sm:col-span-2 xl:col-span-1">
            <Field label={t('admin.from')}>
              <Input type="date" value={filter.from} max={filter.to || undefined} onChange={(e) => setFilter({ from: e.target.value })} className="!px-3" />
            </Field>
            <Field label={t('admin.to')}>
              <Input type="date" value={filter.to} min={filter.from || undefined} onChange={(e) => setFilter({ to: e.target.value })} className="!px-3" />
            </Field>
          </div>
        </div>
        {rangeInvalid && <p className="mt-2 text-small font-medium text-danger-ink">{t('admin.rangeInvalid')}</p>}
        {active && (
          <div className="mt-4 flex justify-end border-t border-border pt-3">
            <Button variant="ghost" size="sm" onClick={() => setFilter({ action: '', actorId: '', targetType: '', from: '', to: '' })}>
              {t('admin.resetFilters')}
            </Button>
          </div>
        )}
      </Card>

      {log.isLoading ? (
        <LoadingRows rows={6} />
      ) : log.isError ? (
        <ErrorState message={(log.error as ApiError)?.message ?? t('errors.generic')} />
      ) : !items.length ? (
        <EmptyState title={t('admin.auditPage.empty')} hint={t('admin.auditPage.emptyHint')} />
      ) : (
        <div className="space-y-4">
          {/* Десктоп: таблица; прокрутка — внутри контейнера */}
          <div className="card hidden overflow-hidden !p-0 lg:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] table-fixed text-body">
                <colgroup>
                  <col className="w-[10.5rem]" />
                  <col className="w-[15rem]" />
                  <col className="w-[13rem]" />
                  <col className="w-[12rem]" />
                  <col />
                </colgroup>
                <thead className="border-b border-border">
                  <tr>
                    <Th>{t('admin.when')}</Th>
                    <Th>{t('admin.actor')}</Th>
                    <Th>{t('admin.action')}</Th>
                    <Th>{t('admin.auditPage.target')}</Th>
                    <Th>{t('admin.auditPage.colDetail')}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((a) => (
                    <tr key={a.id} className="align-top">
                      <td className="px-4 py-3 text-fg-2">{formatDate(a.createdAt, 'datetime')}</td>
                      <td className="px-4 py-3">
                        <ActorCell entry={a} onFilter={() => filterByActor(a)} />
                      </td>
                      <td className="px-4 py-3 font-medium text-fg" title={a.action}>
                        {actionLabel(a.action)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-fg">{targetLabel(a.targetType)}</div>
                        {a.targetId && <div className="break-all font-mono text-small text-fg-2">{a.targetId}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <AuditDetail entry={a} cohortName={cohortName} courseName={courseName} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Мобильные: карточки */}
          <ul className="space-y-3 lg:hidden">
            {items.map((a) => (
              <li key={a.id} className="card space-y-2 p-4">
                <div className="text-base font-semibold text-fg" title={a.action}>
                  {actionLabel(a.action)}
                </div>
                <div className="text-meta text-fg-2">
                  {formatDate(a.createdAt, 'datetime')} · {targetLabel(a.targetType)}
                </div>
                <ActorCell entry={a} onFilter={() => filterByActor(a)} compact />
                <AuditDetail entry={a} cohortName={cohortName} courseName={courseName} />
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-meta text-fg-2">{t('admin.auditPage.shown', { count: items.length })}</span>
            {log.hasNextPage ? (
              <Button variant="secondary" onClick={() => void log.fetchNextPage()} loading={log.isFetchingNextPage}>
                {t('admin.auditPage.more')}
              </Button>
            ) : (
              <span className="text-meta text-fg-2">{t('admin.auditPage.end')}</span>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ActorCell({ entry, onFilter, compact }: { entry: AuditEntry; onFilter: () => void; compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={clsx('min-w-0', compact && 'flex flex-wrap items-center gap-x-2 gap-y-1')}>
      <button
        type="button"
        onClick={onFilter}
        title={t('admin.auditPage.filterByActor', { name: entry.actor.name })}
        className="inline-flex max-w-full items-center gap-1 text-left font-semibold text-fg underline-offset-4 hover:text-brand hover:underline"
      >
        <span className="break-words">{entry.actor.name}</span>
        <Icon name="search" size={14} className="shrink-0 text-fg-2" />
        <span className="sr-only">{t('admin.auditPage.filterByActor', { name: entry.actor.name })}</span>
      </button>
      {!compact && <EmailText email={entry.actor.email} className="block text-meta text-fg-2" />}
      <RoleBadge role={entry.actor.role} className={compact ? '' : 'mt-1'} />
    </div>
  );
}
