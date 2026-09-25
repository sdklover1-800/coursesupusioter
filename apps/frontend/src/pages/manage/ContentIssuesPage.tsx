import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '@edu/shared';
import {
  apiErrorMessage, useBulkIssueStatus, useIssues, useIssueSummary, useManagedCourses, useSetIssueStatus,
  type IssueFilters, type IssueGroup, type IssueOrigin, type IssueStatus, type IssueTarget,
} from '../../lib/staff';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { Button, SegmentedControl, Select, Tabs, toast } from '../../components/ui';
import { Icon } from '../../components/icons';
import { PageHeader, LoadingRows, EmptyState, ErrorState } from '../../components/page';
import { IssueRow } from '../../components/staff/IssueRow';
import { NoteDialog } from '../../components/staff/NoteDialog';
import { Checkbox } from '../../components/staff/primitives';

const STATUSES: (IssueStatus | 'ALL')[] = ['OPEN', 'RESOLVED', 'DISMISSED', 'ALL'];
const TARGETS: IssueTarget[] = ['QUIZ_QUESTION', 'LECTURE', 'PRACTICAL_TASK', 'CHAT_MESSAGE'];
type OriginFilter = 'ALL' | IssueOrigin;

/** Действие над выбранными группами/одной группой: закрыть, отклонить, вернуть в работу. */
interface PendingAction {
  status: IssueStatus;
  groups: IssueGroup[];
  bulk: boolean;
}

/**
 * Входящие жалобы на контент (/manage/issues; FE5 §4, Khan «Report a problem»):
 * фильтры по статусу, происхождению (студенты / экспертная проверка), курсу, языку
 * и типу объекта; строки-группы с превью; «Решено» / «Отклонить» с заметкой;
 * пакетное закрытие партий экспертной проверки; курсорная пагинация.
 */
export function ContentIssuesPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('issues.title'));
  const [params, setParams] = useSearchParams();
  const rawStatus = params.get('status');
  const status = (STATUSES.includes(rawStatus as IssueStatus) ? rawStatus : 'OPEN') as IssueStatus | 'ALL';
  const rawOrigin = params.get('origin');
  const origin: OriginFilter = rawOrigin === 'STUDENT' || rawOrigin === 'SYSTEM' ? rawOrigin : 'ALL';
  const courseId = params.get('courseId') ?? '';
  const language = params.get('language') ?? '';
  const rawTarget = params.get('targetType');
  const targetType = TARGETS.includes(rawTarget as IssueTarget) ? (rawTarget as IssueTarget) : undefined;

  const filters: IssueFilters = useMemo(
    () => ({ status, origin: origin === 'ALL' ? undefined : origin, courseId: courseId || undefined, language: language || undefined, targetType }),
    [status, origin, courseId, language, targetType],
  );
  const q = useIssues(filters);
  const summary = useIssueSummary(courseId || null);
  const courses = useManagedCourses();
  const setStatus = useSetIssueStatus();
  const bulk = useBulkIssueStatus();

  const groups = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const selectable = groups.filter((g) => g.openIssueIds.length > 0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingAction | null>(null);

  useEffect(() => setSelected(new Set()), [filters]);
  useEffect(() => {
    setSelected((s) => {
      const keys = new Set(selectable.map((g) => g.key));
      const next = new Set([...s].filter((k) => keys.has(k)));
      return next.size === s.size ? s : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  function setParam(key: string, value: string) {
    const n = new URLSearchParams(params);
    if (value) n.set(key, value);
    else n.delete(key);
    setParams(n, { replace: true });
  }

  const selectedGroups = selectable.filter((g) => selected.has(g.key));
  const selectedIssueCount = selectedGroups.reduce((s, g) => s + g.openIssueIds.length, 0);
  const allSelected = selectable.length > 0 && selectable.every((g) => selected.has(g.key));
  const someSelected = selected.size > 0 && !allSelected;
  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const courseOptions = (courses.data?.items ?? []).map((c) => ({
    id: c.id,
    title: (c.languageVersions.find((v) => v.language === c.defaultLanguage) ?? c.languageVersions[0])?.title ?? c.id,
  }));

  function run(action: PendingAction, note: string) {
    const ids = action.status === 'OPEN' ? action.groups.flatMap((g) => g.issueIds) : action.groups.flatMap((g) => g.openIssueIds);
    const done = (n: number) => {
      toast(t(`issues.done.${action.status}`, { count: n }), action.status === 'RESOLVED' ? 'teal' : 'brand');
      setPending(null);
      if (action.bulk) setSelected(new Set());
    };
    const fail = (err: unknown) => toast(apiErrorMessage(err, t), 'danger');
    if (action.bulk) bulk.mutate({ ids, status: action.status, note }, { onSuccess: (r) => done(r.updated), onError: fail });
    else setStatus.mutate({ ids, status: action.status, note }, { onSuccess: (r) => done(r.updated), onError: fail });
  }

  const pendingCount = pending ? (pending.status === 'OPEN' ? pending.groups.reduce((s, g) => s + g.issueIds.length, 0) : pending.groups.reduce((s, g) => s + g.openIssueIds.length, 0)) : 0;
  const emptyTitle = status === 'OPEN' ? (origin === 'SYSTEM' ? t('issues.emptyOpenSystem') : t('issues.emptyOpen')) : t('issues.empty');

  return (
    <>
      <PageHeader
        title={t('issues.title')}
        subtitle={
          summary.data
            ? t('issues.subtitleCounts', { open: summary.data.open, system: summary.data.openSystem })
            : t('issues.subtitle')
        }
      />

      {/* Фильтры */}
      <div className="mb-5 space-y-3">
        <Tabs
          ariaLabel={t('issues.statusFilter')}
          value={status}
          onChange={(v) => setParam('status', v === 'OPEN' ? '' : v)}
          tabs={STATUSES.map((s) => ({
            id: s,
            label: t(`issues.statusTab.${s}`),
            badge: s === 'OPEN' && summary.data ? summary.data.open : undefined,
          }))}
        />
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            ariaLabel={t('issues.originFilter')}
            tone="brand"
            value={origin}
            onChange={(v) => setParam('origin', v === 'ALL' ? '' : v)}
            options={[
              { value: 'ALL', label: t('issues.originAll') },
              { value: 'STUDENT', label: t('issues.origin.STUDENT') },
              { value: 'SYSTEM', label: t('issues.origin.SYSTEM') },
            ]}
            className="max-w-full overflow-x-auto"
          />
          <Select aria-label={t('issues.courseFilter')} className="w-full sm:w-64" value={courseId} onChange={(e) => setParam('courseId', e.target.value)}>
            <option value="">{t('issues.allCourses')}</option>
            {courseOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </Select>
          <Select aria-label={t('issues.languageFilter')} className="w-full sm:w-44" value={language} onChange={(e) => setParam('language', e.target.value)}>
            <option value="">{t('issues.allLanguages')}</option>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>{t(`languages.${l}`)}</option>
            ))}
          </Select>
          <Select aria-label={t('issues.targetFilter')} className="w-full sm:w-52" value={targetType ?? ''} onChange={(e) => setParam('targetType', e.target.value)}>
            <option value="">{t('issues.allTargets')}</option>
            {TARGETS.map((x) => (
              <option key={x} value={x}>{t(`issues.target.${x}`)}</option>
            ))}
          </Select>
        </div>
      </div>

      {/* Панель выбора */}
      {selectable.length > 0 && (
        <div
          className={
            selected.size > 0
              ? 'sticky top-[calc(3.75rem+env(safe-area-inset-top,0px))] z-10 mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 shadow-soft lg:top-[4.25rem]'
              : 'mb-3 flex flex-wrap items-center gap-2 px-1'
          }
        >
          <label className="inline-flex cursor-pointer items-center gap-2.5 text-body font-medium text-fg">
            <Checkbox checked={allSelected} indeterminate={someSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((g) => g.key)))} label={t('issues.selectAll')} />
            {selected.size > 0 ? t('issues.selected', { count: selected.size, issues: selectedIssueCount }) : t('issues.selectAll')}
          </label>
          {selected.size > 0 && (
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>{t('issues.clearSelection')}</Button>
              <Button variant="secondary" size="sm" onClick={() => setPending({ status: 'DISMISSED', groups: selectedGroups, bulk: true })}>
                {t('issues.dismiss')}
              </Button>
              <Button size="sm" onClick={() => setPending({ status: 'RESOLVED', groups: selectedGroups, bulk: true })}>
                <Icon name="check" size={16} />
                {t('issues.resolveSelected')}
              </Button>
            </div>
          )}
        </div>
      )}

      {q.isLoading ? (
        <LoadingRows rows={4} />
      ) : q.isError ? (
        <div className="space-y-3 text-center">
          <ErrorState message={apiErrorMessage(q.error, t)} />
          <Button variant="secondary" onClick={() => void q.refetch()}>{t('common.retry')}</Button>
        </div>
      ) : groups.length === 0 ? (
        <EmptyState title={emptyTitle} hint={status === 'OPEN' ? t('issues.emptyHint') : undefined} />
      ) : (
        <>
          <ul className="space-y-3">
            {groups.map((g) => (
              <IssueRow
                key={g.key}
                group={g}
                selected={selected.has(g.key)}
                onToggleSelect={() => toggle(g.key)}
                busy={setStatus.isPending || bulk.isPending}
                onResolve={() => setPending({ status: 'RESOLVED', groups: [g], bulk: false })}
                onDismiss={() => setPending({ status: 'DISMISSED', groups: [g], bulk: false })}
                onReopen={() => setPending({ status: 'OPEN', groups: [g], bulk: false })}
              />
            ))}
          </ul>
          {q.hasNextPage && (
            <div className="mt-5 text-center">
              <Button variant="secondary" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
                {t('issues.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}

      <NoteDialog
        open={!!pending}
        title={pending ? t(`issues.confirm.${pending.status}.title`, { count: pendingCount }) : ''}
        body={pending ? t(`issues.confirm.${pending.status}.body`, { count: pendingCount }) : undefined}
        confirmLabel={pending ? t(`issues.confirm.${pending.status}.action`) : ''}
        tone={pending?.status === 'DISMISSED' ? 'danger' : 'primary'}
        busy={setStatus.isPending || bulk.isPending}
        onCancel={() => setPending(null)}
        onConfirm={(note) => pending && run(pending, note)}
      />
    </>
  );
}
