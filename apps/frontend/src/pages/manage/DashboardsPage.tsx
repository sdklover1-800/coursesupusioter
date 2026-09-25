import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, Role } from '@edu/shared';
import { useAuth } from '../../lib/auth';
import { useCohortsLite } from '../../lib/catalog';
import { formatPercent, useFormat } from '../../lib/format';
import {
  cohortOptionLabel, downloadCsv, romanNumeral, useCourseMatrix, useDashCourse, useDashStudents, useManagedCourses,
} from '../../lib/staff';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { Button, Card, Field, RubricBars, Select } from '../../components/ui';
import { Icon } from '../../components/icons';
import { PageHeader, EmptyState, LoadingRows, MeterBar } from '../../components/page';
import { LangBadge } from '../../components/enrollment';
import { CohortMatrix, matrixCsvRows } from '../../components/staff/CohortMatrix';
import { ItemAnalysisSheet } from '../../components/staff/ItemAnalysisSheet';
import { LoadError, MetricCard, SampleSize, SectionTitle } from '../../components/staff/primitives';

const STORAGE_KEY = 'edu.dash.course';
const LANG_ORDER = LANGUAGES as readonly string[];

function readStored(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * Аналитика по курсу (FR-10.2–10.4; FE5 §5): первый доступный курс выбирается сам
 * (последний выбранный запоминается), фильтры языка и когорты, метрики с «n = …» и
 * пометкой «мало данных», матрица студентов, тесты модулей со ссылкой на анализ
 * заданий, рубрика критического мышления с фиксированными цветами измерений.
 */
export function DashboardsPage() {
  const { t } = useTranslation();
  const { formatNumber } = useFormat();
  useDocumentTitle(t('nav.dashboards'));
  const { user } = useAuth();
  const courses = useManagedCourses();
  // FR-10.6: менеджер видит дашборды только своих курсов, администратор — все
  const accessible = useMemo(
    () => (courses.data?.items ?? []).filter((c) => user?.role === Role.ADMIN || c.createdById === user?.id),
    [courses.data, user],
  );
  const [courseId, setCourseId] = useState<string>('');
  const [versionId, setVersionId] = useState('');
  const [cohortId, setCohortId] = useState('');
  const [itemsQuiz, setItemsQuiz] = useState<string | null>(null);

  useEffect(() => {
    if (!accessible.length) return;
    if (courseId && accessible.some((c) => c.id === courseId)) return;
    const stored = readStored();
    setCourseId(accessible.some((c) => c.id === stored) ? stored : accessible[0]!.id);
  }, [accessible, courseId]);

  function chooseCourse(id: string) {
    setCourseId(id);
    setVersionId('');
    setCohortId('');
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* приватный режим */
    }
  }

  const course = accessible.find((c) => c.id === courseId);
  const versions = course?.languageVersions ?? [];
  const selectedVersion = versions.find((v) => v.id === versionId);
  const language = selectedVersion?.language ?? '';
  const cohorts = useCohortsLite(!!courseId);
  const dash = useDashCourse(courseId || null);
  const students = useDashStudents(courseId || null);
  const matrix = useCourseMatrix(courseId || null, versionId, cohortId);
  const matrixVersionId = matrix.data?.languageVersionId ?? versionId;

  const courseTitle = (c: (typeof accessible)[number]) => (c.languageVersions.find((v) => v.language === c.defaultLanguage) ?? c.languageVersions[0])?.title ?? c.id;
  const studentRows = (students.data?.students ?? []).filter((s) => (!language || s.language === language) && (!cohortId || s.cohortId === cohortId));
  const quizRows = (dash.data?.quizzes.byQuiz ?? [])
    .filter((q) => !language || q.language === language)
    .sort((a, b) => LANG_ORDER.indexOf(a.language) - LANG_ORDER.indexOf(b.language) || a.moduleOrderIndex - b.moduleOrderIndex);
  const d = dash.data;
  const cohortName = (id: string | null) => (id ? cohorts.data?.items.find((c) => c.id === id)?.name ?? '—' : '—');

  return (
    <>
      <PageHeader title={t('nav.dashboards')} subtitle={t('dashboard.subtitle')} />

      <Card className="mb-6 !p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <Field label={t('dashboard.course')}>
            <Select value={courseId} onChange={(e) => chooseCourse(e.target.value)} disabled={courses.isLoading || !accessible.length}>
              {accessible.map((c) => (
                <option key={c.id} value={c.id}>{courseTitle(c)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('dashboard.language')}>
            <Select value={versionId} onChange={(e) => setVersionId(e.target.value)} disabled={!course}>
              <option value="">{t('dashboard.allLanguages')}</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>{t(`languages.${v.language}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('dashboard.cohort')}>
            <Select value={cohortId} onChange={(e) => setCohortId(e.target.value)} disabled={!course}>
              <option value="">{t('dashboard.allCohorts')}</option>
              {(cohorts.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {cohortOptionLabel(c.name, c.condition ? t(`conditions.${c.condition}`, { defaultValue: c.condition }) : null)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="mt-2 text-small text-fg-2">{t('dashboard.filtersHint')}</p>
      </Card>

      {courses.isLoading ? (
        <LoadingRows rows={4} />
      ) : courses.isError ? (
        // Сбой списка курсов — это ошибка, а не «нет курсов для аналитики»
        <LoadError error={courses.error} onRetry={() => void courses.refetch()} retrying={courses.isFetching} />
      ) : !accessible.length ? (
        <EmptyState title={t('dashboard.noCourses')} hint={t('dashboard.noCoursesHint')} />
      ) : dash.isLoading ? (
        <LoadingRows rows={5} />
      ) : dash.isError || !d ? (
        <LoadError error={dash.error} onRetry={() => void dash.refetch()} retrying={dash.isFetching} />
      ) : (
        <div className="space-y-6">
          {/* Ключевые метрики по курсу (все языки и когорты) */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label={t('dashboard.completionRate')}
              value={formatPercent(d.enrollment.completionRate)}
              sub={t('dashboard.completedOf', { completed: d.enrollment.completed, total: d.enrollment.total })}
              n={d.enrollment.n}
            />
            <MetricCard
              label={t('dashboard.avgProgress')}
              value={`${Math.round(d.enrollment.avgProgress)}%`}
              sub={t('dashboard.studentsCount', { count: d.enrollment.total })}
              n={d.enrollment.n}
            />
            <MetricCard
              label={t('dashboard.avgCountedScore')}
              value={d.quizzes.n ? formatPercent(d.quizzes.avgScore) : '—'}
              sub={t('dashboard.attemptsCount', { count: d.quizzes.attempts })}
              n={d.quizzes.n}
            />
            <MetricCard
              label={t('dashboard.passRate')}
              value={d.practical.n ? formatPercent(d.practical.passRate) : '—'}
              sub={t('dashboard.practicalOutcomes', { passed: d.practical.studentsPassed, failed: d.practical.studentsFailed })}
              n={d.practical.n}
            />
          </div>

          {/* Матрица студентов */}
          <Card className="!p-4 sm:!p-6">
            <SectionTitle
              hint={t('dashboard.matrix.hint')}
              action={
                matrix.data && matrix.data.rows.length > 0 ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => downloadCsv(`matrix-${matrix.data!.versions.find((v) => v.id === matrixVersionId)?.language ?? 'course'}.csv`, matrixCsvRows(matrix.data!, t))}
                  >
                    <Icon name="download" size={16} />
                    {t('dashboard.matrix.csv')}
                  </Button>
                ) : undefined
              }
            >
              {t('dashboard.matrix.title')}
            </SectionTitle>
            {matrix.data && (
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-fg-2">
                {(() => {
                  const v = matrix.data.versions.find((x) => x.id === matrix.data!.languageVersionId);
                  return v ? <span className="inline-flex items-center gap-2"><LangBadge lang={v.language} />{v.title}</span> : null;
                })()}
                <SampleSize n={matrix.data.n} />
                {!versionId && matrix.data.versions.length > 1 && <span>{t('dashboard.matrix.pickLanguage')}</span>}
              </div>
            )}
            {matrix.isLoading ? (
              <LoadingRows rows={3} />
            ) : matrix.isError ? (
              <LoadError error={matrix.error} onRetry={() => void matrix.refetch()} retrying={matrix.isFetching} />
            ) : !matrix.data || matrix.data.rows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-body text-fg-2">{t('dashboard.matrix.empty')}</p>
            ) : (
              <CohortMatrix data={matrix.data} />
            )}
          </Card>

          {/* items-start: карточка рубрики не растягивается на высоту длинного списка тестов */}
          <div className="grid items-start gap-6 lg:grid-cols-2">
            {/* Тесты модулей: зачётный балл, сдача, анализ заданий */}
            <Card className="!p-4 sm:!p-6">
              <SectionTitle hint={t('dashboard.quizzesHint')}>{t('dashboard.quizzesTitle')}</SectionTitle>
              {quizRows.length === 0 ? (
                <p className="py-6 text-center text-body text-fg-2">{t('dashboard.noData')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {quizRows.map((q) => (
                    <li key={q.quizId} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start gap-2">
                        <LangBadge lang={q.language} className="mt-0.5 shrink-0" />
                        <span className="grid h-6 min-w-[1.5rem] shrink-0 place-items-center rounded-md bg-ink px-1 font-display text-small font-semibold text-white dark:bg-fg dark:text-ink">
                          {romanNumeral(q.moduleOrderIndex)}
                        </span>
                        <span className="min-w-0 flex-1 text-body font-medium text-fg" lang={q.language}>{q.title}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-[4.25rem] text-small text-fg-2">
                        <span>
                          {t('dashboard.countedScore')}: <span className="num text-small text-fg">{q.avgCountedScore === null ? '—' : formatPercent(q.avgCountedScore)}</span>
                        </span>
                        <span>
                          {t('dashboard.passRateShort')}: <span className="num text-small text-fg">{q.passRate === null ? '—' : formatPercent(q.passRate)}</span>
                        </span>
                        <SampleSize n={q.n} />
                        <button type="button" onClick={() => setItemsQuiz(q.quizId)} className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
                          <Icon name="bar-chart" size={14} />
                          {t('dashboard.items.link')}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Критическое мышление — рубрика 0–3 (на широких экранах остаётся в поле зрения) */}
            <Card className="!p-4 sm:!p-6 lg:sticky lg:top-[5.25rem]">
              <SectionTitle hint={t('dashboard.rubricHint')}>{t('dashboard.criticalThinking')}</SectionTitle>
              {d.practical.rubricN === 0 ? (
                <p className="py-6 text-center text-body text-fg-2">{t('dashboard.noData')}</p>
              ) : (
                <RubricBars
                  scores={{
                    methodicalness: d.practical.rubric.avg_methodicalness,
                    question_quality: d.practical.rubric.avg_question_quality,
                    logical_progression: d.practical.rubric.avg_logical_progression,
                    self_correction: d.practical.rubric.avg_self_correction,
                  }}
                />
              )}
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-small text-fg-2">
                <SampleSize n={d.practical.rubricN} unit="attempts" />
                <span>{t('dashboard.avgMessages')}: <span className="num text-small text-fg">{d.practical.avgMessages}</span></span>
                <span>{t('dashboard.avgTokens')}: <span className="num text-small text-fg">{formatNumber(d.practical.avgTokens)}</span></span>
                <span>{t('dashboard.estCost')}: <span className="num text-small text-fg">${d.practical.estCostUsd}</span></span>
              </div>
            </Card>
          </div>

          {/* Сложные вопросы (FR-10.3) */}
          {d.quizzes.hardQuestions.length > 0 && (
            <Card className="!p-4 sm:!p-6">
              <SectionTitle hint={t('dashboard.hardHint')}>{t('dashboard.hardQuestions')}</SectionTitle>
              <ul className="grid gap-4 md:grid-cols-2">
                {d.quizzes.hardQuestions.slice(0, 8).map((q) => (
                  <li key={q.questionId}>
                    <div className="mb-1 flex items-start justify-between gap-3">
                      <span className="line-clamp-2 text-body text-fg">{q.prompt}</span>
                      <span className="num shrink-0 font-semibold text-danger-ink">{formatPercent(q.errorRate)}</span>
                    </div>
                    <MeterBar value={q.errorRate} tone="danger" />
                    <div className="mt-1 text-small text-fg-2">{t('dashboard.answersCount', { count: q.attempts })}</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* По студентам (FR-10.2) */}
          <Card className="!p-4 sm:!p-6">
            <SectionTitle hint={t('dashboard.perStudentHint')}>{t('dashboard.perStudent')}</SectionTitle>
            {students.isLoading ? (
              <LoadingRows rows={3} />
            ) : students.isError ? (
              <LoadError error={students.error} onRetry={() => void students.refetch()} retrying={students.isFetching} />
            ) : studentRows.length === 0 ? (
              <p className="py-6 text-center text-body text-fg-2">{t('dashboard.noData')}</p>
            ) : (
              <>
                {/* Телефон: карточки «имя / когорта · язык / прогресс · балл · практикум · дни» */}
                <ul className="divide-y divide-border sm:hidden" aria-label={t('dashboard.perStudent')}>
                  {studentRows.map((s) => (
                    <li key={s.enrollmentId} className="py-3 first:pt-0 last:pb-0">
                      <div className="font-semibold text-fg [overflow-wrap:anywhere]">{s.name}</div>
                      <div className="mt-0.5 text-meta text-fg-2">
                        {[s.cohortId && cohortName(s.cohortId), t(`languages.${s.language}`, { defaultValue: s.language }), s.status === 'COMPLETED' && t('dashboard.completed')]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-small">
                        <StudentStat label={t('dashboard.progress')}><span className="num text-fg">{Math.round(s.progressPercent)}%</span></StudentStat>
                        <StudentStat label={t('dashboard.countedScore')}><span className="num text-fg">{s.avgQuizScore === null ? '—' : formatPercent(s.avgQuizScore)}</span></StudentStat>
                        <StudentStat label={t('dashboard.practicalCol')}>
                          <span className="text-fg">{s.practicalOutcome ? t(`dashboard.outcome.${s.practicalOutcome.outcome}`, { defaultValue: s.practicalOutcome.outcome }) : '—'}</span>
                        </StudentStat>
                        <StudentStat label={t('dashboard.duration')}><span className="num text-fg">{s.durationDays === null ? '—' : s.durationDays}</span></StudentStat>
                      </dl>
                    </li>
                  ))}
                </ul>
                <div className="relative hidden overflow-x-auto rounded-xl border border-border sm:block" role="region" aria-label={t('dashboard.perStudent')} tabIndex={0}>
                  <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-body">
                    <thead>
                      <tr className="text-left text-small text-fg-2">
                        <th scope="col" className="sticky left-0 z-10 border-b border-r border-border bg-card px-3 py-2 font-semibold">{t('dashboard.student')}</th>
                        <th scope="col" className="border-b border-border px-3 py-2 font-semibold">{t('dashboard.cohort')}</th>
                        <th scope="col" className="border-b border-border px-3 py-2 font-semibold">{t('dashboard.language')}</th>
                        <th scope="col" className="border-b border-border px-3 py-2 font-semibold">{t('dashboard.progress')}</th>
                        <th scope="col" className="border-b border-border px-3 py-2 font-semibold">{t('dashboard.countedScore')}</th>
                        <th scope="col" className="border-b border-border px-3 py-2 font-semibold">{t('dashboard.practicalCol')}</th>
                        <th scope="col" className="border-b border-border px-3 py-2 font-semibold">{t('dashboard.duration')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {studentRows.map((s) => (
                        <tr key={s.enrollmentId}>
                          <th scope="row" className="sticky left-0 z-10 max-w-[14rem] border-b border-r border-border bg-card px-3 py-2 text-left font-medium text-fg">
                            <span className="block truncate" title={s.name}>{s.name}</span>
                            {s.status === 'COMPLETED' && <span className="block text-small font-normal text-teal-ink">{t('dashboard.completed')}</span>}
                          </th>
                          <td className="border-b border-border px-3 py-2 text-fg-2">{cohortName(s.cohortId)}</td>
                          <td className="border-b border-border px-3 py-2"><LangBadge lang={s.language} /></td>
                          <td className="border-b border-border px-3 py-2"><span className="num text-fg">{Math.round(s.progressPercent)}%</span></td>
                          <td className="border-b border-border px-3 py-2"><span className="num text-fg">{s.avgQuizScore === null ? '—' : formatPercent(s.avgQuizScore)}</span></td>
                          <td className="border-b border-border px-3 py-2 text-fg-2">
                            {s.practicalOutcome ? t(`dashboard.outcome.${s.practicalOutcome.outcome}`, { defaultValue: s.practicalOutcome.outcome }) : '—'}
                          </td>
                          <td className="border-b border-border px-3 py-2"><span className="num text-fg">{s.durationDays === null ? '—' : s.durationDays}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      <ItemAnalysisSheet quizId={itemsQuiz} courseId={courseId || null} onClose={() => setItemsQuiz(null)} />
    </>
  );
}

/** Пара «подпись — значение» в карточке студента (телефон). */
function StudentStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-2">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
