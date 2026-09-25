import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { Role } from '@edu/shared';
import { apiErrorMessage } from '../../lib/staff';
import { useFormat } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import {
  consentState, relativeTime, useAdminCohorts, useAdminUsers, useConsentVersion, useResetPassword,
  type AdminCohort, type AdminUser, type ConsentState, type UsersFilter,
} from '../../lib/staffAdmin';
import { Badge, Button, ConfirmDialog, Field, Icon, Input, Select, TabPanel, Tabs, toast } from '../../components/ui';
import { EmptyState, LoadingRows, PageHeader } from '../../components/page';
import { LoadError } from '../../components/staff/primitives';
import { SelfRegisteredChip } from '../../components/enrollment';
import { ConsentMark, EmailText, RoleBadge, Th, conditionLabel } from '../../components/staff/admin/bits';
import { FilterPopover } from '../../components/staff/admin/FilterPopover';
import { RowMenu } from '../../components/staff/admin/RowMenu';
import { CredentialDialog, type Credential } from '../../components/staff/admin/CredentialDialog';
import { UserEditSheet } from '../../components/staff/admin/UserEditSheet';
import { UserCreateSheet } from '../../components/staff/admin/UserCreateSheet';
import { ImportPanel } from '../../components/staff/admin/ImportPanel';

const ROLES = Object.values(Role);
const CONSENT_STATES: ConsentState[] = ['given', 'outdated', 'missing'];
type TabKey = 'list' | 'import';

/**
 * Пользователи (FR-1.2–1.4, FE5 §6). ADMIN.
 * Список — только чтение (имя, email, роль один раз, когорта, согласие, активность) и меню «⋮»;
 * правка — в листе с подтверждением последствий; импорт — двухшаговый.
 * Фильтры живут в адресе (?q&role&cohort&consent&page&tab): «Когорты» ссылаются сюда с ?cohort=.
 */
export function UsersPage() {
  const { t } = useTranslation();
  const { lng, formatDate } = useFormat();
  useDocumentTitle(t('nav.users'));

  const [params, setParams] = useSearchParams();
  const tab: TabKey = params.get('tab') === 'import' ? 'import' : 'list';
  const filter: UsersFilter = {
    q: params.get('q') ?? '',
    role: (ROLES as string[]).includes(params.get('role') ?? '') ? (params.get('role') as Role) : '',
    cohortId: params.get('cohort') ?? '',
    consent: (CONSENT_STATES as string[]).includes(params.get('consent') ?? '') ? (params.get('consent') as ConsentState) : '',
    page: Math.max(1, Number(params.get('page')) || 1),
  };
  const setParam = (patch: Record<string, string | number | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '' || (k === 'page' && v === 1)) next.delete(k);
      else next.set(k, String(v));
    }
    if (resetPage && !('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  // Поиск — с задержкой, чтобы не дёргать API на каждую букву
  const [qInput, setQInput] = useState(filter.q);
  useEffect(() => {
    if (qInput.trim() === filter.q) return;
    const id = setTimeout(() => setParam({ q: qInput.trim() || null }), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  const users = useAdminUsers(filter);
  const cohortsQ = useAdminCohorts();
  const consentQ = useConsentVersion();
  const cohorts = useMemo(() => cohortsQ.data?.items ?? [], [cohortsQ.data]);
  const cohortById = useMemo(() => new Map(cohorts.map((c) => [c.id, c])), [cohorts]);
  const consentVersion = consentQ.data?.version;

  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [credential, setCredential] = useState<Credential | null>(null);
  const [resetUser, setResetUser] = useState<AdminUser | null>(null);
  const resetM = useResetPassword();

  const doReset = () => {
    if (!resetUser) return;
    const u = resetUser;
    resetM.mutate(u.id, {
      onSuccess: (r) => {
        setResetUser(null);
        setCredential({ email: u.email, password: r.startPassword });
      },
      onError: (err) => {
        setResetUser(null);
        toast(apiErrorMessage(err, t), 'danger');
      },
    });
  };

  // Активные фильтры — чипы с кнопкой «убрать»
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (filter.role) chips.push({ key: 'role', label: `${t('admin.usersPage.filterRole')}: ${t(`roles.${filter.role}`)}`, clear: () => setParam({ role: null }) });
  if (filter.cohortId) {
    const c = cohortById.get(filter.cohortId);
    chips.push({ key: 'cohort', label: `${t('admin.usersPage.filterCohort')}: ${c?.name ?? '…'}`, clear: () => setParam({ cohort: null }) });
  }
  if (filter.consent) chips.push({ key: 'consent', label: `${t('admin.usersPage.filterConsent')}: ${t(`admin.consent.filter.${filter.consent}`)}`, clear: () => setParam({ consent: null }) });
  const resetFilters = () => setParam({ role: null, cohort: null, consent: null });

  const meta = users.data?.meta;
  const items = users.data?.items ?? [];

  return (
    <>
      <PageHeader eyebrow={t('admin.eyebrow')} title={t('nav.users')} subtitle={t('admin.usersPage.subtitle')} />

      <Tabs<TabKey>
        idPrefix="users"
        ariaLabel={t('admin.usersPage.sections')}
        value={tab}
        onChange={(id) => setParam({ tab: id === 'list' ? null : id }, false)}
        tabs={[
          { id: 'list', label: t('admin.usersPage.tabList'), badge: meta ? meta.total : undefined },
          { id: 'import', label: t('admin.usersPage.tabImport') },
        ]}
        className="mb-6"
      />

      {tab === 'list' && (
        <TabPanel idPrefix="users" id="list" className="space-y-4">
          {/* Тулбар: поиск · «Фильтры» · «Добавить пользователя» */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Icon name="search" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-2" />
              <Input
                type="search"
                value={qInput}
                aria-label={t('admin.usersPage.search')}
                placeholder={t('admin.usersPage.searchPlaceholder')}
                onChange={(e) => setQInput(e.target.value)}
                className="!pl-10"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterPopover count={chips.length} onReset={resetFilters}>
                <Field label={t('admin.usersPage.filterRole')}>
                  <Select value={filter.role} onChange={(e) => setParam({ role: e.target.value || null })}>
                    <option value="">{t('admin.usersPage.anyRole')}</option>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {t(`roles.${r}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('admin.usersPage.filterCohort')}>
                  <Select value={filter.cohortId} onChange={(e) => setParam({ cohort: e.target.value || null })}>
                    <option value="">{t('admin.usersPage.anyCohort')}</option>
                    {cohorts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('admin.usersPage.filterConsent')}>
                  <Select value={filter.consent} onChange={(e) => setParam({ consent: e.target.value || null })}>
                    <option value="">{t('admin.usersPage.anyConsent')}</option>
                    {CONSENT_STATES.map((s) => (
                      <option key={s} value={s}>
                        {t(`admin.consent.filter.${s}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </FilterPopover>
              <Button onClick={() => setCreateOpen(true)} className="whitespace-nowrap">
                <Icon name="plus" size={18} />
                {t('admin.usersPage.add')}
              </Button>
            </div>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={c.clear}
                  aria-label={t('admin.usersPage.removeFilter', { label: c.label })}
                  className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-full border border-brand/30 bg-brand-soft px-3 text-sm font-medium text-fg transition-colors hover:border-brand"
                >
                  {c.label}
                  <Icon name="x" size={14} className="text-fg-2" />
                </button>
              ))}
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                {t('admin.resetFilters')}
              </Button>
            </div>
          )}

          {users.isLoading ? (
            <LoadingRows rows={6} />
          ) : users.isError ? (
            <LoadError error={users.error} onRetry={() => void users.refetch()} retrying={users.isFetching} />
          ) : !items.length ? (
            <EmptyState
              title={t('admin.usersPage.empty')}
              hint={t('admin.usersPage.emptyHint')}
              action={
                chips.length || filter.q ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQInput('');
                      setParam({ role: null, cohort: null, consent: null, q: null });
                    }}
                  >
                    {t('admin.resetFilters')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className={clsx('space-y-4 transition-opacity', users.isPlaceholderData && 'opacity-60')}>
              {/* Десктоп: таблица только для чтения; прокрутка — внутри контейнера */}
              <div className="card hidden overflow-hidden !p-0 lg:block">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-body">
                    <thead className="border-b border-border">
                      <tr>
                        <Th>{t('admin.usersPage.colUser')}</Th>
                        <Th>{t('admin.usersPage.colRole')}</Th>
                        <Th>{t('admin.usersPage.colCohort')}</Th>
                        <Th>{t('admin.usersPage.colConsent')}</Th>
                        <Th>{t('admin.usersPage.colActivity')}</Th>
                        <Th className="w-14">
                          <span className="sr-only">{t('common.actions')}</span>
                        </Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {items.map((u) => (
                        <UserRow
                          key={u.id}
                          user={u}
                          cohort={u.cohortId ? cohortById.get(u.cohortId) : undefined}
                          consent={consentState(u, consentVersion)}
                          activity={relativeTime(t, u.lastActivityAt, lng)}
                          activityTitle={u.lastActivityAt ? formatDate(u.lastActivityAt, 'datetime') : undefined}
                          onEdit={() => setEditing(u)}
                          onReset={() => setResetUser(u)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Мобильные и планшет: карточки */}
              <ul className="grid gap-3 md:grid-cols-2 lg:hidden">
                {items.map((u) => (
                  <UserCard
                    key={u.id}
                    user={u}
                    cohort={u.cohortId ? cohortById.get(u.cohortId) : undefined}
                    consent={consentState(u, consentVersion)}
                    activity={relativeTime(t, u.lastActivityAt, lng)}
                    onEdit={() => setEditing(u)}
                    onReset={() => setResetUser(u)}
                  />
                ))}
              </ul>

              {meta && (
                <nav aria-label={t('admin.usersPage.page', { page: meta.page, pages: Math.max(1, meta.pages) })} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-meta text-fg-2">
                    {t('admin.usersPage.total', { count: meta.total })} · {t('admin.usersPage.page', { page: meta.page, pages: Math.max(1, meta.pages) })}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" disabled={meta.page <= 1} onClick={() => setParam({ page: meta.page - 1 }, false)}>
                      <Icon name="chevron-left" size={16} />
                      {t('common.prev')}
                    </Button>
                    <Button variant="secondary" size="sm" disabled={meta.page >= meta.pages} onClick={() => setParam({ page: meta.page + 1 }, false)}>
                      {t('common.next')}
                      <Icon name="chevron-right" size={16} />
                    </Button>
                  </div>
                </nav>
              )}
            </div>
          )}
        </TabPanel>
      )}

      {tab === 'import' && (
        <TabPanel idPrefix="users" id="import">
          <ImportPanel cohorts={cohorts} />
        </TabPanel>
      )}

      {editing && (
        <UserEditSheet
          key={editing.id}
          user={editing}
          cohorts={cohorts}
          consentVersion={consentVersion}
          onClose={() => setEditing(null)}
          onResetPassword={(u) => setResetUser(u)}
        />
      )}
      <UserCreateSheet open={createOpen} cohorts={cohorts} onClose={() => setCreateOpen(false)} onCreated={setCredential} />

      <ConfirmDialog
        open={!!resetUser}
        title={t('admin.confirm.resetTitle')}
        body={resetUser ? t('admin.confirm.resetBody', { name: resetUser.name }) : undefined}
        tone="danger"
        busy={resetM.isPending}
        confirmLabel={t('admin.confirm.resetConfirm')}
        onCancel={() => setResetUser(null)}
        onConfirm={doReset}
      />
      <CredentialDialog credential={credential} onClose={() => setCredential(null)} />
    </>
  );
}

interface RowProps {
  user: AdminUser;
  cohort: AdminCohort | undefined;
  consent: ConsentState;
  activity: string;
  activityTitle?: string;
  onEdit: () => void;
  onReset: () => void;
}

function useRowMenu(user: AdminUser, onEdit: () => void, onReset: () => void) {
  const { t } = useTranslation();
  return {
    label: t('admin.usersPage.rowMenu', { name: user.name }),
    items: [
      { key: 'edit', label: t('admin.usersPage.edit'), icon: 'pencil' as const, onSelect: onEdit },
      { key: 'reset', label: t('admin.resetPassword'), icon: 'refresh' as const, onSelect: onReset },
    ],
  };
}

/** Имя — кнопка «Изменить» (быстрый доступ), рядом — метки саморегистрации и отключения. */
function UserName({ user, onEdit, className }: { user: AdminUser; onEdit: () => void; className?: string }) {
  return (
    <button type="button" onClick={onEdit} className={clsx('text-left font-semibold text-fg underline-offset-4 hover:text-brand hover:underline', className)}>
      {user.name}
    </button>
  );
}

function UserFlags({ user }: { user: AdminUser }) {
  const { t } = useTranslation();
  if (!user.selfRegisteredAt && user.isActive) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {!user.isActive && (
        <Badge tone="danger">
          <Icon name="lock" size={13} strokeWidth={2} />
          {t('admin.usersPage.inactive')}
        </Badge>
      )}
      {user.selfRegisteredAt && <SelfRegisteredChip />}
    </div>
  );
}

function CohortCell({ cohort }: { cohort: AdminCohort | undefined }) {
  const { t } = useTranslation();
  if (!cohort) return <span className="text-fg-2">{t('admin.noCohort')}</span>;
  return (
    <div className="min-w-0">
      <div className="text-fg">{cohort.name}</div>
      <div className="text-meta text-fg-2">{conditionLabel(t, cohort.condition)}</div>
    </div>
  );
}

function UserRow({ user, cohort, consent, activity, activityTitle, onEdit, onReset }: RowProps) {
  const menu = useRowMenu(user, onEdit, onReset);
  return (
    <tr className="align-top transition-colors hover:bg-brand-soft/30">
      <td className="min-w-[14rem] px-4 py-3">
        <UserName user={user} onEdit={onEdit} />
        <EmailText email={user.email} className="block text-meta text-fg-2" />
        <UserFlags user={user} />
      </td>
      <td className="px-4 py-3">
        <RoleBadge role={user.role} />
      </td>
      <td className="px-4 py-3">
        <CohortCell cohort={cohort} />
      </td>
      <td className="px-4 py-3">
        <ConsentMark state={consent} version={user.researchConsentVersion} />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-fg-2" title={activityTitle}>
        {activity}
      </td>
      <td className="px-2 py-2 text-right">
        <RowMenu label={menu.label} items={menu.items} />
      </td>
    </tr>
  );
}

function UserCard({ user, cohort, consent, activity, onEdit, onReset }: RowProps) {
  const { t } = useTranslation();
  const menu = useRowMenu(user, onEdit, onReset);
  return (
    <li className="card flex items-start gap-3 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <UserName user={user} onEdit={onEdit} className="text-title" />
        </div>
        <EmailText email={user.email} className="block text-meta text-fg-2" />
        <div className="mt-2 text-meta text-fg-2">
          {cohort ? `${cohort.name} · ${conditionLabel(t, cohort.condition)}` : t('admin.noCohort')} · {t('admin.usersPage.activity', { value: activity })}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <RoleBadge role={user.role} />
          <span className="inline-flex items-center gap-1.5 text-body">
            <span className="text-fg-2">{t('admin.usersPage.colConsent')}:</span>
            <ConsentMark state={consent} version={user.researchConsentVersion} compact />
          </span>
        </div>
        <UserFlags user={user} />
      </div>
      <RowMenu label={menu.label} items={menu.items} className="-mr-1 -mt-1" />
    </li>
  );
}
