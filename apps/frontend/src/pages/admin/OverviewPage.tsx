import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Badge, Card } from '../../components/ui';
import { PageHeader, StatCard, EmptyState, LoadingRows, MeterBar } from '../../components/page';

/** Средние по рубрике критического мышления (шкала 0–3). */
interface Rubric {
  avg_methodicalness: number;
  avg_question_quality: number;
  avg_logical_progression: number;
  avg_self_correction: number;
}

interface Overview {
  users: number;
  students: number;
  courses: number;
  publishedVersions: number;
  enrollments: number;
  completedEnrollments: number;
  certificates: number;
  practical: {
    total: number;
    passed: number;
    failed: number;
    abandoned: number;
    passRate: number;
    avgTokens: number;
    avgMessages: number;
    rubric: Rubric;
  };
}

interface Cohort {
  cohortId: string;
  name: string;
  condition: string;
  students: number;
  enrollments: number;
  completionRate: number;
  teacherSessions: number;
  practical: {
    passRate: number;
    avgMessages: number;
    rubric: Rubric;
  };
}

interface CohortCompare {
  cohorts: Cohort[];
}

/** Тон бейджа по условию эксперимента когорты (§10.1 CohortCondition). */
const conditionTone: Record<string, 'brand' | 'spark' | 'teal' | 'muted'> = {
  AI_ASSISTED: 'brand',
  WITH_TEACHER: 'spark',
  CONTROL: 'muted',
};

/** Доля 0..1 → проценты. */
const pct = (v: number | null | undefined) => `${Math.round((v ?? 0) * 100)}%`;

/**
 * Сводный дашборд системы + сравнение когорт эксперимента (FR-10.5, FR-10.6). ADMIN.
 */
export function OverviewPage() {
  const { t } = useTranslation();

  const overviewQ = useQuery({
    queryKey: ['overview'],
    queryFn: () => api.get<Overview>('/dashboards/overview'),
  });
  const cohortsQ = useQuery({
    queryKey: ['cohort-compare'],
    queryFn: () => api.get<CohortCompare>('/dashboards/cohorts'),
  });

  const o = overviewQ.data;

  return (
    <>
      <PageHeader eyebrow={t('nav.dashboards')} title={t('dashboard.overview')} />

      {/* Сводные метрики */}
      {overviewQ.isLoading ? (
        <LoadingRows rows={2} />
      ) : o ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label={t('dashboard.students')} value={o.students} tone="brand" />
          <StatCard label={t('dashboard.courses')} value={o.courses} tone="teal" />
          <StatCard label={t('dashboard.enrollments')} value={o.enrollments} tone="brand" />
          <StatCard label={t('student.completed')} value={o.completedEnrollments} tone="teal" />
          <StatCard label={t('dashboard.certificates')} value={o.certificates} tone="spark" />
          <StatCard label={t('dashboard.passRate')} value={pct(o.practical.passRate)} tone="spark" />
        </div>
      ) : null}

      {/* Сравнение когорт */}
      <h2 className="mb-4 mt-10 text-xl font-semibold">{t('dashboard.cohortComparison')}</h2>
      {cohortsQ.isLoading ? (
        <LoadingRows rows={3} />
      ) : !cohortsQ.data?.cohorts.length ? (
        <EmptyState title={t('dashboard.noData')} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {cohortsQ.data.cohorts.map((c) => (
            <Card key={c.cohortId} className="flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-lg font-semibold">{c.name}</h3>
                <Badge tone={conditionTone[c.condition] ?? 'muted'}>{t(`conditions.${c.condition}`, { defaultValue: c.condition })}</Badge>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label={t('dashboard.students')} value={c.students} />
                <Metric label={t('dashboard.completionRate')} value={pct(c.completionRate)} />
                <Metric label={t('dashboard.teacherSessionsCount')} value={c.teacherSessions} />
                <Metric label={t('dashboard.passRate')} value={pct(c.practical.passRate)} />
              </div>

              <div className="mt-5 space-y-2.5">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {t('dashboard.rubricAverages')}
                </div>
                <MeterBar tone="brand" label={t('practical.methodicalness')} value={c.practical.rubric.avg_methodicalness / 3} />
                <MeterBar tone="spark" label={t('practical.questionQuality')} value={c.practical.rubric.avg_question_quality / 3} />
                <MeterBar tone="teal" label={t('practical.logicalProgression')} value={c.practical.rubric.avg_logical_progression / 3} />
                <MeterBar tone="brand" label={t('practical.selfCorrection')} value={c.practical.rubric.avg_self_correction / 3} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

/** Компактная метрика внутри карточки когорты. */
function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-fg">{value}</div>
    </div>
  );
}
