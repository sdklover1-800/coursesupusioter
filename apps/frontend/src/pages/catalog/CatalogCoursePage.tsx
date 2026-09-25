import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { Role } from '@edu/shared';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  formatDate, isApproved, pickVersion, useCancelRequest, useCatalogCourse, useMyCourses, useRequestEnrollment,
  type CatalogCourse, type CatalogVersion, type MyEnrollment,
} from '../../lib/catalog';
import { Button, Card, QuestionGlyph, Select, Skeleton, toast } from '../../components/ui';
import { EmptyState, ErrorState, MeterBar } from '../../components/page';
import { ChevronIcon, LangBadge, LinkButton, LockIcon, StatusPill } from '../../components/enrollment';

/**
 * Публичная страница курса: описание, языки, программа (только заголовки) и
 * блок действия по состоянию: аноним → регистрация; студент → заявка/статус;
 * одобрено → переход к курсу. Контент курса здесь не раскрывается.
 */
export function CatalogCoursePage() {
  const { t, i18n } = useTranslation();
  const { courseId } = useParams();
  const { user } = useAuth();
  const q = useCatalogCourse(courseId);
  const mine = useMyCourses(user?.role === Role.STUDENT);
  const enrollment = mine.data?.items.find((e) => e.courseId === courseId);
  const [versionId, setVersionId] = useState<string | null>(null);

  if (q.isLoading) return <CoursePageSkeleton />;
  if (q.isError) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <>
        <BackLink />
        {notFound ? (
          <EmptyState title={t('catalog.notFound')} action={<LinkButton to="/catalog" variant="secondary">{t('catalog.back')}</LinkButton>} />
        ) : (
          <ErrorState message={t('catalog.loadError')} />
        )}
      </>
    );
  }
  const course = q.data?.course;
  if (!course || !course.versions.length) return null;

  // Выбранная версия: явный выбор → язык заявки студента → язык интерфейса → первая.
  const version =
    course.versions.find((v) => v.id === versionId) ??
    course.versions.find((v) => v.id === enrollment?.languageVersion.id) ??
    pickVersion(course.versions, i18n.language)!;
  const lectureCount = version.modules.reduce((n, m) => n + m.lectures.length, 0);
  const hasPractical = version.modules.some((m) => m.assessmentType === 'PRACTICAL');
  const locked = !enrollment || !isApproved(enrollment.status);

  return (
    <>
      <BackLink />

      {/* Шапка курса */}
      <section className="relative overflow-hidden rounded-2xl bg-ink px-6 py-8 text-white sm:px-10 sm:py-10">
        <div className="bg-inquiry-grid absolute inset-0 opacity-25" aria-hidden />
        <div className="relative">
          {course.versions.length > 1 && (
            <div role="radiogroup" aria-label={t('catalog.courseLanguage')} className="mb-6 flex flex-wrap items-center gap-2">
              <span className="mr-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-white/50">{t('catalog.courseLanguage')}</span>
              {course.versions.map((v) => {
                const active = v.id === version.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setVersionId(v.id)}
                    className={clsx(
                      'rounded-full px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-spark',
                      active ? 'bg-spark text-ink' : 'bg-white/[0.07] text-white/75 hover:bg-white/15 hover:text-white',
                    )}
                  >
                    {t(`languages.${v.language}`)}
                  </button>
                );
              })}
            </div>
          )}
          <h1 lang={version.language} className="max-w-3xl font-display text-3xl font-semibold leading-tight sm:text-4xl">{version.title}</h1>
          {version.description && (
            <p lang={version.language} className="mt-4 max-w-3xl text-sm leading-relaxed text-white/70 sm:text-base">{version.description}</p>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className="rounded-full bg-white/[0.08] px-3 py-1.5">{t('catalog.modules', { count: version.modules.length })}</span>
            <span className="rounded-full bg-white/[0.08] px-3 py-1.5">{t('catalog.lectures', { count: lectureCount })}</span>
            {hasPractical && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-spark px-3 py-1.5 text-ink">
                <span className="font-display font-bold" aria-hidden>?</span>{t('catalog.practicalBadge')}
              </span>
            )}
          </div>
        </div>
      </section>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Действие (на мобильных — сразу под шапкой) */}
        <aside className="lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1">
          <EnrollPanel course={course} version={version} onVersionChange={setVersionId} enrollment={enrollment} enrollmentLoading={mine.isLoading} />
        </aside>

        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
          <Syllabus version={version} locked={locked} />
          <Included course={course} version={version} lectureCount={lectureCount} />
        </div>
      </div>
    </>
  );
}

function BackLink() {
  const { t } = useTranslation();
  return (
    <Link to="/catalog" className="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-muted transition-colors hover:text-fg">
      <span aria-hidden>←</span> {t('catalog.back')}
    </Link>
  );
}

function CoursePageSkeleton() {
  return (
    <>
      <Skeleton className="mb-4 h-5 w-40" />
      <Skeleton className="h-56 w-full rounded-2xl" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-80 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    </>
  );
}

/* ── Программа курса (аккордеон модулей) ─────────────────── */
function Syllabus({ version, locked }: { version: CatalogVersion; locked: boolean }) {
  const { t } = useTranslation();
  const modules = [...version.modules].sort((a, b) => a.orderIndex - b.orderIndex);
  const firstId = modules[0]?.id;
  const [open, setOpen] = useState<Set<string>>(() => new Set(firstId ? [firstId] : []));
  // Смена языковой версии — другие id модулей: раскрываем первый заново.
  useEffect(() => { setOpen(new Set(firstId ? [firstId] : [])); }, [version.id, firstId]);
  const allOpen = modules.length > 0 && modules.every((m) => open.has(m.id));

  function toggle(id: string) {
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  return (
    <Card className="!p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
        <h2 className="text-lg font-semibold">{t('catalog.syllabus')}</h2>
        {modules.length > 1 && (
          <button
            type="button"
            onClick={() => setOpen(allOpen ? new Set() : new Set(modules.map((m) => m.id)))}
            className="rounded-lg px-2 py-1 text-sm font-semibold text-brand transition-colors hover:bg-brand-soft"
          >
            {allOpen ? t('catalog.collapseAll') : t('catalog.expandAll')}
          </button>
        )}
      </div>

      <ol className="divide-y divide-border">
        {modules.map((m, i) => {
          const isOpen = open.has(m.id);
          const panelId = `module-panel-${m.id}`;
          const lectures = [...m.lectures].sort((a, b) => a.orderIndex - b.orderIndex);
          const practical = m.assessmentType === 'PRACTICAL';
          return (
            <li key={m.id}>
              <h3 className="font-sans">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggle(m.id)}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-brand-soft/40 sm:gap-4 sm:px-6"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-soft font-mono text-sm font-bold text-brand">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[11px] font-semibold uppercase tracking-wider text-muted">
                      {t('catalog.moduleN', { n: i + 1 })} · {t('catalog.lectures', { count: lectures.length })}
                    </span>
                    <span lang={version.language} className="mt-0.5 block font-display text-[15px] font-semibold leading-snug text-fg">{m.title}</span>
                  </span>
                  <span
                    className={clsx(
                      'hidden shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold sm:inline-flex',
                      practical ? 'bg-spark/15 text-fg' : 'bg-brand-soft text-brand',
                    )}
                  >
                    {practical ? t('catalog.assessmentPractical') : t('catalog.assessmentQuiz')}
                  </span>
                  <ChevronIcon className={clsx('h-4 w-4 shrink-0 text-muted transition-transform duration-200', isOpen && 'rotate-180')} />
                </button>
              </h3>

              {isOpen && (
                <div id={panelId} className="animate-fade-up px-5 pb-5 sm:px-6 sm:pl-[4.75rem]">
                  <ol className="space-y-0.5">
                    {lectures.map((l) => (
                      <li key={l.id} className="flex items-start gap-3 rounded-lg py-1.5 text-sm">
                        <span className="w-4 shrink-0 pt-px text-xs text-brand/70" aria-hidden>▷</span>
                        <span lang={version.language} className="flex-1 leading-snug">{l.title}</span>
                        {locked && <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted/70" />}
                      </li>
                    ))}
                  </ol>
                  <div
                    className={clsx(
                      'mt-3 flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm font-semibold',
                      practical ? 'border-spark/40 bg-spark/[0.06]' : 'border-border bg-surface',
                    )}
                  >
                    {practical ? (
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-spark font-display text-xs font-bold text-ink" aria-hidden>?</span>
                    ) : (
                      <span className="grid h-6 w-6 shrink-0 place-items-center text-brand" aria-hidden>◆</span>
                    )}
                    <span className="flex-1">{practical ? t('catalog.modulePractical') : t('catalog.moduleQuiz')}</span>
                    {locked && <LockIcon className="h-3.5 w-3.5 shrink-0 text-muted/70" />}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {locked && (
        <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-xs text-muted sm:px-6">
          <LockIcon className="h-3.5 w-3.5 shrink-0" /> {t('catalog.lockedHint')}
        </div>
      )}
    </Card>
  );
}

/* ── Что входит в курс ───────────────────────────────────── */
function Included({ course, version, lectureCount }: { course: CatalogCourse; version: CatalogVersion; lectureCount: number }) {
  const { t } = useTranslation();
  const hasQuiz = version.modules.some((m) => m.assessmentType === 'QUIZ');
  const hasPractical = version.modules.some((m) => m.assessmentType === 'PRACTICAL');
  const langs = course.versions.map((v) => t(`languages.${v.language}`)).join(', ');
  const items: { icon: string; text: string; spark?: boolean }[] = [
    { icon: '▷', text: t('catalog.incLectures', { count: lectureCount }) },
    ...(hasQuiz ? [{ icon: '◆', text: t('catalog.incQuizzes') }] : []),
    ...(hasPractical ? [{ icon: '?', text: t('catalog.incPractical'), spark: true }] : []),
    { icon: '✧', text: t('catalog.incCertificate') },
    { icon: '◎', text: t('catalog.incLanguages', { list: langs }) },
  ];
  return (
    <Card>
      <h2 className="text-lg font-semibold">{t('catalog.included')}</h2>
      <ul className="mt-5 grid gap-4 sm:grid-cols-2">
        {items.map((it) => (
          <li key={it.text} className="flex items-start gap-3 text-sm leading-snug">
            <span
              className={clsx(
                'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm',
                it.spark ? 'bg-spark font-display font-bold text-ink' : 'bg-brand-soft text-brand',
              )}
              aria-hidden
            >
              {it.icon}
            </span>
            <span className="pt-1.5">{it.text}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── Блок действия по состоянию ──────────────────────────── */
function EnrollPanel({ course, version, onVersionChange, enrollment, enrollmentLoading }: {
  course: CatalogCourse;
  version: CatalogVersion;
  onVersionChange: (id: string) => void;
  enrollment?: MyEnrollment;
  enrollmentLoading: boolean;
}) {
  const { t } = useTranslation();
  const { user, loading } = useAuth();

  if (loading || (user?.role === Role.STUDENT && enrollmentLoading)) {
    return (
      <Card className="space-y-4">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-11 w-full" />
      </Card>
    );
  }

  // Аноним: регистрация (с возвратом на эту страницу) или вход
  if (!user) {
    const next = encodeURIComponent(`/catalog/${course.id}`);
    return (
      <Card>
        <QuestionGlyph size={40} />
        <h2 className="mt-4 text-lg font-semibold">{t('catalog.ctaAnonTitle')}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t('catalog.ctaAnonText')}</p>
        <div className="mt-5 space-y-2">
          <LinkButton to={`/register?next=${next}`} size="lg" className="!h-auto min-h-[3rem] w-full py-2.5 text-center leading-snug">{t('catalog.registerAndApply')}</LinkButton>
          <LinkButton to={`/login?next=${next}`} variant="secondary" className="w-full">{t('auth.signIn')}</LinkButton>
        </div>
      </Card>
    );
  }

  // Менеджер/админ: заявки обрабатываются на отдельной странице
  if (user.role !== Role.STUDENT) {
    return (
      <Card>
        <div className="font-mono text-xs font-semibold uppercase tracking-wider text-brand">{t('catalog.staffTitle')}</div>
        <p className="mt-2 text-sm leading-relaxed text-fg">{t('catalog.staffText')}</p>
        <LinkButton to={`/manage/requests?courseId=${course.id}`} variant="secondary" className="mt-5 w-full">
          {t('catalog.openRequests')} →
        </LinkButton>
      </Card>
    );
  }

  if (enrollment && isApproved(enrollment.status)) return <ApprovedPanel course={course} enrollment={enrollment} />;
  if (enrollment?.status === 'PENDING') return <PendingPanel enrollment={enrollment} />;
  return <ApplyPanel course={course} version={version} onVersionChange={onVersionChange} enrollment={enrollment} />;
}

function ApplyPanel({ course, version, onVersionChange, enrollment }: {
  course: CatalogCourse; version: CatalogVersion; onVersionChange: (id: string) => void; enrollment?: MyEnrollment;
}) {
  const { t, i18n } = useTranslation();
  const request = useRequestEnrollment(course.id);
  const again = enrollment?.status === 'REJECTED' || enrollment?.status === 'WITHDRAWN';

  function submit() {
    request.mutate(version.id, {
      onSuccess: () => toast(t('catalog.applied'), 'teal'),
      onError: (err) => toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger'),
    });
  }

  return (
    <Card>
      {again && enrollment ? (
        <>
          <StatusPill status={enrollment.status} />
          <h2 className="mt-3 text-lg font-semibold">
            {enrollment.status === 'REJECTED' ? t('catalog.rejectedTitle') : t('catalog.withdrawnTitle')}
          </h2>
          {enrollment.reviewedAt && <div className="mt-1 font-mono text-xs text-muted">{t('requests.reviewedOn', { date: formatDate(enrollment.reviewedAt, i18n.language) })}</div>}
          {enrollment.reviewNote && (
            <blockquote className="mt-4 rounded-xl border border-border bg-surface px-4 py-3 text-sm leading-relaxed">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('catalog.reviewNote')}</div>
              {enrollment.reviewNote}
            </blockquote>
          )}
          <p className="mt-3 text-sm text-muted">{t('catalog.rejectedText')}</p>
        </>
      ) : (
        <>
          <div className="font-mono text-xs font-semibold uppercase tracking-wider text-brand">{t('catalog.ctaApplyTitle')}</div>
          <p className="mt-2 text-sm leading-relaxed text-muted">{t('catalog.ctaApplyText')}</p>
        </>
      )}

      <div className="mt-5 space-y-1.5">
        <label htmlFor="apply-lang" className="text-sm font-semibold">{t('catalog.studyLanguage')}</label>
        {course.versions.length > 1 ? (
          <Select id="apply-lang" value={version.id} onChange={(e) => onVersionChange(e.target.value)}>
            {course.versions.map((v) => <option key={v.id} value={v.id}>{t(`languages.${v.language}`)}</option>)}
          </Select>
        ) : (
          <div id="apply-lang" className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm">
            <LangBadge lang={version.language} /> {t(`languages.${version.language}`)}
          </div>
        )}
      </div>
      <Button size="lg" className="mt-4 w-full" loading={request.isPending} onClick={submit}>
        {again ? t('catalog.applyAgain') : t('catalog.apply')}
      </Button>
      <p className="mt-3 flex items-center gap-2 text-xs text-muted">
        <LockIcon className="h-3.5 w-3.5 shrink-0" /> {t('catalog.lockedHint')}
      </p>
    </Card>
  );
}

function PendingPanel({ enrollment }: { enrollment: MyEnrollment }) {
  const { t, i18n } = useTranslation();
  const cancel = useCancelRequest();
  const [confirming, setConfirming] = useState(false);

  function doCancel() {
    cancel.mutate(enrollment.id, {
      onSuccess: () => { toast(t('catalog.cancelled'), 'brand'); setConfirming(false); },
      onError: (err) => toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger'),
    });
  }

  return (
    <Card className="border-spark/40">
      <span className="relative grid h-10 w-10 place-items-center rounded-full bg-spark/15 text-lg text-fg" aria-hidden>
        ⧗<span className="absolute right-0 top-0 h-2.5 w-2.5 animate-pulse rounded-full bg-spark ring-2 ring-card" />
      </span>
      <h2 className="mt-3 text-lg font-semibold">{t('catalog.pendingTitle')}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{t('catalog.pendingText')}</p>
      <dl className="mt-4 space-y-2 rounded-xl bg-surface px-4 py-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">{t('catalog.studyLanguage')}</dt>
          <dd className="font-semibold">{t(`languages.${enrollment.languageVersion.language}`)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">{t('requests.colRequested')}</dt>
          <dd className="font-mono text-xs tabular-nums">{formatDate(enrollment.requestedAt, i18n.language)}</dd>
        </div>
      </dl>
      {confirming ? (
        <div className="mt-4 animate-fade-up rounded-xl border border-danger/30 bg-danger/[0.06] p-3" role="group" aria-label={t('catalog.cancelConfirm')}>
          <p className="text-sm font-semibold">{t('catalog.cancelConfirm')}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" size="sm" autoFocus onClick={() => setConfirming(false)} disabled={cancel.isPending}>{t('catalog.keep')}</Button>
            <Button variant="danger" size="sm" loading={cancel.isPending} onClick={doCancel}>{t('catalog.cancelYes')}</Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" className="mt-4 w-full" onClick={() => setConfirming(true)}>{t('catalog.cancelRequest')}</Button>
      )}
    </Card>
  );
}

function ApprovedPanel({ course, enrollment }: { course: CatalogCourse; enrollment: MyEnrollment }) {
  const { t } = useTranslation();
  const completed = enrollment.status === 'COMPLETED';
  return (
    <Card className="border-teal/40">
      <StatusPill status={enrollment.status} />
      <h2 className="mt-3 text-lg font-semibold">{completed ? t('catalog.completedTitle') : t('catalog.activeTitle')}</h2>
      <div className="mt-4">
        <MeterBar value={enrollment.progressPercent / 100} tone="teal" label={t('student.progress')} />
      </div>
      <LinkButton to={`/learn/${course.id}/${enrollment.id}`} size="lg" className="mt-5 w-full">
        {t('catalog.goToCourse')} <span aria-hidden>→</span>
      </LinkButton>
    </Card>
  );
}
