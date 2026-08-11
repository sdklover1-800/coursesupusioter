import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Badge, Button, Card } from '../../components/ui';
import { PageHeader, EmptyState, LoadingRows } from '../../components/page';

interface Enrollment {
  id: string; courseId: string; status: string; progressPercent: number;
  languageVersion: { id: string; title: string; description: string | null; language: string };
  certificate: { id: string; serialNumber: string } | null;
}

/** «Мои курсы» — прогресс по каждому (FR-8.2). */
export function StudentDashboard() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({ queryKey: ['me-courses'], queryFn: () => api.get<{ items: Enrollment[] }>('/me/courses') });

  return (
    <>
      <PageHeader eyebrow="Inquiry" title={t('student.myLearning')} subtitle={t('auth.subtitle')} />
      {isLoading ? (
        <LoadingRows />
      ) : !data?.items.length ? (
        <EmptyState title={t('student.noCourses')} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.items.map((e) => (
            <Card key={e.id} className="flex flex-col">
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
                <Link to={`/learn/${e.courseId}/${e.id}`} className="flex-1">
                  <Button className="w-full">{e.progressPercent > 0 ? t('student.continueCourse') : t('student.start')}</Button>
                </Link>
                {e.certificate && (
                  <Button variant="spark" onClick={() => api.download(`/me/certificates/${e.id}`, `certificate-${e.certificate!.serialNumber}.pdf`)}>✧</Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
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
