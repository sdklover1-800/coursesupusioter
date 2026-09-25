import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { ApiError } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import {
  consentState, useAdminCohorts, useCohortMembers, useConsentVersion, useLogTeacherSession, useTeacherSessions,
  type AdminCohort,
} from '../../lib/staffAdmin';
import { Button, Card, Field, Icon, Input, buttonClass, toast } from '../../components/ui';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '../../components/page';
import { ConditionBadge, ConsentMark, EmailText, RoleBadge, SectionTitle } from '../../components/staff/admin/bits';
import { CohortFormSheet } from '../../components/staff/admin/CohortFormSheet';

/**
 * Когорты — группы эксперимента (FR-R.1, FR-R.9, FE5 §7). ADMIN.
 * Одноколоночный список слева и панель выбранной когорты справа (на мобильных — переход
 * «список → когорта» с кнопкой назад). Подписи условий — только t('conditions.*'), тоны — lib/tones.
 * Выбранная когорта — в адресе (?id=).
 */
export function CohortsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.cohorts'));
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('id');
  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('id', id);
    else next.delete('id');
    setParams(next, { replace: true });
  };

  const cohortsQ = useAdminCohorts();
  const cohorts = cohortsQ.data?.items ?? [];
  const selected = cohorts.find((c) => c.id === selectedId) ?? null;

  // Лист правки: undefined — закрыт, null — создание, когорта — правка
  const [sheet, setSheet] = useState<AdminCohort | null | undefined>(undefined);

  return (
    <>
      <PageHeader
        eyebrow={t('admin.eyebrow')}
        title={t('nav.cohorts')}
        subtitle={t('admin.cohortsPage.subtitle')}
        action={
          <Button onClick={() => setSheet(null)} className="whitespace-nowrap">
            <Icon name="plus" size={18} />
            {t('admin.createCohort')}
          </Button>
        }
      />

      {cohortsQ.isLoading ? (
        <LoadingRows rows={3} />
      ) : cohortsQ.isError ? (
        <ErrorState message={(cohortsQ.error as ApiError)?.message ?? t('errors.generic')} />
      ) : !cohorts.length ? (
        <EmptyState
          title={t('admin.cohortsPage.empty')}
          hint={t('admin.cohortsPage.emptyHint')}
          action={<Button onClick={() => setSheet(null)}>{t('admin.createCohort')}</Button>}
        />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          {/* Список (на мобильных скрыт, пока открыта когорта) */}
          <nav aria-label={t('admin.cohortsPage.list')} className={clsx(selected && 'hidden lg:block')}>
            <ul className="space-y-2">
              {cohorts.map((c) => {
                const active = c.id === selectedId;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => select(c.id)}
                      aria-current={active ? 'true' : undefined}
                      className={clsx(
                        'card flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors',
                        active ? '!border-brand bg-brand-soft/40 ring-1 ring-inset ring-brand/40' : 'hover:border-brand/40',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-base font-semibold text-fg">{c.name}</div>
                        <div className="mt-0.5 text-meta text-fg-2">
                          {t('admin.cohortsPage.students', { count: c._count.users })} · {t('admin.cohortsPage.sessions', { count: c._count.teacherSessions })}
                        </div>
                        <ConditionBadge condition={c.condition} className="mt-2" />
                      </div>
                      <Icon name="chevron-right" size={18} className={clsx('mt-1', active ? 'text-brand' : 'text-fg-2')} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Панель когорты / подсказка «Выберите когорту» */}
          {selected ? (
            <CohortDetail key={selected.id} cohort={selected} onBack={() => select(null)} onEdit={() => setSheet(selected)} />
          ) : (
            <Card className="hidden flex-col items-center justify-center gap-3 py-16 text-center lg:flex">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand">
                <Icon name="users" size={24} />
              </span>
              <div className="text-base font-semibold text-fg">{t('admin.cohortsPage.select')}</div>
              <p className="max-w-sm text-body text-fg-2">{t('admin.cohortsPage.selectHint')}</p>
            </Card>
          )}
        </div>
      )}

      {sheet !== undefined && (
        <CohortFormSheet
          key={sheet?.id ?? 'new'}
          cohort={sheet}
          onClose={() => setSheet(undefined)}
          onSaved={(c) => select(c.id)}
        />
      )}
    </>
  );
}

function CohortDetail({ cohort, onBack, onEdit }: { cohort: AdminCohort; onBack: () => void; onEdit: () => void }) {
  const { t } = useTranslation();
  const { formatDate } = useFormat();
  const members = useCohortMembers(cohort.id);
  const consentQ = useConsentVersion();
  const ref = useRef<HTMLElement>(null);

  // На мобильных панель открывается вместо списка — переводим к ней фокус/прокрутку
  useEffect(() => {
    if (window.matchMedia('(max-width: 1023px)').matches) ref.current?.scrollIntoView({ block: 'start' });
  }, []);

  const memberItems = members.data?.items ?? [];
  const total = members.data?.meta.total ?? cohort._count.users;

  return (
    <section ref={ref} aria-label={t('admin.cohortsPage.detail', { name: cohort.name })} className="flex min-w-0 flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 rounded-md py-1 text-sm font-medium text-fg-2 hover:text-fg lg:hidden"
      >
        <Icon name="chevron-left" size={16} />
        {t('admin.cohortsPage.back')}
      </button>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-display-lg text-fg">{cohort.name}</h2>
            <div className="mt-1 text-meta text-fg-2">{t('admin.cohortsPage.createdAt', { date: formatDate(cohort.createdAt) })}</div>
          </div>
          <Button variant="secondary" size="sm" onClick={onEdit}>
            <Icon name="pencil" size={16} />
            {t('admin.cohortsPage.edit')}
          </Button>
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-label text-fg-2">{t('admin.condition')}</dt>
            <dd className="mt-1.5">
              <ConditionBadge condition={cohort.condition} />
            </dd>
          </div>
          <div>
            <dt className="text-label text-fg-2">{t('admin.cohortsPage.membersCount')}</dt>
            <dd className="mt-1 font-display text-display-md tabular-nums text-fg">{cohort._count.users}</dd>
          </div>
          <div>
            <dt className="text-label text-fg-2">{t('admin.teacherSessions')}</dt>
            <dd className="mt-1 font-display text-display-md tabular-nums text-fg">{cohort._count.teacherSessions}</dd>
          </div>
        </dl>

        <div className="mt-5 border-t border-border pt-4">
          <div className="text-label text-fg-2">{t('admin.description')}</div>
          <p className={clsx('mt-1 max-w-[62ch] text-body', cohort.description ? 'text-fg' : 'text-fg-2')}>
            {cohort.description || t('admin.cohortsPage.noDescription')}
          </p>
        </div>
      </Card>

      {/* Состав когорты */}
      <Card>
        <SectionTitle
          action={
            <Link to={`/admin/users?cohort=${encodeURIComponent(cohort.id)}`} className={buttonClass('ghost', 'sm')}>
              {t('admin.cohortsPage.openInUsers')}
              <Icon name="arrow-right" size={16} />
            </Link>
          }
        >
          {t('admin.cohortsPage.members')}
        </SectionTitle>
        {members.isLoading ? (
          <LoadingRows rows={3} />
        ) : members.isError ? (
          <ErrorState message={(members.error as ApiError)?.message ?? t('errors.generic')} />
        ) : !memberItems.length ? (
          <p className="text-body text-fg-2">{t('admin.cohortsPage.membersEmpty')}</p>
        ) : (
          <>
            <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto">
              {memberItems.map((u) => (
                <li key={u.id} className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-fg">{u.name}</div>
                    <EmailText email={u.email} className="block text-meta text-fg-2" />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body">
                    {u.role !== 'STUDENT' && <RoleBadge role={u.role} />}
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-fg-2">{t('admin.usersPage.colConsent')}:</span>
                      <ConsentMark state={consentState(u, consentQ.data?.version)} compact />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            {total > memberItems.length && (
              <p className="mt-3 text-meta text-fg-2">{t('admin.cohortsPage.membersMore', { shown: memberItems.length, total })}</p>
            )}
          </>
        )}
      </Card>

      <TeacherSessionsCard cohort={cohort} />
    </section>
  );
}

/** Занятия с преподавателем (FR-R.9): список и регистрация нового занятия. */
function TeacherSessionsCard({ cohort }: { cohort: AdminCohort }) {
  const { t } = useTranslation();
  const { formatDate } = useFormat();
  const sessions = useTeacherSessions(cohort.id);
  const logM = useLogTeacherSession();
  const [topic, setTopic] = useState('');
  const [date, setDate] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || !date) return;
    logM.mutate(
      { cohortId: cohort.id, topic: topic.trim(), date },
      {
        onSuccess: () => {
          setTopic('');
          setDate('');
          toast(t('admin.cohortsPage.sessionLogged'), 'teal');
        },
        onError: (err) => toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger'),
      },
    );
  };

  const items = sessions.data?.items ?? [];
  return (
    <Card>
      <SectionTitle>{t('admin.cohortsPage.sessionsTitle')}</SectionTitle>
      <p className="-mt-1 mb-4 max-w-[62ch] text-body text-fg-2">{t('admin.cohortsPage.sessionsHint')}</p>

      {sessions.isLoading ? (
        <LoadingRows rows={2} />
      ) : !items.length ? (
        <p className="text-body text-fg-2">{t('admin.cohortsPage.sessionsEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((s) => (
            <li key={s.id} className="flex items-start gap-3 py-2.5">
              <Icon name="clock" size={18} className="mt-0.5 text-fg-2" />
              <span className="min-w-0 flex-1 text-body font-medium text-fg">{s.topic}</span>
              <span className="whitespace-nowrap text-meta text-fg-2">{formatDate(s.date)}</span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end">
        <Field label={t('admin.topic')}>
          <Input value={topic} onChange={(e) => setTopic(e.target.value)} required />
        </Field>
        <Field label={t('admin.date')}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Button type="submit" variant="secondary" loading={logM.isPending} disabled={!topic.trim() || !date} className="whitespace-nowrap">
          {t('admin.logTeacherSession')}
        </Button>
      </form>
    </Card>
  );
}
