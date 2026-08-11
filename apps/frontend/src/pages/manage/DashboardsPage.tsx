import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Badge, Card, Field, Select } from '../../components/ui';
import { PageHeader, StatCard, EmptyState, ErrorState, LoadingRows, MeterBar } from '../../components/page';

interface CourseItem {
  id: string;
  languageVersions: { id: string; language: string; title: string; status: string }[];
}

interface DashData {
  enrollment: { total: number; completed: number; completionRate: number; avgProgress: number };
  quizzes: {
    attempts: number;
    avgScore: number;
    hardQuestions: { questionId: string; prompt: string; errorRate: number; attempts: number }[];
  };
  practical: {
    total: number;
    passed: number;
    failed: number;
    abandoned: number;
    passRate: number;
    avgTokens: number;
    avgMessages: number;
    estCostUsd: number;
    rubric: {
      avg_methodicalness: number;
      avg_question_quality: number;
      avg_logical_progression: number;
      avg_self_correction: number;
    };
  };
}

interface StudentRow {
  studentId: string;
  name: string;
  language: string;
  progressPercent: number;
  status: string;
  avgQuizScore: number | null;
  practicalPassed: number;
  durationDays: number | null;
}

const pct = (n: number) => Math.round(n * 100);

/** Аналитика по курсу: записи, тесты, критическое мышление (FR-10.2–10.4). */
export function DashboardsPage() {
  const { t } = useTranslation();
  const [courseId, setCourseId] = useState('');

  const { data: courses, isLoading: coursesLoading } = useQuery({
    queryKey: ['courses'],
    queryFn: () => api.get<{ items: CourseItem[] }>('/courses'),
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['dash-course', courseId],
    queryFn: () => api.get<DashData>(`/dashboards/courses/${courseId}`),
    enabled: !!courseId,
  });

  const { data: studentsData } = useQuery({
    queryKey: ['dash-students', courseId],
    queryFn: () => api.get<{ students: StudentRow[] }>(`/dashboards/courses/${courseId}/students`),
    enabled: !!courseId,
  });

  const rubric = data?.practical.rubric;

  return (
    <>
      <PageHeader eyebrow="Inquiry" title={t('nav.dashboards')} subtitle={t('dashboard.overview')} />

      <Card className="mb-6 !py-4">
        <Field label={t('nav.courses')}>
          <Select value={courseId} onChange={(e) => setCourseId(e.target.value)} disabled={coursesLoading}>
            <option value="">—</option>
            {courses?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.languageVersions[0]?.title || c.id}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      {!courseId ? (
        <EmptyState title={t('dashboard.noData')} hint={t('nav.dashboards')} />
      ) : isLoading ? (
        <LoadingRows rows={5} />
      ) : isError ? (
        <ErrorState message={error instanceof Error ? error.message : t('errors.generic')} />
      ) : !data ? (
        <EmptyState title={t('dashboard.noData')} />
      ) : (
        <div className="space-y-6">
          {/* Ключевые метрики (FR-10.2) */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={t('dashboard.completionRate')}
              value={`${pct(data.enrollment.completionRate)}%`}
              hint={`${data.enrollment.completed} ${t('common.of')} ${data.enrollment.total}`}
              tone="brand"
            />
            <StatCard
              label={t('dashboard.avgProgress')}
              value={`${data.enrollment.avgProgress}%`}
              hint={`${data.enrollment.total} ${t('dashboard.students')}`}
              tone="teal"
            />
            <StatCard
              label={t('dashboard.avgScore')}
              value={`${pct(data.quizzes.avgScore)}%`}
              hint={`${data.quizzes.attempts} ${t('quiz.attempts')}`}
              tone="spark"
            />
            <StatCard
              label={t('dashboard.passRate')}
              value={`${pct(data.practical.passRate)}%`}
              hint={`${data.practical.passed} / ${data.practical.passed + data.practical.failed}`}
              tone="brand"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Сложные вопросы (FR-10.3) */}
            <Card>
              <h3 className="mb-4 text-lg font-semibold">{t('dashboard.hardQuestions')}</h3>
              {data.quizzes.hardQuestions.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted">{t('dashboard.noData')}</div>
              ) : (
                <ul className="space-y-4">
                  {data.quizzes.hardQuestions.map((q) => (
                    <li key={q.questionId}>
                      <div className="mb-1 flex items-start justify-between gap-3 text-xs">
                        <span className="line-clamp-2 text-fg">{q.prompt}</span>
                        <span className="shrink-0 font-mono tabular-nums font-semibold text-danger">{pct(q.errorRate)}%</span>
                      </div>
                      {/* MeterBar не поддерживает тон danger — воспроизводим его разметку с bg-danger */}
                      <div className="h-2 overflow-hidden rounded-full bg-border/60">
                        <div
                          className="h-full rounded-full bg-danger transition-all"
                          style={{ width: `${Math.min(100, Math.max(0, q.errorRate * 100))}%` }}
                        />
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {q.attempts} {t('quiz.attempts')}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Критическое мышление — рубрика 0–3 (FR-10.4) */}
            <Card>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">{t('dashboard.criticalThinking')}</h3>
                <Badge tone="spark">{data.practical.total}</Badge>
              </div>
              {rubric && (
                <div className="space-y-4">
                  <MeterBar label={t('practical.methodicalness')} value={rubric.avg_methodicalness / 3} tone="brand" />
                  <MeterBar label={t('practical.questionQuality')} value={rubric.avg_question_quality / 3} tone="teal" />
                  <MeterBar label={t('practical.logicalProgression')} value={rubric.avg_logical_progression / 3} tone="brand" />
                  <MeterBar label={t('practical.selfCorrection')} value={rubric.avg_self_correction / 3} tone="teal" />
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                <span>{t('practical.scaleNote')}</span>
                <span className="font-mono tabular-nums">
                  {t('dashboard.avgMessages')}: {data.practical.avgMessages} · {t('dashboard.avgTokens')}: {data.practical.avgTokens} · {t('dashboard.estCost')}: ${data.practical.estCostUsd}
                </span>
              </div>
            </Card>
          </div>

          {/* По студентам (FR-10.2) */}
          <Card>
            <h3 className="mb-4 text-lg font-semibold">{t('dashboard.perStudent')}</h3>
            {!studentsData?.students.length ? (
              <div className="py-8 text-center text-sm text-muted">{t('dashboard.noData')}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase text-muted">
                      <th className="py-2 pr-3 font-semibold">{t('dashboard.student')}</th>
                      <th className="py-2 pr-3 font-semibold">{t('common.language')}</th>
                      <th className="py-2 pr-3 font-semibold">{t('student.progress')}</th>
                      <th className="py-2 pr-3 font-semibold">{t('dashboard.avgScore')}</th>
                      <th className="py-2 pr-3 font-semibold">{t('manager.practical')}</th>
                      <th className="py-2 font-semibold">{t('dashboard.duration')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentsData.students.map((s) => (
                      <tr key={s.studentId} className="border-b border-border/50">
                        <td className="py-2 pr-3">{s.name} {s.status === 'COMPLETED' && <Badge tone="teal">✓</Badge>}</td>
                        <td className="py-2 pr-3 uppercase">{s.language}</td>
                        <td className="py-2 pr-3 font-mono tabular-nums">{s.progressPercent}%</td>
                        <td className="py-2 pr-3 font-mono tabular-nums">{s.avgQuizScore != null ? `${pct(s.avgQuizScore)}%` : '—'}</td>
                        <td className="py-2 pr-3 font-mono tabular-nums">{s.practicalPassed > 0 ? `✓ ${s.practicalPassed}` : '—'}</td>
                        <td className="py-2 font-mono tabular-nums">{s.durationDays != null ? s.durationDays : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
