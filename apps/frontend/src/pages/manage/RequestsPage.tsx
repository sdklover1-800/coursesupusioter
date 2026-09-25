import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  formatDate, pickVersion, useApproveRequest, useBulkApprove, useCohortsLite, useEnrollmentRequests, useRejectRequest,
  type CohortLite, type EnrollmentRequest, type RequestsFilter,
} from '../../lib/catalog';
import { Button, Card, Dialog, Field, Select, Textarea, toast } from '../../components/ui';
import { PageHeader, EmptyState, ErrorState, LoadingRows } from '../../components/page';
import { LangBadge, SelfRegisteredChip, StatusPill } from '../../components/enrollment';

interface ManagedCourse { id: string; defaultLanguage: string; languageVersions: { id: string; language: string; title: string }[] }

const FILTERS: RequestsFilter[] = ['PENDING', 'REJECTED', 'ALL'];
const NOTE_MAX = 500;

/** Можно одобрить: ожидающие и ранее отклонённые (контракт approve). */
const canApprove = (r: EnrollmentRequest) => r.status === 'PENDING' || r.status === 'REJECTED';

/**
 * Модерация заявок на курсы (COURSE_MANAGER, ADMIN): одобрение с назначением
 * когорты (группа эксперимента), отклонение с комментарием, массовое одобрение.
 */
export function RequestsPage() {
  const { t, i18n } = useTranslation();
  const { user: me } = useAuth();
  const isAdmin = me?.role === 'ADMIN';
  const [params, setParams] = useSearchParams();
  const rawStatus = params.get('status');
  const status: RequestsFilter = FILTERS.includes(rawStatus as RequestsFilter) ? (rawStatus as RequestsFilter) : 'PENDING';
  const courseId = params.get('courseId') ?? '';

  const q = useEnrollmentRequests(status, courseId);
  const coursesQ = useQuery({ queryKey: ['courses'], queryFn: () => api.get<{ items: ManagedCourse[] }>('/courses') });
  const cohortsQ = useCohortsLite();
  const cohorts = cohortsQ.data?.items ?? [];
  const cohortName = (id: string | null) => (id ? cohorts.find((c) => c.id === id)?.name ?? null : null);

  const items = q.data?.items ?? [];
  const pendingCount = q.data?.counts.pending ?? 0;
  const selectable = items.filter((r) => r.status === 'PENDING');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [approveIds, setApproveIds] = useState<string[] | null>(null);
  const [rejectTarget, setRejectTarget] = useState<EnrollmentRequest | null>(null);

  // Смена вкладки/фильтра — сбрасываем выбор; после обновления данных — оставляем только актуальные.
  useEffect(() => { setSelected(new Set()); }, [status, courseId]);
  useEffect(() => {
    setSelected((s) => {
      const ids = new Set(selectable.map((r) => r.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const courseOptions = useMemo(
    () => (coursesQ.data?.items ?? [])
      .filter((c) => c.languageVersions.length)
      .map((c) => ({ id: c.id, title: (c.languageVersions.find((v) => v.language === c.defaultLanguage) ?? pickVersion(c.languageVersions, i18n.language))!.title })),
    [coursesQ.data, i18n.language],
  );

  function setParam(key: string, value: string) {
    const n = new URLSearchParams(params);
    if (value) n.set(key, value); else n.delete(key);
    setParams(n, { replace: true });
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const someSelected = selected.size > 0 && !allSelected;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.id)));

  const tabs: { key: RequestsFilter; label: string }[] = [
    { key: 'PENDING', label: t('requests.tabPending') },
    { key: 'REJECTED', label: t('requests.tabRejected') },
    { key: 'ALL', label: t('requests.tabAll') },
  ];
  const emptyTitle = status === 'PENDING' ? t('requests.emptyPending') : status === 'REJECTED' ? t('requests.emptyRejected') : t('requests.emptyAll');
  const byId = (id: string) => items.find((r) => r.id === id);
  const approveSingle = approveIds?.length === 1 ? byId(approveIds[0]!) : undefined;

  return (
    <>
      <PageHeader eyebrow={t('nav.courses')} title={t('requests.title')} subtitle={t('requests.subtitle')} />

      {/* Вкладки + фильтр курса */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label={t('requests.title')} className="flex w-full overflow-x-auto rounded-xl border border-border bg-card p-1 sm:w-auto">
          {tabs.map((tb) => {
            const active = tb.key === status;
            return (
              <button
                key={tb.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setParam('status', tb.key === 'PENDING' ? '' : tb.key)}
                className={clsx(
                  'inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors sm:flex-none',
                  active ? 'bg-brand text-white shadow-soft' : 'text-muted hover:text-fg',
                )}
              >
                {tb.label}
                {tb.key === 'PENDING' && pendingCount > 0 && (
                  <span className={clsx('min-w-[1.25rem] rounded-full px-1.5 font-mono text-[11px] leading-5 tabular-nums', active ? 'bg-spark text-ink' : 'bg-spark/20 text-fg')}>
                    {pendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <Select
          aria-label={t('requests.colCourse')}
          className="sm:w-72"
          value={courseId}
          onChange={(e) => setParam('courseId', e.target.value)}
        >
          <option value="">{t('requests.allCourses')}</option>
          {courseOptions.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </Select>
      </div>

      {/* Панель массового действия */}
      {selected.size > 0 && (
        <div className="sticky top-[4.5rem] z-10 mb-4 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 shadow-soft animate-fade-up">
          <span className="font-mono text-sm font-semibold tabular-nums text-brand">{t('requests.selected', { count: selected.size })}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected(new Set())}>{t('requests.clearSelection')}</Button>
          <Button size="sm" className="w-full sm:w-auto" onClick={() => setApproveIds([...selected])}>✓ {t('requests.approveSelected')}</Button>
        </div>
      )}

      {q.isLoading ? (
        <LoadingRows rows={5} />
      ) : q.isError ? (
        <div className="space-y-3 text-center">
          <ErrorState message={q.error instanceof ApiError && q.error.status < 500 ? q.error.message : t('requests.loadError')} />
          <Button variant="secondary" onClick={() => void q.refetch()}>{t('common.retry')}</Button>
        </div>
      ) : !items.length ? (
        <EmptyState title={emptyTitle} hint={status === 'PENDING' ? t('requests.emptyPendingHint') : undefined} />
      ) : (
        <>
          {/* Таблица (широкие экраны) */}
          <Card className="hidden overflow-hidden !p-0 xl:block">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="w-12 py-3 pl-5 pr-2">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected}
                      disabled={!selectable.length}
                      onChange={toggleAll}
                      label={t('requests.selectAll')}
                    />
                  </th>
                  <th className="px-3 py-3">{t('requests.colStudent')}</th>
                  <th className="px-3 py-3">{t('requests.colCourse')}</th>
                  <th className="px-3 py-3">{t('requests.colRequested')}</th>
                  <th className="px-3 py-3">{t('requests.colStatus')}</th>
                  <th className="py-3 pl-3 pr-4 text-right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((r) => (
                  <tr key={r.id} className={clsx('align-top transition-colors', selected.has(r.id) ? 'bg-brand-soft/50' : 'hover:bg-brand-soft/25')}>
                    <td className="py-4 pl-5 pr-2">
                      {r.status === 'PENDING' && (
                        <Checkbox checked={selected.has(r.id)} onChange={() => toggle(r.id)} label={`${t('requests.selectRow')}: ${r.user.name}`} />
                      )}
                    </td>
                    <td className="min-w-[12rem] px-3 py-4">
                      <div className="font-semibold">{r.user.name}</div>
                      <div className="text-muted [overflow-wrap:anywhere]">{r.user.email}</div>
                      <UserChips cohort={cohortName(r.user.cohortId)} selfRegistered={!!r.user.selfRegisteredAt} />
                    </td>
                    <td className="min-w-[9rem] px-3 py-4">
                      <div className="flex items-start gap-2">
                        <LangBadge lang={r.languageVersion.language} className="mt-px" />
                        <span className="leading-snug">{r.languageVersion.title}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 font-mono text-xs tabular-nums text-muted">
                      {formatDate(r.requestedAt, i18n.language)}
                    </td>
                    <td className="px-3 py-4">
                      <StatusPill status={r.status} />
                      {r.status !== 'PENDING' && r.reviewedAt && (
                        <div className="mt-1 whitespace-nowrap font-mono text-[11px] text-muted">{t('requests.reviewedOn', { date: formatDate(r.reviewedAt, i18n.language) })}</div>
                      )}
                      {r.reviewNote && <p className="mt-1.5 max-w-[14rem] text-xs italic text-muted">«{r.reviewNote}»</p>}
                    </td>
                    <td className="py-4 pl-3 pr-4">
                      <RowActions r={r} onApprove={() => setApproveIds([r.id])} onReject={() => setRejectTarget(r)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </Card>

          {/* Карточки (планшет/телефон) */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:hidden">
            {selectable.length > 1 && (
              <label className="flex cursor-pointer items-center gap-3 px-1 text-sm font-semibold text-muted md:col-span-2">
                <Checkbox checked={allSelected} indeterminate={someSelected} onChange={toggleAll} label={t('requests.selectAll')} />
                {t('requests.selectAll')}
              </label>
            )}
            {items.map((r) => (
              <Card key={r.id} className={clsx('!p-4', selected.has(r.id) && 'border-brand/50 bg-brand-soft/30')}>
                <div className="flex items-start gap-3">
                  {r.status === 'PENDING' && (
                    <div className="pt-0.5">
                      <Checkbox checked={selected.has(r.id)} onChange={() => toggle(r.id)} label={`${t('requests.selectRow')}: ${r.user.name}`} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{r.user.name}</div>
                        <div className="truncate text-sm text-muted">{r.user.email}</div>
                      </div>
                      <StatusPill status={r.status} />
                    </div>
                    <UserChips cohort={cohortName(r.user.cohortId)} selfRegistered={!!r.user.selfRegisteredAt} />
                    <div className="mt-3 flex items-start gap-2 text-sm">
                      <LangBadge lang={r.languageVersion.language} className="mt-px" />
                      <span className="leading-snug">{r.languageVersion.title}</span>
                    </div>
                    <div className="mt-2 font-mono text-xs text-muted">
                      {t('catalog.requestedOn', { date: formatDate(r.requestedAt, i18n.language) })}
                      {r.status !== 'PENDING' && r.reviewedAt && <> · {t('requests.reviewedOn', { date: formatDate(r.reviewedAt, i18n.language) })}</>}
                    </div>
                    {r.reviewNote && <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-xs italic text-muted">«{r.reviewNote}»</p>}
                    {canApprove(r) && (
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <Button size="sm" onClick={() => setApproveIds([r.id])}>{t('requests.approve')}</Button>
                        {r.status === 'PENDING'
                          ? <Button size="sm" variant="secondary" onClick={() => setRejectTarget(r)}>{t('requests.reject')}</Button>
                          : <span />}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <ApproveDialog
        ids={approveIds}
        single={approveSingle}
        targets={(approveIds ?? []).map(byId).filter((r): r is EnrollmentRequest => !!r)}
        isAdmin={isAdmin}
        cohorts={cohorts}
        cohortsAvailable={cohortsQ.isSuccess}
        currentCohort={approveSingle ? cohortName(approveSingle.user.cohortId) : null}
        onClose={() => setApproveIds(null)}
        onDone={(keep) => { setApproveIds(null); setSelected(new Set(keep ?? [])); }}
      />
      <RejectDialog target={rejectTarget} onClose={() => setRejectTarget(null)} />
    </>
  );
}

/* ── Мелкие элементы ─────────────────────────────────────── */
function Checkbox({ checked, indeterminate, disabled, onChange, label }: {
  checked: boolean; indeterminate?: boolean; disabled?: boolean; onChange: () => void; label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate; }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      aria-label={label}
      className="h-4 w-4 cursor-pointer rounded accent-[rgb(var(--brand))] disabled:cursor-not-allowed disabled:opacity-40"
    />
  );
}

function CohortChip({ name }: { name: string | null }) {
  const { t } = useTranslation();
  if (!name) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-border/50 px-1.5 py-0.5 text-[11px] font-semibold text-muted">
      ❋ <span className="sr-only">{t('admin.cohort')}:</span>{name}
    </span>
  );
}

function UserChips({ cohort, selfRegistered }: { cohort: string | null; selfRegistered: boolean }) {
  if (!cohort && !selfRegistered) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      <CohortChip name={cohort} />
      {selfRegistered && <SelfRegisteredChip />}
    </div>
  );
}

function RowActions({ r, onApprove, onReject }: { r: EnrollmentRequest; onApprove: () => void; onReject: () => void }) {
  const { t } = useTranslation();
  if (!canApprove(r)) return null;
  return (
    <div className="flex justify-end gap-1.5 whitespace-nowrap">
      {r.status === 'PENDING' && <Button size="sm" variant="ghost" onClick={onReject}>{t('requests.reject')}</Button>}
      <Button size="sm" variant={r.status === 'PENDING' ? 'primary' : 'secondary'} onClick={onApprove}>{t('requests.approve')}</Button>
    </div>
  );
}

/* ── Диалог одобрения (одна заявка или выбранные) ─────────── */
function ApproveDialog({ ids, single, targets, isAdmin, cohorts, cohortsAvailable, currentCohort, onClose, onDone }: {
  ids: string[] | null;
  single?: EnrollmentRequest;
  /** Одобряемые заявки (из загруженного списка) — для пометок в диалоге */
  targets: EnrollmentRequest[];
  isAdmin: boolean;
  cohorts: CohortLite[];
  cohortsAvailable: boolean;
  currentCohort: string | null;
  onClose: () => void;
  /** keep — заявки, оставшиеся выбранными (пропущены при пакетном одобрении) */
  onDone: (keep?: string[]) => void;
}) {
  const { t } = useTranslation();
  const approve = useApproveRequest();
  const bulk = useBulkApprove();
  const [cohortId, setCohortId] = useState('');
  useEffect(() => { if (ids) setCohortId(''); }, [ids]);
  const busy = approve.isPending || bulk.isPending;
  const isBulk = !!ids && ids.length > 1;
  // Сменить уже назначенную когорту может только админ (сервер: decideCohortOnApprove).
  const cohortLocked = !isBulk && !!single?.user.cohortId && !isAdmin;
  const selfRegisteredCount = targets.filter((r) => r.user.selfRegisteredAt).length;
  const cohortFieldHint = isBulk
    ? `${t(isAdmin ? 'requests.cohortBulkAdmin' : 'requests.cohortBulkManager')} ${t('requests.cohortHint')}`
    : [
        t('requests.currentCohort', { name: currentCohort ?? t('requests.noCohort') }) + '.',
        single?.user.cohortId ? t('requests.cohortChangeHint') : t('requests.cohortHint'),
      ].join(' ');

  function fail(err: unknown) {
    toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger');
  }

  function confirm() {
    if (!ids?.length) return;
    const cohort = cohortId || undefined;
    if (!isBulk) {
      approve.mutate({ id: ids[0]!, cohortId: cohort }, {
        onSuccess: () => { toast(t('requests.approved'), 'teal'); onDone(); },
        onError: fail,
      });
    } else {
      bulk.mutate({ ids, cohortId: cohort }, {
        onSuccess: (r) => {
          toast(t('requests.approvedBulk', { count: r.approved }), 'teal');
          const skipped = r.skipped ?? [];
          if (skipped.length) toast(t('requests.skippedBulk', { count: skipped.length }), 'danger');
          onDone(skipped.map((x) => x.id));
        },
        onError: fail,
      });
    }
  }

  return (
    <Dialog
      open={!!ids}
      onClose={onClose}
      busy={busy}
      title={isBulk ? t('requests.approveBulkTitle', { count: ids!.length }) : t('requests.approveTitle')}
      description={
        single ? (
          <span className="flex flex-col gap-1">
            <span className="font-semibold text-fg">{single.user.name}</span>
            <span className="[overflow-wrap:anywhere]">{single.user.email}</span>
            <span className="flex items-center gap-2"><LangBadge lang={single.languageVersion.language} />{single.languageVersion.title}</span>
          </span>
        ) : undefined
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={confirm} loading={busy}>✓ {t('requests.approve')}</Button>
        </>
      }
    >
      <p className="text-sm text-fg">{isBulk ? t('requests.approveTextBulk') : t('requests.approveText')}</p>
      {selfRegisteredCount > 0 && (
        <p className="mt-3 flex gap-2 rounded-lg bg-spark/10 px-3 py-2 text-xs text-fg">
          <SelfRegisteredChip withHint={false} className="shrink-0 self-start" />
          <span>{isBulk ? t('requests.selfRegisteredBulk', { count: selfRegisteredCount }) : t('requests.selfRegisteredHint')}</span>
        </p>
      )}
      {cohortsAvailable && cohorts.length > 0 && cohortLocked && (
        <div className="mt-5 text-sm">
          <div className="font-semibold text-fg">{t('admin.cohort')}: {currentCohort ?? '—'}</div>
          <p className="mt-1 text-xs text-muted">{t('requests.cohortLocked')}</p>
        </div>
      )}
      {cohortsAvailable && cohorts.length > 0 && !cohortLocked && (
        <div className="mt-5">
          <Field label={t('admin.cohort')} hint={cohortFieldHint}>
            <Select data-autofocus value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
              <option value="">{t('requests.cohortKeep')}</option>
              {cohorts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.condition ? ` · ${t(`conditions.${c.condition}`, { defaultValue: c.condition })}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
    </Dialog>
  );
}

/* ── Диалог отклонения с комментарием ─────────────────────── */
function RejectDialog({ target, onClose }: { target: EnrollmentRequest | null; onClose: () => void }) {
  const { t } = useTranslation();
  const reject = useRejectRequest();
  const [note, setNote] = useState('');
  useEffect(() => { if (target) setNote(''); }, [target]);

  function confirm() {
    if (!target) return;
    reject.mutate({ id: target.id, note: note.trim() || undefined }, {
      onSuccess: () => { toast(t('requests.rejected'), 'brand'); onClose(); },
      onError: (err) => toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger'),
    });
  }

  return (
    <Dialog
      open={!!target}
      onClose={onClose}
      busy={reject.isPending}
      title={t('requests.rejectTitle')}
      description={
        target ? (
          <span className="flex flex-col gap-1">
            <span className="font-semibold text-fg">{target.user.name}</span>
            <span className="flex items-center gap-2"><LangBadge lang={target.languageVersion.language} />{target.languageVersion.title}</span>
          </span>
        ) : undefined
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={reject.isPending}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={confirm} loading={reject.isPending}>{t('requests.reject')}</Button>
        </>
      }
    >
      <p className="text-sm text-fg">{t('requests.rejectText')}</p>
      <div className="mt-5">
        <Field label={`${t('requests.note')} · ${t('requests.optional')}`}>
          <Textarea
            data-autofocus
            value={note}
            maxLength={NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            className="min-h-[110px]"
          />
        </Field>
        <div className="mt-1 text-right font-mono text-[11px] tabular-nums text-muted">{note.length}/{NOTE_MAX}</div>
      </div>
    </Dialog>
  );
}
