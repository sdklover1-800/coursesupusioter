import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { formatPercent, useFormat } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { LOW_N, useAdminOverview, useCohortCompare, type CohortCompareRow } from '../../lib/staffAdmin';
import { Card, RubricBars } from '../../components/ui';
import { EmptyState, LoadingRows, PageHeader } from '../../components/page';
import { LoadError } from '../../components/staff/primitives';
import { ConditionBadge, LowNBadge } from '../../components/staff/admin/bits';

/**
 * Обзор исследования (FR-10.5, FR-10.6, FE5 §9). ADMIN.
 * Каждая метрика — с базой n; при n < 10 — метка «Мало данных». Условия когорт — те же
 * подписи и тоны, что на странице «Когорты» (t('conditions.*') + lib/tones).
 */
export function OverviewPage() {
  const { t } = useTranslation();
  const { formatNumber } = useFormat();
  useDocumentTitle(t('admin.overviewPage.title'));

  const overviewQ = useAdminOverview();
  const cohortsQ = useCohortCompare();
  const o = overviewQ.data;

  return (
    <>
      <PageHeader eyebrow={t('admin.eyebrow')} title={t('admin.overviewPage.title')} subtitle={t('admin.overviewPage.subtitle')} />

      {overviewQ.isLoading ? (
        <LoadingRows rows={2} />
      ) : overviewQ.isError ? (
        <LoadError error={overviewQ.error} onRetry={() => void overviewQ.refetch()} retrying={overviewQ.isFetching} />
      ) : o ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Kpi
            label={t('admin.overviewPage.participants')}
            value={formatNumber(o.students)}
            hint={t('admin.overviewPage.participantsHint', { total: formatNumber(o.registeredStudents ?? o.students) })}
          />
          <Kpi
            label={t('admin.overviewPage.enrollments')}
            value={formatNumber(o.enrollments)}
            hint={t('admin.overviewPage.enrollmentsHint', { count: o.completedEnrollments })}
          />
          <Kpi
            label={t('admin.overviewPage.practical')}
            value={formatPercent(o.practical.passRate)}
            hint={t('admin.overviewPage.practicalHint', { n: o.practical.n })}
            n={o.practical.n}
          />
          <Kpi label={t('admin.overviewPage.courses')} value={formatNumber(o.courses)} hint={t('admin.overviewPage.coursesHint', { count: o.publishedVersions })} />
          <Kpi label={t('admin.overviewPage.certificates')} value={formatNumber(o.certificates)} hint={t('admin.overviewPage.certificatesHint')} />
          {o.pendingRequests !== undefined && (
            <Kpi label={t('admin.overviewPage.requests')} value={formatNumber(o.pendingRequests)} hint={t('admin.overviewPage.requestsHint')} />
          )}
        </div>
      ) : null}

      {/* Сравнение когорт */}
      <section className="mt-10" aria-labelledby="cohort-compare">
        <h2 id="cohort-compare" className="font-display text-display-lg text-fg">
          {t('admin.overviewPage.compareTitle')}
        </h2>
        <p className="mb-5 mt-1.5 max-w-[70ch] text-body text-fg-2">{t('admin.overviewPage.compareHint')}</p>

        {cohortsQ.isLoading ? (
          <LoadingRows rows={3} />
        ) : cohortsQ.isError ? (
          <LoadError error={cohortsQ.error} onRetry={() => void cohortsQ.refetch()} retrying={cohortsQ.isFetching} />
        ) : !cohortsQ.data?.cohorts.length ? (
          <EmptyState title={t('admin.overviewPage.noCohorts')} hint={t('admin.overviewPage.noCohortsHint')} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {cohortsQ.data.cohorts.map((c) => (
              <CohortCard key={c.cohortId} c={c} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/** Карточка метрики: подпись (fg-2), число (Geologica), пояснение с базой n, метка «Мало данных». */
function Kpi({ label, value, hint, n }: { label: string; value: ReactNode; hint?: string; n?: number }) {
  return (
    <Card className="!p-5">
      <div className="text-label text-fg-2">{label}</div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-display text-3xl font-semibold tabular-nums text-fg">{value}</span>
        {n !== undefined && <LowNBadge n={n} />}
      </div>
      {hint && <div className="mt-1.5 text-meta text-fg-2">{hint}</div>}
    </Card>
  );
}

function CohortCard({ c }: { c: CohortCompareRow }) {
  const { t } = useTranslation();
  const n = c.n ?? c.students;
  const low = n < LOW_N;
  const r = c.practical.rubric;
  const rubricN = c.practical.rubricN ?? 0;
  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <h3 className="min-w-0 text-title text-fg">{c.name}</h3>
        <ConditionBadge condition={c.condition} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-meta text-fg-2">
          <span className="font-semibold tabular-nums text-fg">{t('admin.overviewPage.n', { n })}</span> · {t('admin.overviewPage.inCohort', { count: c.students })}
        </span>
        <LowNBadge n={n} />
      </div>

      <dl className={clsx('mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border pt-4', low && 'opacity-80')}>
        <Metric label={t('admin.overviewPage.completion')} value={formatPercent(c.completionRate)} hint={t('admin.overviewPage.completionHint')} />
        <Metric
          label={t('admin.overviewPage.practicalPass')}
          value={c.practical.n ? formatPercent(c.practical.passRate) : '—'}
          hint={t('admin.overviewPage.practicalN', { n: c.practical.n })}
          lowN={!low ? c.practical.n : undefined}
        />
        <Metric label={t('admin.overviewPage.teacherSessions')} value={c.teacherSessions} />
        <Metric label={t('admin.overviewPage.avgMessages')} value={c.practical.avgMessages || '—'} />
      </dl>

      <div className="mt-5 border-t border-border pt-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-label text-fg-2">{t('admin.overviewPage.rubric')}</span>
          {rubricN > 0 && <span className="text-small text-fg-2">{t('admin.overviewPage.rubricN', { count: rubricN })}</span>}
        </div>
        {rubricN > 0 ? (
          <RubricBars
            scores={{
              methodicalness: r.avg_methodicalness,
              question_quality: r.avg_question_quality,
              logical_progression: r.avg_logical_progression,
              self_correction: r.avg_self_correction,
            }}
          />
        ) : (
          <p className="text-body text-fg-2">{t('admin.overviewPage.rubricEmpty')}</p>
        )}
      </div>
    </Card>
  );
}

/** lowN — база метрики (если у карточки в целом данных достаточно, а у этой метрики — нет). */
function Metric({ label, value, hint, lowN }: { label: string; value: ReactNode; hint?: string; lowN?: number }) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-fg-2">{label}</dt>
      <dd className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-display text-display-md tabular-nums text-fg">{value}</span>
        {lowN !== undefined && <LowNBadge n={lowN} />}
      </dd>
      {hint && <dd className="mt-0.5 text-small text-fg-2">{hint}</dd>}
    </div>
  );
}
