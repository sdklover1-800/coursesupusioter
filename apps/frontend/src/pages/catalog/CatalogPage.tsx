import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { Role } from '@edu/shared';
import { useAuth } from '../../lib/auth';
import { isApproved, pickVersion, useCatalog, useMyCourses, type CatalogItem, type MyEnrollment } from '../../lib/catalog';
import { Button, Card, Skeleton, buttonClass } from '../../components/ui';
import { EmptyState, ErrorState } from '../../components/page';
import { LangBadge, SparkTag, StatusPill } from '../../components/enrollment';

/**
 * Публичный каталог курсов: только опубликованные языковые версии.
 * Контент (видео, расшифровки, вопросы) здесь не раскрывается — только описание и программа.
 */
export function CatalogPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isStudent = user?.role === Role.STUDENT;
  const catalog = useCatalog();
  const mine = useMyCourses(isStudent);
  const byCourse = new Map((mine.data?.items ?? []).map((e) => [e.courseId, e]));
  const items = catalog.data?.items ?? [];

  // Путь студента: шаги отмечаются по мере продвижения (аккаунт → заявка → одобрение).
  const myItems = mine.data?.items ?? [];
  const steps = [
    { n: '01', title: t('catalog.step1'), hint: t('catalog.step1Hint'), done: !!user },
    { n: '02', title: t('catalog.step2'), hint: t('catalog.step2Hint'), done: myItems.length > 0 },
    { n: '03', title: t('catalog.step3'), hint: t('catalog.step3Hint'), done: myItems.some((e) => isApproved(e.status)) },
  ];

  return (
    <>
      {/* Hero */}
      <section className="relative mb-8 overflow-hidden rounded-2xl bg-ink px-6 py-8 text-white sm:px-10 sm:py-10">
        <div className="bg-inquiry-grid absolute inset-0 opacity-25" aria-hidden />
        <div className="relative">
          <div className="mb-3 font-mono text-xs font-semibold uppercase tracking-wider text-spark">{t('catalog.eyebrow')}</div>
          <h1 className="max-w-2xl font-display text-3xl font-semibold leading-tight sm:text-4xl">{t('catalog.title')}</h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/65 sm:text-base">{t('catalog.subtitle')}</p>

          {user?.role !== Role.COURSE_MANAGER && user?.role !== Role.ADMIN && (
            <ol className="mt-8 grid gap-3 sm:grid-cols-3">
              {steps.map((s) => (
                <li key={s.n} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                  <span className={clsx('font-mono text-sm font-semibold', s.done ? 'text-teal' : 'text-spark')}>{s.done ? '✓' : s.n}</span>
                  <div className="min-w-0">
                    <div className={clsx('text-sm font-semibold', s.done && 'text-white/60 line-through decoration-white/30')}>{s.title}</div>
                    <div className="mt-0.5 text-xs text-white/50">{s.hint}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {catalog.isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <Card key={i} className="space-y-4">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-11 w-full" />
            </Card>
          ))}
        </div>
      ) : catalog.isError ? (
        <div className="space-y-3 text-center">
          <ErrorState message={t('catalog.loadError')} />
          <Button variant="secondary" onClick={() => void catalog.refetch()}>{t('common.retry')}</Button>
        </div>
      ) : !items.length ? (
        <EmptyState title={t('catalog.empty')} hint={t('catalog.emptyHint')} />
      ) : (
        <div className={clsx('grid grid-cols-1 gap-5 sm:grid-cols-2', items.length >= 3 && 'xl:grid-cols-3')}>
          {items.map((c) => <CourseCard key={c.id} course={c} enrollment={byCourse.get(c.id)} />)}
        </div>
      )}
    </>
  );
}

function CourseCard({ course, enrollment }: { course: CatalogItem; enrollment?: MyEnrollment }) {
  const { t, i18n } = useTranslation();
  const v = pickVersion(course.versions, i18n.language);
  if (!v) return null;

  return (
    <Card className="group relative flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-glow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" aria-label={t('catalog.languages')}>
          {course.versions.map((x) => <LangBadge key={x.id} lang={x.language} active={x.id === v.id} />)}
        </div>
        {enrollment && <StatusPill status={enrollment.status} />}
      </div>

      <h2 className="mt-4 text-xl font-semibold leading-snug">{v.title}</h2>
      {v.description && <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">{v.description}</p>}

      <div className="mt-auto pt-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4 text-sm">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className="text-brand" aria-hidden>▤</span>{t('catalog.modules', { count: v.moduleCount })}
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className="text-brand" aria-hidden>▷</span>{t('catalog.lectures', { count: v.lectureCount })}
          </span>
        </div>
        {v.hasPractical && <SparkTag className="mt-3">{t('catalog.practicalBadge')}</SparkTag>}

        {/* Ссылка растянута на всю карточку (after:inset-0) — одна точка фокуса */}
        <Link
          to={`/catalog/${course.id}`}
          className={buttonClass('secondary', 'md', 'mt-5 w-full after:absolute after:inset-0 after:rounded-xl after:content-[""] group-hover:border-brand/50 group-hover:text-brand')}
        >
          {t('catalog.details')} <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
        </Link>
      </div>
    </Card>
  );
}
