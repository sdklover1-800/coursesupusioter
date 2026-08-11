import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { Badge, Button, Card, toast } from '../../components/ui';
import { PageHeader, EmptyState, ErrorState, LoadingRows } from '../../components/page';
import type { Role } from '@edu/shared';

/* Типы выгрузок исследовательских данных (FR-R.4). */
const EXPORTS: { type: string; labelKey: string }[] = [
  { type: 'events', labelKey: 'admin.exportEvents' },
  { type: 'sessions', labelKey: 'admin.exportSessions' },
  { type: 'rubric', labelKey: 'admin.exportRubric' },
  { type: 'quiz_attempts', labelKey: 'admin.exportQuiz' },
  { type: 'cohort_summary', labelKey: 'admin.exportCohorts' },
];

interface AuditEntry {
  id: string;
  action: string;
  createdAt: string;
  actor: { name: string; email: string; role: Role };
  targetType: string | null;
  targetId: string | null;
}

/** Экспорт исследовательских данных в CSV + журнал аудита (FR-R.4, NFR-2.9). ADMIN. */
export function ExportPage() {
  const { t } = useTranslation();

  const exportM = useMutation({
    mutationFn: (type: string) => api.download(`/admin/export?type=${type}`, `${type}.csv`),
    onError: (err) => toastError(err, t('errors.generic')),
  });

  const audit = useQuery({
    queryKey: ['audit'],
    queryFn: () => api.get<{ items: AuditEntry[] }>('/admin/audit?limit=100'),
  });

  return (
    <>
      <PageHeader eyebrow="Research" title={t('nav.export')} subtitle={t('admin.export')} />

      {/* ── Секция экспорта ─────────────────────────────── */}
      <section className="mb-10">
        <Card className="mb-4 flex items-start gap-3 border-teal/30 !py-4">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-teal/15 text-teal">◈</span>
          <p className="text-sm text-muted">{t('consent.point2')}</p>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {EXPORTS.map((e) => {
            const busy = exportM.isPending && exportM.variables === e.type;
            return (
              <Card key={e.type} className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">⤓</span>
                  <div className="font-semibold">{t(e.labelKey)}</div>
                </div>
                <code className="font-mono text-xs text-muted">{e.type}.csv</code>
                <Button
                  variant="secondary"
                  className="mt-auto w-full"
                  loading={busy}
                  disabled={exportM.isPending}
                  onClick={() => exportM.mutate(e.type)}
                >
                  {t('common.download')}
                </Button>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ── Секция аудита ───────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">{t('admin.audit')}</h2>
        {audit.isLoading ? (
          <LoadingRows rows={6} />
        ) : audit.isError ? (
          <ErrorState message={(audit.error as ApiError)?.message ?? t('errors.generic')} />
        ) : !audit.data?.items.length ? (
          <EmptyState title={t('common.empty')} />
        ) : (
          <Card className="!p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="px-5 py-3">{t('admin.actor')}</th>
                    <th className="px-5 py-3">{t('admin.action')}</th>
                    <th className="px-5 py-3">Объект</th>
                    <th className="px-5 py-3">{t('admin.when')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {audit.data.items.map((a) => (
                    <tr key={a.id} className="align-top hover:bg-brand-soft/40">
                      <td className="px-5 py-3">
                        <div className="font-semibold text-fg">{a.actor.name}</div>
                        <div className="text-xs text-muted">{a.actor.email}</div>
                        <Badge tone="muted" className="mt-1">{t(`roles.${a.actor.role}`)}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-xs text-fg">{a.action}</span>
                      </td>
                      <td className="px-5 py-3">
                        {a.targetType ? (
                          <span className="font-mono text-xs text-muted">
                            {a.targetType}
                            {a.targetId ? ` · ${a.targetId}` : ''}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 font-mono text-xs tabular-nums text-muted">
                        {new Date(a.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>
    </>
  );
}

function toastError(err: unknown, fallback: string) {
  toast(err instanceof ApiError ? err.message : fallback, 'danger');
}
