import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { formatDate, isApproved, useCancelRequest, useMyCourses, type MyEnrollment } from '../../lib/catalog';
import { Badge, Button, Card, toast } from '../../components/ui';
import { PageHeader, EmptyState, ErrorState, LoadingRows } from '../../components/page';
import { LangBadge, LinkButton, LockIcon, StatusPill } from '../../components/enrollment';

/**
 * «Мои курсы» — прогресс по одобренным курсам (FR-8.2) и статусы заявок:
 * на рассмотрении (можно отменить), отклонённые (можно подать снова).
 */
export function StudentDashboard() {
  const { t } = useTranslation();
  const { data, isLoading, isError, error } = useMyCourses();
  const items = data?.items ?? [];
  const learning = items.filter((e) => isApproved(e.status));
  const requests = items.filter((e) => !isApproved(e.status));

  return (
    <>
      <PageHeader
        eyebrow={t('common.appName')}
        title={t('student.myLearning')}
        subtitle={t('auth.subtitle')}
        action={learning.length > 0 ? <LinkButton to="/catalog" variant="secondary">{t('catalog.navFull')}</LinkButton> : undefined}
      />
      {isLoading ? (
        <LoadingRows />
      ) : isError ? (
        <ErrorState message={error instanceof ApiError ? error.message : t('errors.generic')} />
      ) : !items.length ? (
        <EmptyState
          title={t('requests.emptyStudent')}
          hint={t('requests.emptyStudentHint')}
          action={<LinkButton to="/catalog" className="mt-2">{t('requests.findCourse')} →</LinkButton>}
        />
      ) : (
        // Есть одобренные курсы — они главные, заявки ниже; иначе заявки первыми + подсказка.
        <div className="space-y-10">
          {learning.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {learning.map((e) => <LearningCard key={e.id} e={e} />)}
            </div>
          )}

          {requests.length > 0 && (
            <section aria-labelledby="my-requests">
              <h2 id="my-requests" className="mb-4 font-mono text-xs font-semibold uppercase tracking-wider text-brand">{t('requests.myRequests')}</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {requests.map((e) => <RequestCard key={e.id} e={e} />)}
              </div>
            </section>
          )}

          {learning.length === 0 && (
            <Card className="flex flex-col items-start gap-3 border-dashed !py-5 sm:flex-row sm:items-center">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><LockIcon className="h-5 w-5" /></span>
              <p className="flex-1 text-sm text-muted">{t('requests.noActiveYet')}</p>
              <LinkButton to="/catalog" variant="ghost" size="sm">{t('requests.findCourse')} →</LinkButton>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

function LearningCard({ e }: { e: MyEnrollment }) {
  const { t } = useTranslation();
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <Badge tone="brand">{e.languageVersion.language.toUpperCase()}</Badge>
        {e.status === 'COMPLETED' && <Badge tone="teal">✓ {t('student.completed')}</Badge>}
      </div>
      <h3 className="mt-3 text-lg font-semibold">{e.languageVersion.title}</h3>
      {e.languageVersion.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{e.languageVersion.description}</p>}

      {/* Прогресс-кольцо + процент */}
      <div className="mt-5 flex items-center gap-4">
        <ProgressRing percent={e.progressPercent} />
        <div className="flex-1">
          <div className="text-xs text-muted">{t('student.progress')}</div>
          <div className="font-mono text-lg font-semibold tabular-nums">{e.progressPercent}%</div>
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        <LinkButton to={`/learn/${e.courseId}/${e.id}`} className="flex-1">
          {e.progressPercent > 0 ? t('student.continueCourse') : t('student.start')}
        </LinkButton>
        {e.certificate && (
          <Button variant="spark" aria-label={t('student.downloadCertificate')} onClick={() => api.download(`/me/certificates/${e.id}`, `certificate-${e.certificate!.serialNumber}.pdf`)}>✧</Button>
        )}
      </div>
    </Card>
  );
}

/** Карточка заявки: на рассмотрении — отмена; отклонена/отменена — «Подать снова». */
function RequestCard({ e }: { e: MyEnrollment }) {
  const { t, i18n } = useTranslation();
  const cancel = useCancelRequest();
  const [confirming, setConfirming] = useState(false);
  const pending = e.status === 'PENDING';

  function doCancel() {
    cancel.mutate(e.id, {
      onSuccess: () => toast(t('catalog.cancelled'), 'brand'),
      onError: (err) => toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger'),
    });
  }

  return (
    <Card className={pending ? 'flex flex-col border-spark/40' : 'flex flex-col'}>
      <div className="flex items-start justify-between gap-3">
        <LangBadge lang={e.languageVersion.language} />
        <StatusPill status={e.status} />
      </div>
      <h3 className="mt-3 text-lg font-semibold">
        <Link to={`/catalog/${e.courseId}`} className="rounded hover:text-brand">{e.languageVersion.title}</Link>
      </h3>
      <div className="mt-1 font-mono text-xs text-muted">
        {pending || !e.reviewedAt
          ? t('catalog.requestedOn', { date: formatDate(e.requestedAt, i18n.language) })
          : t('requests.reviewedOn', { date: formatDate(e.reviewedAt, i18n.language) })}
      </div>

      {pending ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-muted">
          <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t('requests.pendingNote')}
        </p>
      ) : e.reviewNote ? (
        <blockquote className="mt-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm leading-relaxed">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('catalog.reviewNote')}</div>
          {e.reviewNote}
        </blockquote>
      ) : null}

      <div className="mt-auto pt-5">
        {pending ? (
          confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto text-sm font-semibold">{t('catalog.cancelConfirm')}</span>
              <Button variant="secondary" size="sm" autoFocus disabled={cancel.isPending} onClick={() => setConfirming(false)}>{t('catalog.keep')}</Button>
              <Button variant="danger" size="sm" loading={cancel.isPending} onClick={doCancel}>{t('catalog.cancelYes')}</Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <LinkButton to={`/catalog/${e.courseId}`} variant="secondary" size="sm">{t('catalog.coursePage')}</LinkButton>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>{t('catalog.cancelRequest')}</Button>
            </div>
          )
        ) : (
          <LinkButton to={`/catalog/${e.courseId}`} size="sm">{t('catalog.applyAgain')} →</LinkButton>
        )}
      </div>
    </Card>
  );
}

function ProgressRing({ percent }: { percent: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" className="-rotate-90">
      <circle cx="28" cy="28" r={r} fill="none" stroke="rgb(var(--border))" strokeWidth="5" />
      <circle cx="28" cy="28" r={r} fill="none" stroke="rgb(var(--brand))" strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (c * percent) / 100} className="transition-all duration-700" />
    </svg>
  );
}
