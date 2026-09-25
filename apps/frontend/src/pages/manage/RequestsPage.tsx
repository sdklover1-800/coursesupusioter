import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  pickVersion, useApproveRequest, useBulkApprove, useCohortsLite, useEnrollmentRequests, useRejectRequest,
  type CohortLite, type EnrollmentRequest, type RequestsFilter,
} from '../../lib/catalog';
import { useFormat } from '../../lib/format';
import { apiErrorMessage, cohortOptionLabel, useManagedCourses } from '../../lib/staff';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { Button, Card, ConfirmDialog, Dialog, Field, Select, Tabs, toast } from '../../components/ui';
import { Icon } from '../../components/icons';
import { PageHeader, EmptyState, ErrorState, LoadingRows } from '../../components/page';
import { LangBadge, SelfRegisteredChip, StatusPill } from '../../components/enrollment';
import { AutoTextarea, Checkbox, Notice } from '../../components/staff/primitives';
import { EmailText } from '../../components/staff/admin/bits';

/** Вкладка «Одобренные» — только клиентский фильтр поверх ALL (сервер знает PENDING|REJECTED|ALL). */
type RequestsTab = RequestsFilter | 'APPROVED';
const TABS: RequestsTab[] = ['PENDING', 'APPROVED', 'REJECTED', 'ALL'];
const NOTE_MAX = 500;

/** Можно одобрить: ожидающие и ранее отклонённые (контракт approve). */
const canApprove = (r: EnrollmentRequest) => r.status === 'PENDING' || r.status === 'REJECTED';
const isApprovedStatus = (s: string) => s === 'ACTIVE' || s === 'COMPLETED';

/** Причины пропуска при пакетном одобрении (тексты сервера BE1) → ключи перевода. */
type SkipKind = 'confirm' | 'locked' | 'inactive' | 'forbidden' | 'conflict' | 'other';
function skipKind(reason: string): SkipKind {
  const r = reason.toLowerCase();
  if (r.includes('учебные данные') || r.includes('подтвердите')) return 'confirm';
  if (r.includes('зафиксирован')) return 'locked';
  if (r.includes('деактивирован')) return 'inactive';
  if (r.includes('администратор')) return 'forbidden';
  if (r.includes('исказит') || r.includes('другом курсе')) return 'conflict';
  return 'other';
}

/** Детали 409 COHORT_CONFIRM_REQUIRED (BE1). */
interface CohortConfirm {
  ids: string[];
  cohortId: string;
  bulk: boolean;
  priorEnrollments?: number;
  priorAttempts?: number;
  priorLectures?: number;
  name?: string;
}

interface SkippedInfo {
  items: { id: string; reason: string }[];
  cohortId?: string;
}

/**
 * Модерация заявок на курсы (COURSE_MANAGER, ADMIN): одобрение с назначением
 * когорты (группа эксперимента), отклонение с комментарием, массовое одобрение.
 * Первое назначение группы студенту с учебными данными — только с явным
 * подтверждением (409 COHORT_CONFIRM_REQUIRED → повтор с confirmCohortAssign).
 */
export function RequestsPage() {
  const { t } = useTranslation();
  const { formatDate } = useFormat();
  useDocumentTitle(t('requests.title'));
  const { user: me } = useAuth();
  const isAdmin = me?.role === 'ADMIN';
  const [params, setParams] = useSearchParams();
  const rawStatus = params.get('status');
  const tab: RequestsTab = TABS.includes(rawStatus as RequestsTab) ? (rawStatus as RequestsTab) : 'PENDING';
  const serverFilter: RequestsFilter = tab === 'APPROVED' ? 'ALL' : tab;
  const courseId = params.get('courseId') ?? '';

  const q = useEnrollmentRequests(serverFilter, courseId);
  const coursesQ = useManagedCourses();
  const cohortsQ = useCohortsLite();
  const cohorts = cohortsQ.data?.items ?? [];
  const cohortName = (id: string | null | undefined) => (id ? cohorts.find((c) => c.id === id)?.name ?? null : null);

  const allItems = q.data?.items ?? [];
  const items = tab === 'APPROVED' ? allItems.filter((r) => isApprovedStatus(r.status)) : allItems;
  const pendingCount = q.data?.counts.pending ?? 0;
  const selectable = items.filter((r) => r.status === 'PENDING');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [approveIds, setApproveIds] = useState<string[] | null>(null);
  const [rejectTarget, setRejectTarget] = useState<EnrollmentRequest | null>(null);
  const [skipped, setSkipped] = useState<SkippedInfo | null>(null);
  const [confirmBulk, setConfirmBulk] = useState<CohortConfirm | null>(null);

  // Смена вкладки/фильтра — сбрасываем выбор; после обновления данных — оставляем только актуальные.
  useEffect(() => {
    setSelected(new Set());
  }, [tab, courseId]);
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
      .map((c) => ({ id: c.id, title: (c.languageVersions.find((v) => v.language === c.defaultLanguage) ?? pickVersion(c.languageVersions, 'ru'))!.title })),
    [coursesQ.data],
  );

  function setParam(key: string, value: string) {
    const n = new URLSearchParams(params);
    if (value) n.set(key, value);
    else n.delete(key);
    setParams(n, { replace: true });
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const someSelected = selected.size > 0 && !allSelected;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.id)));

  const emptyTitle = t(`requests.empty.${tab}`);
  const byId = (id: string) => allItems.find((r) => r.id === id);
  const approveSingle = approveIds?.length === 1 ? byId(approveIds[0]!) : undefined;
  const skippedConfirmIds = (skipped?.items ?? []).filter((s) => skipKind(s.reason) === 'confirm').map((s) => s.id);

  return (
    <>
      <PageHeader eyebrow={t('requests.eyebrow')} title={t('requests.title')} subtitle={t('requests.subtitle')} />

      {/* Вкладки + фильтр курса */}
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        {/* Не помещаются на телефоне (kk) — Tabs сам прокручивается с маской у края и докручивает к выбранной */}
        <Tabs
          className="min-w-0 md:flex-1"
          ariaLabel={t('requests.title')}
          value={tab}
          onChange={(v) => setParam('status', v === 'PENDING' ? '' : v)}
          tabs={TABS.map((k) => ({ id: k, label: t(`requests.tab.${k}`), badge: k === 'PENDING' && pendingCount > 0 ? pendingCount : undefined }))}
        />
        <Select aria-label={t('requests.colCourse')} className="md:w-72" value={courseId} onChange={(e) => setParam('courseId', e.target.value)}>
          <option value="">{t('requests.allCourses')}</option>
          {courseOptions.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </Select>
      </div>

      {/* Итог пакетного одобрения: пропущенные заявки и причины */}
      {skipped && skipped.items.length > 0 && (
        <Notice
          tone="spark"
          icon="alert"
          className="mb-4"
          title={t('requests.skipped.title', { count: skipped.items.length })}
          action={
            <Button variant="ghost" size="sm" onClick={() => setSkipped(null)} aria-label={t('common.close')}>
              <Icon name="x" size={16} />
            </Button>
          }
        >
          <ul className="mt-1 space-y-1">
            {skipped.items.map((s) => {
              const r = byId(s.id);
              const kind = skipKind(s.reason);
              return (
                <li key={s.id}>
                  <span className="font-medium text-fg">{r?.user.name ?? s.id}</span>
                  {' — '}
                  {kind === 'other' ? s.reason : t(`requests.skipReason.${kind}`)}
                </li>
              );
            })}
          </ul>
          {skippedConfirmIds.length > 0 && skipped.cohortId && (
            <Button
              size="sm"
              className="mt-3 whitespace-nowrap"
              onClick={() => setConfirmBulk({ ids: skippedConfirmIds, cohortId: skipped.cohortId!, bulk: true, name: cohortName(skipped.cohortId) ?? undefined })}
            >
              {t('requests.skipped.approveConfirmed', { count: skippedConfirmIds.length })}
            </Button>
          )}
        </Notice>
      )}

      {/* Панель массового действия */}
      {selected.size > 0 && (
        <div className="sticky top-[calc(3.75rem+env(safe-area-inset-top,0px))] z-10 mb-4 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 shadow-soft lg:top-[4.25rem]">
          <span className="text-body font-semibold text-fg">{t('requests.selected', { count: selected.size })}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected(new Set())}>{t('requests.clearSelection')}</Button>
          <Button size="sm" className="w-full whitespace-nowrap sm:w-auto" onClick={() => setApproveIds([...selected])}>
            <Icon name="check" size={16} />
            {t('requests.approveSelected')}
          </Button>
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
        <EmptyState title={emptyTitle} hint={tab === 'PENDING' ? t('requests.emptyPendingHint') : undefined} />
      ) : (
        <>
          {/* Таблица (широкие экраны) */}
          <Card className="hidden overflow-hidden !p-0 xl:block">
            <div className="relative overflow-x-auto">
              <table className="w-full text-body">
                <thead>
                  <tr className="border-b border-border text-left text-small font-semibold text-fg-2">
                    <th className="w-12 py-3 pl-5 pr-2">
                      <Checkbox checked={allSelected} indeterminate={someSelected} disabled={!selectable.length} onChange={toggleAll} label={t('requests.selectAll')} />
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
                        <div className="text-fg-2 [overflow-wrap:anywhere]">{r.user.email}</div>
                        <UserChips cohort={cohortName(r.user.cohortId)} selfRegistered={!!r.user.selfRegisteredAt} />
                      </td>
                      <td className="min-w-[9rem] px-3 py-4">
                        <div className="flex items-start gap-2">
                          <LangBadge lang={r.languageVersion.language} className="mt-px" />
                          <span className="leading-snug">{r.languageVersion.title}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-fg-2">{formatDate(r.requestedAt)}</td>
                      <td className="px-3 py-4">
                        <StatusPill status={r.status} />
                        {r.status !== 'PENDING' && r.reviewedAt && (
                          <div className="mt-1 whitespace-nowrap text-small text-fg-2">{t('requests.reviewedOn', { date: formatDate(r.reviewedAt) })}</div>
                        )}
                        {r.reviewNote && <p className="mt-1.5 max-w-[14rem] text-small text-fg-2">«{r.reviewNote}»</p>}
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
              <label className="flex cursor-pointer items-center gap-3 px-1 text-body font-semibold text-fg-2 md:col-span-2">
                <Checkbox checked={allSelected} indeterminate={someSelected} onChange={toggleAll} label={t('requests.selectAll')} />
                {t('requests.selectAll')}
              </label>
            )}
            {items.map((r) => (
              <Card key={r.id} className={clsx('min-w-0 !p-4', selected.has(r.id) && 'border-brand/50 bg-brand-soft/30')}>
                <div className="flex items-start gap-3">
                  {r.status === 'PENDING' && (
                    <div className="pt-0.5">
                      <Checkbox checked={selected.has(r.id)} onChange={() => toggle(r.id)} label={`${t('requests.selectRow')}: ${r.user.name}`} />
                    </div>
                  )}
                  {/*
                    Карточка (§8): имя → email на всю ширину → курс «Язык · название» → когорта текстом →
                    предупреждение о саморегистрации строкой → один статус-чип с датами. Не больше одного чипа в строке.
                  */}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-fg [overflow-wrap:anywhere]">{r.user.name}</div>
                    <EmailText email={r.user.email} className="block text-meta text-fg-2" />
                    <p className="mt-2 text-body text-fg">
                      <span className="text-fg-2">{t(`languages.${r.languageVersion.language}`, { defaultValue: r.languageVersion.language })} · </span>
                      <span lang={r.languageVersion.language}>{r.languageVersion.title}</span>
                    </p>
                    {cohortName(r.user.cohortId) && (
                      <p className="mt-1 inline-flex items-start gap-1.5 text-meta text-fg-2">
                        <Icon name="users" size={16} className="mt-[3px]" />
                        <span>{t('requests.cohort')}: {cohortName(r.user.cohortId)}</span>
                      </p>
                    )}
                    {r.user.selfRegisteredAt && (
                      <p className="mt-1 flex items-start gap-1.5 text-meta font-medium text-fg" title={t('requests.selfRegisteredHint')}>
                        <Icon name="alert" size={16} className="mt-[3px] text-spark-ink" />
                        <span>
                          {t('requests.selfRegistered')}
                          <span className="sr-only">. {t('requests.selfRegisteredHint')}</span>
                        </span>
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <StatusPill status={r.status} />
                      <span className="text-small text-fg-2">
                        {t('requests.requestedOn', { date: formatDate(r.requestedAt) })}
                        {r.status !== 'PENDING' && r.reviewedAt && <> · {t('requests.reviewedOn', { date: formatDate(r.reviewedAt) })}</>}
                      </span>
                    </div>
                    {r.reviewNote && <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-small text-fg-2">«{r.reviewNote}»</p>}
                    {canApprove(r) && (
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <Button size="sm" className="whitespace-nowrap" onClick={() => setApproveIds([r.id])}>{t('requests.approve')}</Button>
                        {r.status === 'PENDING'
                          ? <Button size="sm" variant="secondary" className="whitespace-nowrap" onClick={() => setRejectTarget(r)}>{t('requests.reject')}</Button>
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
        cohortName={cohortName}
        onClose={() => setApproveIds(null)}
        onDone={(info) => {
          setApproveIds(null);
          setSelected(new Set(info?.items.map((x) => x.id) ?? []));
          setSkipped(info && info.items.length ? info : null);
        }}
      />
      <CohortConfirmDialog
        info={confirmBulk}
        onClose={() => setConfirmBulk(null)}
        onDone={(info) => {
          setConfirmBulk(null);
          setSkipped(info && info.items.length ? info : null);
          setSelected(new Set(info?.items.map((x) => x.id) ?? []));
        }}
      />
      <RejectDialog target={rejectTarget} onClose={() => setRejectTarget(null)} />
    </>
  );
}

/* ── Мелкие элементы ─────────────────────────────────────── */
function CohortChip({ name }: { name: string | null }) {
  const { t } = useTranslation();
  if (!name) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-border/50 px-1.5 py-0.5 text-small font-semibold text-fg-2">
      <Icon name="users" size={14} />
      <span className="sr-only">{t('requests.cohort')}:</span>
      {name}
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
      {r.status === 'PENDING' && <Button size="sm" variant="ghost" className="whitespace-nowrap" onClick={onReject}>{t('requests.reject')}</Button>}
      <Button size="sm" variant={r.status === 'PENDING' ? 'primary' : 'secondary'} className="whitespace-nowrap" onClick={onApprove}>{t('requests.approve')}</Button>
    </div>
  );
}

/** Тексты подтверждения первого назначения группы (COHORT_CONFIRM_REQUIRED). */
function confirmBody(info: CohortConfirm, t: ReturnType<typeof useTranslation>['t']) {
  return (
    <span className="block space-y-2">
      <span className="block">
        {info.bulk
          ? t('requests.confirmCohort.bodyBulk', { count: info.ids.length, cohort: info.name ?? '—' })
          : t('requests.confirmCohort.body', {
              enrollments: info.priorEnrollments ?? 0,
              attempts: info.priorAttempts ?? 0,
              cohort: info.name ?? '—',
            })}
      </span>
      <span className="block font-medium text-fg">{t('requests.confirmCohort.recorded')}</span>
    </span>
  );
}

/* ── Диалог одобрения (одна заявка или выбранные) ─────────── */
function ApproveDialog({ ids, single, targets, isAdmin, cohorts, cohortsAvailable, currentCohort, cohortName, onClose, onDone }: {
  ids: string[] | null;
  single?: EnrollmentRequest;
  /** Одобряемые заявки (из загруженного списка) — для пометок в диалоге */
  targets: EnrollmentRequest[];
  isAdmin: boolean;
  cohorts: CohortLite[];
  cohortsAvailable: boolean;
  currentCohort: string | null;
  cohortName: (id: string | null | undefined) => string | null;
  onClose: () => void;
  /** Итог: пропущенные при пакетном одобрении (с причинами) остаются выбранными */
  onDone: (skipped?: SkippedInfo) => void;
}) {
  const { t } = useTranslation();
  const approve = useApproveRequest();
  const bulk = useBulkApprove();
  const [cohortId, setCohortId] = useState('');
  const [confirm, setConfirm] = useState<CohortConfirm | null>(null);
  useEffect(() => {
    if (ids) {
      setCohortId('');
      setConfirm(null);
    }
  }, [ids]);
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
    toast(apiErrorMessage(err, t), 'danger');
  }

  function approveOne(id: string, cohort: string | undefined, confirmCohortAssign: boolean) {
    approve.mutate({ id, cohortId: cohort, confirmCohortAssign }, {
      onSuccess: () => {
        toast(t('requests.approved'), 'teal');
        setConfirm(null);
        onDone();
      },
      onError: (err) => {
        // Первое назначение группы студенту с учебными данными — явное подтверждение
        if (err instanceof ApiError && err.code === 'COHORT_CONFIRM_REQUIRED' && cohort && !confirmCohortAssign) {
          const d = (err.details ?? {}) as { priorEnrollments?: number; priorAttempts?: number; priorLectures?: number };
          setConfirm({ ids: [id], cohortId: cohort, bulk: false, priorEnrollments: d.priorEnrollments, priorAttempts: d.priorAttempts, priorLectures: d.priorLectures, name: cohortName(cohort) ?? undefined });
          return;
        }
        fail(err);
      },
    });
  }

  function submit() {
    if (!ids?.length) return;
    const cohort = cohortId || undefined;
    if (!isBulk) {
      approveOne(ids[0]!, cohort, false);
    } else {
      bulk.mutate({ ids, cohortId: cohort }, {
        onSuccess: (r) => {
          toast(t('requests.approvedBulk', { count: r.approved }), 'teal');
          // Пропущенные с причинами — в панели над списком (там же «Одобрить с подтверждением»)
          onDone({ items: r.skipped ?? [], cohortId: cohort });
        },
        onError: fail,
      });
    }
  }

  return (
    <>
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
            <Button onClick={submit} loading={busy} className="whitespace-nowrap">
              <Icon name="check" size={16} />
              {t('requests.approve')}
            </Button>
          </>
        }
      >
        <p className="text-body text-fg">{isBulk ? t('requests.approveTextBulk') : t('requests.approveText')}</p>
        {selfRegisteredCount > 0 && (
          <p className="mt-3 flex gap-2 rounded-lg bg-spark/10 px-3 py-2 text-small text-fg">
            <SelfRegisteredChip withHint={false} className="shrink-0 self-start" />
            <span>{isBulk ? t('requests.selfRegisteredBulk', { count: selfRegisteredCount }) : t('requests.selfRegisteredHint')}</span>
          </p>
        )}
        {cohortsAvailable && cohorts.length > 0 && cohortLocked && (
          <div className="mt-5 text-body">
            <div className="font-semibold text-fg">{t('requests.cohort')}: {currentCohort ?? '—'}</div>
            <p className="mt-1 text-small text-fg-2">{t('requests.cohortLocked')}</p>
          </div>
        )}
        {cohortsAvailable && cohorts.length > 0 && !cohortLocked && (
          <div className="mt-5">
            <Field label={t('requests.cohort')} hint={cohortFieldHint}>
              <Select data-autofocus value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
                <option value="">{t('requests.cohortKeep')}</option>
                {cohorts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {cohortOptionLabel(c.name, c.condition ? t(`conditions.${c.condition}`, { defaultValue: c.condition }) : null)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={!!confirm}
        title={t('requests.confirmCohort.title')}
        body={confirm ? confirmBody(confirm, t) : undefined}
        confirmLabel={t('requests.confirmCohort.confirm')}
        busy={approve.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && approveOne(confirm.ids[0]!, confirm.cohortId, true)}
      />
    </>
  );
}

/* ── «Одобрить с подтверждением» для пропущенных при пакетном одобрении ── */
function CohortConfirmDialog({ info, onClose, onDone }: { info: CohortConfirm | null; onClose: () => void; onDone: (skipped?: SkippedInfo) => void }) {
  const { t } = useTranslation();
  const bulk = useBulkApprove();
  return (
    <ConfirmDialog
      open={!!info}
      title={t('requests.confirmCohort.title')}
      body={info ? confirmBody(info, t) : undefined}
      confirmLabel={t('requests.confirmCohort.confirm')}
      busy={bulk.isPending}
      onCancel={onClose}
      onConfirm={() =>
        info &&
        bulk.mutate({ ids: info.ids, cohortId: info.cohortId, confirmCohortAssign: true }, {
          onSuccess: (r) => {
            toast(t('requests.approvedBulk', { count: r.approved }), 'teal');
            onDone({ items: r.skipped ?? [], cohortId: info.cohortId });
          },
          onError: (err) => toast(apiErrorMessage(err, t), 'danger'),
        })
      }
    />
  );
}

/* ── Диалог отклонения с комментарием ─────────────────────── */
function RejectDialog({ target, onClose }: { target: EnrollmentRequest | null; onClose: () => void }) {
  const { t } = useTranslation();
  const reject = useRejectRequest();
  const [note, setNote] = useState('');
  useEffect(() => {
    if (target) setNote('');
  }, [target]);

  function confirm() {
    if (!target) return;
    reject.mutate({ id: target.id, note: note.trim() || undefined }, {
      onSuccess: () => {
        toast(t('requests.rejected'), 'brand');
        onClose();
      },
      onError: (err) => toast(apiErrorMessage(err, t), 'danger'),
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
          <Button variant="danger" onClick={confirm} loading={reject.isPending} className="whitespace-nowrap">{t('requests.reject')}</Button>
        </>
      }
    >
      <p className="text-body text-fg">{t('requests.rejectText')}</p>
      <div className="mt-5">
        <Field label={`${t('requests.note')} · ${t('requests.optional')}`}>
          <AutoTextarea data-autofocus value={note} maxLength={NOTE_MAX} minRows={4} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="num mt-1 text-right text-small text-fg-2">
          {note.length}/{NOTE_MAX}
        </div>
      </div>
    </Dialog>
  );
}
