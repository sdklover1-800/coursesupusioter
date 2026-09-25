import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { isApproved, useCancelRequest, useMyCourses, type MyEnrollment } from '../../lib/catalog';
import { routes, useLearnView } from '../../lib/learn';
import { useFormat } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { Badge, Button, Card, Icon, Skeleton, StatusIcon, toast } from '../../components/ui';
import type { Tone } from '../../lib/tones';
import { EmptyState, ErrorState, MeterBar } from '../../components/page';
import { LinkButton, LockIcon, StatusPill } from '../../components/enrollment';
import { ResumeHero } from '../../components/course/ResumeHero';
import { ProgressCard } from '../../components/course/ProgressCard';
import { CertificateCard } from '../../components/course/CertificateCard';
import { keepTogether, languageName } from '../../components/course/labels';

/**
 * Главная студента (screen_specs «Student dashboard»): приветствие; герой «Продолжить»
 * на каждый активный курс (самый свежий — крупно, с правым рельсом «Прогресс» и
 * «Сертификат»), «Мои курсы» (язык обучения, счётчики, прогресс, статус) и заявки.
 * Никаких серий, очков и рейтингов (валидность исследования).
 */
export function StudentDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  useDocumentTitle(t('student.pageTitle'));
  const { data, isLoading, isError, error, refetch } = useMyCourses();
  const items = data?.items ?? [];
  const admitted = items.filter((e) => isApproved(e.status));
  const requests = items.filter((e) => !isApproved(e.status));
  // «Продолжить» — только активные курсы с опубликованной версией и следующим шагом
  const resumable = admitted.filter((e) => e.status === 'ACTIVE' && !!e.summary?.next);
  const primary = resumable[0];
  const others = resumable.slice(1);
  // Карта курса — только для первого (превью видео, длительность, попытки): дёшево
  const primaryView = useLearnView(primary?.courseId, primary?.id);

  return (
    <>
      <h1 className="font-display text-display-lg">{t('student.greeting', { name: user?.name ?? '' })}</h1>

      {isLoading ? (
        <DashboardSkeleton />
      ) : isError ? (
        <div className="mt-6 space-y-3 text-center">
          <ErrorState message={error instanceof ApiError ? error.message : t('errors.generic')} />
          <Button variant="secondary" onClick={() => void refetch()}>{t('common.retry')}</Button>
        </div>
      ) : !items.length ? (
        <div className="mt-6">
          <EmptyState
            title={t('student.noCourses')}
            hint={t('student.emptyHint')}
            action={<LinkButton to="/catalog" className="mt-2">{t('student.openCatalog')}</LinkButton>}
          />
        </div>
      ) : (
        // lg: слева — герои «Продолжить» и списки, справа — липкий рельс первого курса;
        // на мобильных порядок: герой → рельс → «Мои курсы» (screen_specs).
        <div className={clsx('mt-6 grid gap-6', primary?.summary && 'lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-y-10')}>
          {primary?.summary && (
            <section aria-labelledby="resume-heading" className="flex min-w-0 flex-col gap-4 lg:col-start-1">
              <h2 id="resume-heading" className="sr-only">{t('student.resumeHeading')}</h2>
              <ResumeHero enrollment={primary} summary={primary.summary} view={primaryView.data} />
              {others.map((e) => e.summary && <ResumeHero key={e.id} enrollment={e} summary={e.summary} compact />)}
            </section>
          )}
          {primary?.summary && (
            <aside
              aria-label={primary.languageVersion.title}
              className="grid gap-4 sm:grid-cols-2 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:grid-cols-1 lg:self-start"
            >
              <ProgressCard progress={primary.summary.progress} headingLevel={3} eyebrow={primary.languageVersion.title} />
              <CertificateCard
                certificate={primary.summary.certificate}
                enrollmentId={primary.id}
                courseTitle={primary.languageVersion.title}
                variant="compact"
                maxItems={4}
                headingLevel={3}
                eyebrow={primary.languageVersion.title}
              />
            </aside>
          )}

          <div className="min-w-0 space-y-10 lg:col-start-1">
            {admitted.length > 0 && (
              <section aria-labelledby="my-courses">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 id="my-courses" className="font-display text-display-lg">{t('student.myCourses')}</h2>
                  <Link to="/catalog" className="inline-flex items-center gap-1 rounded-lg text-label font-semibold text-brand hover:underline">
                    {t('catalog.navFull')}
                    <Icon name="arrow-right" size={16} />
                  </Link>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {admitted.map((e) => <MyCourseCard key={e.id} e={e} />)}
                </div>
              </section>
            )}

            {requests.length > 0 && (
              <section aria-labelledby="my-requests">
                <h2 id="my-requests" className="mb-4 font-display text-display-lg">{t('student.requestsTitle')}</h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {requests.map((e) => <RequestCard key={e.id} e={e} />)}
                </div>
              </section>
            )}

            {admitted.length === 0 && (
              <Card className="flex flex-col items-start gap-3 border-dashed !py-5 sm:flex-row sm:items-center">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><LockIcon className="h-5 w-5" /></span>
                <p className="flex-1 text-meta text-fg-2">{t('requests.noActiveYet')}</p>
                <LinkButton to="/catalog" variant="ghost" size="sm">{t('requests.findCourse')}</LinkButton>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mt-6 space-y-10" aria-busy="true">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="grid gap-5 !p-5 md:grid-cols-[280px_minmax(0,1fr)] md:items-center">
          <Skeleton className="aspect-video w-full rounded-xl" />
          <div className="space-y-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-7 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-12 w-48" />
          </div>
        </Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-44 w-full rounded-2xl" />
        <Skeleton className="h-44 w-full rounded-2xl" />
      </div>
    </div>
  );
}

/**
 * Карточка «Мои курсы» (§8: ≤ 3 уровня текста): название, ОДНА мета-строка
 * «Русский · 5 модулей · 15 лекций · ≈ 6 ч» (язык обучения — текстом), прогресс и ОДИН статус.
 * Версия снята с публикации — «Временно недоступен», без перехода в курс.
 */
function MyCourseCard({ e }: { e: MyEnrollment }) {
  const { t } = useTranslation();
  const { formatDuration } = useFormat();
  const unavailable = !!e.languageVersion.status && e.languageVersion.status !== 'PUBLISHED';
  const counts = e.summary?.counts;
  const pct = Math.round(e.summary?.progress.percent ?? e.progressPercent ?? 0);
  const meta = [
    languageName(t, e.languageVersion.language),
    counts ? t('course.count.modules', { count: counts.modules }) : null,
    counts ? t('course.count.lectures', { count: counts.lectures }) : null,
    counts?.durationSec ? keepTogether(formatDuration(counts.durationSec, 'human')) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const status: { tone: Tone; glyph: ReactNode; text: string } = unavailable
    ? { tone: 'muted', glyph: <Icon name="lock" size={14} strokeWidth={2} />, text: t('student.status.UNAVAILABLE') }
    : e.certificate
      ? { tone: 'spark', glyph: <Icon name="award" size={14} strokeWidth={2} />, text: t('student.status.CERTIFICATE') }
      : e.status === 'COMPLETED'
        ? { tone: 'teal', glyph: <Icon name="check" size={14} strokeWidth={2.5} />, text: t('student.status.COMPLETED') }
        : pct > 0
          ? { tone: 'brand', glyph: <StatusIcon state="IN_PROGRESS" progress={pct / 100} size={14} label="" />, text: t('student.status.ACTIVE') }
          : { tone: 'muted', glyph: <StatusIcon state="NOT_STARTED" size={14} label="" />, text: t('student.status.NOT_STARTED') };
  const href = routes.course(e.courseId, e.id);

  return (
    <article
      className={clsx(
        'card relative flex flex-col p-5 transition-colors',
        !unavailable && 'hover:border-brand/40 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand',
      )}
    >
      <h3 className="line-clamp-2 text-title" lang={e.languageVersion.language}>
        {unavailable ? (
          e.languageVersion.title
        ) : (
          <Link to={href} className="outline-none after:absolute after:inset-0 after:rounded-2xl after:content-[''] hover:text-brand">
            {e.languageVersion.title}
          </Link>
        )}
      </h3>
      <p className="mt-1 text-meta text-fg-2">{meta}</p>
      {unavailable ? (
        <p className="mt-4 text-meta text-fg-2">{t('student.unavailableHint')}</p>
      ) : (
        <div className="mt-4">
          <MeterBar value={pct / 100} tone={e.status === 'COMPLETED' ? 'teal' : 'brand'} label={t('student.progress')} />
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
        <Badge tone={status.tone} className="!text-label">
          {status.glyph}
          {status.text}
        </Badge>
        {!unavailable && (
          <span className="inline-flex items-center gap-1 text-label font-semibold text-brand" aria-hidden>
            {t('student.openCourse')}
            <Icon name="arrow-right" size={16} />
          </span>
        )}
      </div>
    </article>
  );
}

/** Карточка заявки: на рассмотрении — отмена; отклонена/отменена — «Подать снова». */
function RequestCard({ e }: { e: MyEnrollment }) {
  const { t } = useTranslation();
  const { formatDate } = useFormat();
  const cancel = useCancelRequest();
  const [confirming, setConfirming] = useState(false);
  const pending = e.status === 'PENDING';

  function doCancel() {
    cancel.mutate(e.id, {
      onSuccess: () => toast(t('catalog.cancelled'), 'brand'),
      onError: (err) => toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger'),
    });
  }

  const dateLine =
    pending || !e.reviewedAt
      ? t('catalog.requestedOn', { date: formatDate(e.requestedAt) })
      : t('requests.reviewedOn', { date: formatDate(e.reviewedAt) });

  return (
    <Card className={clsx('flex flex-col !p-5', pending && 'border-spark/40')}>
      {/* Телефон: статус над названием — узкая колонка рядом с плашкой рвала бы название на 3–4 строки */}
      <div className="flex flex-col-reverse items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
        <h3 className="min-w-0 text-title" lang={e.languageVersion.language}>
          <Link to={`/catalog/${e.courseId}`} className="rounded hover:text-brand">{e.languageVersion.title}</Link>
        </h3>
        <StatusPill status={e.status} />
      </div>
      <p className="mt-1 text-meta text-fg-2">
        {languageName(t, e.languageVersion.language)} · {dateLine}
      </p>

      {pending ? (
        <p className="mt-3 flex items-start gap-2 text-meta text-fg-2">
          <LockIcon className="mt-1 h-3.5 w-3.5 shrink-0" /> {t('requests.pendingNote')}
        </p>
      ) : e.reviewNote ? (
        <blockquote className="mt-3 rounded-xl border border-border bg-surface px-4 py-3 text-body leading-relaxed">
          <div className="mb-1 text-label text-fg-2">{t('catalog.reviewNote')}</div>
          {e.reviewNote}
        </blockquote>
      ) : null}

      <div className="mt-auto pt-5">
        {pending ? (
          confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto text-body font-semibold">{t('catalog.cancelConfirm')}</span>
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
          <LinkButton to={`/catalog/${e.courseId}`} size="sm">{t('catalog.applyAgain')}</LinkButton>
        )}
      </div>
    </Card>
  );
}
