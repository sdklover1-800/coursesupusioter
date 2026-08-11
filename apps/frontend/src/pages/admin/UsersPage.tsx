import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { api, ApiError } from '../../lib/api';
import { Badge, Button, Card, Field, Input, Select, toast } from '../../components/ui';
import { PageHeader, EmptyState, ErrorState, LoadingRows, StatCard } from '../../components/page';
import { LANGUAGES, Role } from '@edu/shared';

/* ── Типы ответов API ──────────────────────────────────── */
interface PublicUser {
  id: string; email: string; name: string; role: string;
  interfaceLanguage: string; cohortId: string | null;
}
interface UsersResponse { items: PublicUser[]; meta: { total: number; page: number; pages: number } }
interface Cohort { id: string; name: string }
interface CreateUserResponse { user: PublicUser; startPassword: string }
interface ResetResponse { startPassword: string }
interface ImportRow {
  rowNumber: number; email: string; name: string; status: string;
  errors: string[]; startPassword?: string;
}
interface ImportReport { total: number; valid: number; invalid: number; results: ImportRow[] }
interface ImportResponse { applied: boolean; report: ImportReport }

const ROLES = Object.values(Role);
type TabKey = 'list' | 'create' | 'import';
type Credential = { email: string; password: string };

const roleTone = (role: string): 'brand' | 'teal' | 'spark' =>
  role === 'ADMIN' ? 'spark' : role === 'COURSE_MANAGER' ? 'teal' : 'brand';

/** Управление пользователями + импорт CSV/Excel (FR-1.2–1.4, §11.1). ADMIN. */
export function UsersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [tab, setTab] = useState<TabKey>('list');
  const [credential, setCredential] = useState<Credential | null>(null);
  const fail = (err: unknown) => toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger');

  /* ── Список пользователей ────────────────────────────── */
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);

  const users = useQuery({
    queryKey: ['users', q, role, page],
    queryFn: () =>
      api.get<UsersResponse>(
        `/admin/users?page=${page}&q=${encodeURIComponent(q)}${role ? `&role=${role}` : ''}`,
      ),
  });
  const cohorts = useQuery({
    queryKey: ['cohorts'],
    queryFn: () => api.get<{ items: Cohort[] }>('/admin/cohorts'),
  });
  const cohortList = cohorts.data?.items ?? [];
  const cohortName = (id: string | null) => (id ? cohortList.find((c) => c.id === id)?.name ?? id : '—');

  const resetM = useMutation({
    mutationFn: (id: string) => api.patch<ResetResponse>(`/admin/users/${id}`, { resetPassword: true }),
    onError: fail,
  });
  const updateM = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api.patch<PublicUser>(`/admin/users/${id}`, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast(t('common.success'), 'teal'); },
    onError: fail,
  });

  const doReset = (u: PublicUser) =>
    resetM.mutate(u.id, { onSuccess: (r) => setCredential({ email: u.email, password: r.startPassword }) });

  /* ── Создание пользователя ───────────────────────────── */
  const empty = { email: '', name: '', role: 'STUDENT', interfaceLanguage: 'ru', cohortId: '' };
  const [form, setForm] = useState(empty);
  const createM = useMutation({
    mutationFn: () =>
      api.post<CreateUserResponse>('/admin/users', {
        email: form.email.trim(),
        name: form.name.trim(),
        role: form.role,
        interfaceLanguage: form.interfaceLanguage,
        cohortId: form.cohortId || null,
      }),
    onSuccess: (r) => {
      setCredential({ email: r.user.email, password: r.startPassword });
      qc.invalidateQueries({ queryKey: ['users'] });
      setForm(empty);
      toast(t('common.success'), 'teal');
    },
    onError: fail,
  });

  /* ── Импорт CSV/Excel ────────────────────────────────── */
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [applied, setApplied] = useState<ImportReport | null>(null);

  const pickFile = (f: File | null) => { setFile(f); setPreview(null); setApplied(null); };
  const buildForm = (f: File, apply: boolean) => {
    const fd = new FormData();
    fd.append('file', f);
    if (apply) fd.append('apply', 'true');
    return fd;
  };
  const previewM = useMutation({
    mutationFn: (f: File) => api.postForm<ImportResponse>('/admin/users/import', buildForm(f, false)),
    onSuccess: (r) => { setPreview(r.report); setApplied(null); },
    onError: fail,
  });
  const applyM = useMutation({
    mutationFn: (f: File) => api.postForm<ImportResponse>('/admin/users/import', buildForm(f, true)),
    onSuccess: (r) => {
      setApplied(r.report);
      qc.invalidateQueries({ queryKey: ['users'] });
      toast(t('common.success'), 'teal');
    },
    onError: fail,
  });

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'list', label: t('admin.users') },
    { key: 'create', label: t('admin.createUser') },
    { key: 'import', label: t('admin.import') },
  ];

  return (
    <>
      <PageHeader eyebrow="Admin" title={t('nav.users')} subtitle={t('admin.users')} />

      {/* Стартовый пароль — показывается один раз */}
      {credential && (
        <Card className="mb-6 border-spark/60 bg-spark/5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-spark">{t('admin.startPassword')}</div>
              <div className="mt-1 text-sm text-muted">{credential.email}</div>
              <div className="mt-2 font-mono text-xl font-semibold tabular-nums text-fg">{credential.password}</div>
              <div className="mt-1 text-xs text-muted">{t('admin.startPasswordNote')}</div>
            </div>
            <Button variant="secondary" onClick={() => setCredential(null)}>{t('common.close')}</Button>
          </div>
        </Card>
      )}

      {/* Табы секций */}
      <div className="mb-6 flex flex-wrap gap-2">
        {tabs.map((tb) => (
          <Button key={tb.key} variant={tab === tb.key ? 'primary' : 'ghost'} onClick={() => setTab(tb.key)}>
            {tb.label}
          </Button>
        ))}
      </div>

      {tab === 'list' && (
        <section className="space-y-4">
          <Card className="!py-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Input
                value={q}
                placeholder={t('common.search')}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
              />
              <Select
                className="sm:w-52"
                value={role}
                onChange={(e) => { setRole(e.target.value); setPage(1); }}
              >
                <option value="">{t('common.all')}</option>
                {ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
              </Select>
            </div>
          </Card>

          {users.isLoading ? (
            <LoadingRows rows={6} />
          ) : users.isError ? (
            <ErrorState message={(users.error as ApiError)?.message ?? t('errors.generic')} />
          ) : !users.data?.items.length ? (
            <EmptyState title={t('common.empty')} hint={t('student.noCourses')} />
          ) : (
            <Card className="!p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                      <th className="px-5 py-3">{t('admin.name')}</th>
                      <th className="px-5 py-3">{t('admin.role')}</th>
                      <th className="px-5 py-3">{t('admin.cohort')}</th>
                      <th className="px-5 py-3">{t('common.language')}</th>
                      <th className="px-5 py-3 text-right">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {users.data.items.map((u) => {
                      const busy = updateM.isPending && updateM.variables?.id === u.id;
                      return (
                        <tr key={u.id} className="align-middle hover:bg-brand-soft/40">
                          <td className="px-5 py-3">
                            <div className="font-semibold text-fg">{u.name}</div>
                            <div className="text-xs text-muted">{u.email}</div>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <Badge tone={roleTone(u.role)}>{t(`roles.${u.role}`)}</Badge>
                              <Select
                                className="h-9 w-40 py-1 text-xs"
                                value={u.role}
                                disabled={busy}
                                onChange={(e) => updateM.mutate({ id: u.id, patch: { role: e.target.value } })}
                              >
                                {ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                              </Select>
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            <Select
                              className="h-9 w-44 py-1 text-xs"
                              value={u.cohortId ?? ''}
                              disabled={busy || cohorts.isLoading}
                              onChange={(e) => updateM.mutate({ id: u.id, patch: { cohortId: e.target.value || null } })}
                            >
                              <option value="">—</option>
                              {cohortList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </Select>
                          </td>
                          <td className="px-5 py-3 font-mono text-xs uppercase tabular-nums text-muted">{u.interfaceLanguage}</td>
                          <td className="px-5 py-3 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              loading={resetM.isPending && resetM.variables === u.id}
                              onClick={() => doReset(u)}
                            >
                              {t('admin.resetPassword')}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Пагинация */}
              <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
                <span className="font-mono text-xs tabular-nums text-muted">
                  {users.data.meta.page} {t('common.of')} {users.data.meta.pages} · {users.data.meta.total}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="secondary" size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    ← {t('common.prev')}
                  </Button>
                  <Button
                    variant="secondary" size="sm"
                    disabled={page >= users.data.meta.pages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t('common.next')} →
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </section>
      )}

      {tab === 'create' && (
        <Card className="max-w-2xl">
          <h2 className="mb-5 text-lg font-semibold">{t('admin.createUser')}</h2>
          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); createM.mutate(); }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('auth.email')}>
                <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label={t('admin.name')}>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label={t('admin.role')}>
                <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                </Select>
              </Field>
              <Field label={t('admin.interfaceLanguage')}>
                <Select value={form.interfaceLanguage} onChange={(e) => setForm({ ...form, interfaceLanguage: e.target.value })}>
                  {LANGUAGES.map((l) => <option key={l} value={l}>{t(`languages.${l}`)}</option>)}
                </Select>
              </Field>
              <Field label={t('admin.cohort')} hint={t('common.empty')}>
                <Select value={form.cohortId} disabled={cohorts.isLoading} onChange={(e) => setForm({ ...form, cohortId: e.target.value })}>
                  <option value="">—</option>
                  {cohortList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" loading={createM.isPending} disabled={!form.email.trim() || !form.name.trim()}>
                {t('common.create')}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {tab === 'import' && (
        <section className="space-y-4">
          <Card>
            <h2 className="mb-1 text-lg font-semibold">{t('admin.import')}</h2>
            <p className="mb-4 text-sm text-muted">{t('admin.importFile')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="file"
                accept=".csv,.xlsx"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                className="block max-w-full text-sm text-muted file:mr-4 file:cursor-pointer file:rounded-xl file:border-0 file:bg-brand-soft file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-brand hover:file:brightness-105"
              />
              <Button
                variant="secondary"
                disabled={!file}
                loading={previewM.isPending}
                onClick={() => file && previewM.mutate(file)}
              >
                {t('admin.importPreview')}
              </Button>
              <Button
                variant="spark"
                disabled={!file || !preview}
                loading={applyM.isPending}
                onClick={() => file && applyM.mutate(file)}
              >
                {t('admin.importApply')}
              </Button>
            </div>
          </Card>

          {(applied ?? preview) && <ImportReportView report={(applied ?? preview)!} applied={!!applied} t={t} />}
        </section>
      )}
    </>
  );
}

/* ── Отчёт об импорте ──────────────────────────────────── */
function ImportReportView({ report, applied, t }: { report: ImportReport; applied: boolean; t: (k: string) => string }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t('common.status')} value={report.total} hint={t('admin.importReport')} tone="brand" />
        <StatCard label={t('admin.rowsValid')} value={report.valid} tone="teal" />
        <StatCard label={t('admin.rowsInvalid')} value={report.invalid} tone="danger" />
      </div>

      <Card className="!p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-5 py-3">#</th>
                <th className="px-5 py-3">{t('auth.email')}</th>
                <th className="px-5 py-3">{t('admin.name')}</th>
                <th className="px-5 py-3">{t('common.status')}</th>
                {applied && <th className="px-5 py-3">{t('admin.startPassword')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.results.map((r) => {
                const bad = r.errors.length > 0;
                return (
                  <tr key={r.rowNumber} className={clsx('align-top', bad ? 'bg-danger/5' : 'hover:bg-brand-soft/40')}>
                    <td className="px-5 py-3 font-mono text-xs tabular-nums text-muted">{r.rowNumber}</td>
                    <td className="px-5 py-3">{r.email || '—'}</td>
                    <td className="px-5 py-3">{r.name || '—'}</td>
                    <td className="px-5 py-3">
                      <Badge tone={bad ? 'danger' : 'teal'}>{r.status}</Badge>
                      {bad && (
                        <ul className="mt-1 space-y-0.5 text-xs text-danger">
                          {r.errors.map((err, i) => <li key={i}>· {err}</li>)}
                        </ul>
                      )}
                    </td>
                    {applied && (
                      <td className="px-5 py-3 font-mono text-xs tabular-nums text-fg">{r.startPassword ?? '—'}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
