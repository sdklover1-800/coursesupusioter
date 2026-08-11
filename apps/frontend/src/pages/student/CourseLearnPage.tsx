import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { api } from '../../lib/api';
import { Badge, Card, toast } from '../../components/ui';
import { PageHeader, LoadingRows, MeterBar } from '../../components/page';
import { MiniQuiz } from '../../components/MiniQuiz';

interface CourseLang { id: string; language: string; title: string }

interface LearnData {
  enrollment: { id: string; progressPercent: number; status: string };
  version: {
    id: string; title: string; language: string;
    modules: {
      id: string; title: string; orderIndex: number; assessmentType: string;
      lectures: { id: string; title: string; completed: boolean }[];
      quiz: { id: string; title: string; passed: boolean; bestScore: number | null } | null;
      practicalTask: { id: string; title: string; status: string | null } | null;
    }[];
  };
}

/** Страница прохождения курса: модули, лекции, оценивания + прогресс (FR-8.2). */
export function CourseLearnPage() {
  const { t } = useTranslation();
  const { courseId, enrollmentId } = useParams();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['learn', courseId, enrollmentId],
    queryFn: () => api.get<LearnData>(`/courses/${courseId}/learn?enrollmentId=${enrollmentId}`),
  });
  // FR-3.4: доступные языки прохождения курса — студент выбирает язык сам.
  const langsQuery = useQuery({
    queryKey: ['course-langs', courseId],
    queryFn: () => api.get<{ items: CourseLang[] }>(`/courses/${courseId}/languages`),
  });

  async function switchLanguage(languageVersionId: string) {
    if (languageVersionId === data?.version.id) return;
    try {
      await api.post(`/enrollments/${enrollmentId}/language`, { languageVersionId });
      qc.invalidateQueries({ queryKey: ['learn', courseId, enrollmentId] });
      toast(t('common.success'), 'teal');
    } catch {
      toast(t('errors.generic'), 'danger');
    }
  }

  if (isLoading) return <LoadingRows rows={6} />;
  if (!data) return null;
  const base = `/learn/${courseId}/${enrollmentId}`;
  const langs = langsQuery.data?.items ?? [];

  return (
    <>
      <PageHeader eyebrow={data.version.language.toUpperCase()} title={data.version.title} />

      {langs.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">{t('common.language')}:</span>
          {langs.map((l) => (
            <button
              key={l.id}
              onClick={() => switchLanguage(l.id)}
              className={clsx(
                'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                l.id === data.version.id ? 'border-brand bg-brand text-white' : 'border-border text-muted hover:border-brand/50',
              )}
            >
              {t(`languages.${l.language}`)}
            </button>
          ))}
        </div>
      )}
      <Card className="mb-6 !py-4"><MeterBar value={data.enrollment.progressPercent / 100} label={t('student.progress')} /></Card>

      <div className="space-y-4">
        {data.version.modules.map((m, i) => (
          <Card key={m.id}>
            <div className="mb-4 flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-soft font-mono text-sm font-bold text-brand">{i + 1}</span>
              <h3 className="text-lg font-semibold">{m.title}</h3>
              <Badge tone={m.assessmentType === 'PRACTICAL' ? 'spark' : 'brand'} className="ml-auto">
                {m.assessmentType === 'PRACTICAL' ? t('manager.practical') : t('manager.quiz')}
              </Badge>
            </div>

            <ul className="divide-y divide-border">
              {m.lectures.map((l) => (
                <li key={l.id}>
                  <Link to={`${base}/lecture/${l.id}`} className="flex items-center gap-3 py-2.5 text-sm hover:text-brand">
                    <span className={clsx('grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs', l.completed ? 'bg-teal text-white' : 'border border-border text-muted')}>
                      {l.completed ? '✓' : '▷'}
                    </span>
                    <span className={clsx('flex-1', l.completed && 'text-muted')}>{l.title}</span>
                  </Link>
                </li>
              ))}
            </ul>

            {/* Итоговое оценивание модуля */}
            {m.quiz && (
              <Link to={`${base}/quiz/${m.quiz.id}`} className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 hover:border-brand/50">
                <span className="text-brand">◆</span>
                <span className="flex-1 text-sm font-semibold">{m.quiz.title}</span>
                {m.quiz.passed ? <Badge tone="teal">✓ {t('quiz.passed')} · {Math.round((m.quiz.bestScore ?? 0) * 100)}%</Badge> : <Badge tone="muted">{t('student.start')}</Badge>}
              </Link>
            )}
            {m.practicalTask && (
              <Link to={`${base}/practical/${m.practicalTask.id}`} className="mt-3 flex items-center gap-3 rounded-xl border border-spark/40 bg-spark/5 px-4 py-3 hover:border-spark">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-spark font-display text-sm font-bold text-ink">?</span>
                <span className="flex-1 text-sm font-semibold">{m.practicalTask.title}</span>
                {m.practicalTask.status === 'PASSED' ? <Badge tone="teal">✓ {t('quiz.passed')}</Badge>
                  : m.practicalTask.status === 'FAILED' ? <Badge tone="danger">{t('quiz.failed')}</Badge>
                  : <Badge tone="spark">{t('practical.start')}</Badge>}
              </Link>
            )}
          </Card>
        ))}
      </div>

      {/* Итоговый мини-квиз по всему курсу (тренировочный) */}
      <div className="mt-6">
        <div className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-spark">
          {t('quiz.courseFinalMini')}
        </div>
        <MiniQuiz url={`/language-versions/${data.version.id}/final-mini-quiz`} enrollmentId={enrollmentId!} />
      </div>
    </>
  );
}
