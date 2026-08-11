import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Badge, Button, Card } from '../../components/ui';
import { PageHeader, EmptyState, LoadingRows } from '../../components/page';

interface Cert { id: string; serialNumber: string; issuedAt: string; enrollmentId: string; course: string; language: string }

/** Сертификаты студента (FR-9.3): просмотр и повторная загрузка PDF. */
export function CertificatesPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({ queryKey: ['my-certs'], queryFn: () => api.get<{ items: Cert[] }>('/me/certificates') });

  return (
    <>
      <PageHeader eyebrow="Achievements" title={t('student.certificate')} />
      {isLoading ? <LoadingRows /> : !data?.items.length ? (
        <EmptyState title={t('student.noCourses')} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.items.map((c) => (
            <Card key={c.id} className="relative overflow-hidden">
              <div className="bg-inquiry-grid absolute inset-0 opacity-30" />
              <div className="relative">
                <div className="flex items-center justify-between">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-spark font-display text-lg text-ink">✧</span>
                  <Badge tone="brand">{c.language.toUpperCase()}</Badge>
                </div>
                <h3 className="mt-4 text-lg font-semibold">{c.course}</h3>
                <div className="mt-1 font-mono text-xs text-muted">{c.serialNumber}</div>
                <div className="text-xs text-muted">{new Date(c.issuedAt).toLocaleDateString()}</div>
                <Button variant="spark" className="mt-4 w-full" onClick={() => api.download(`/me/certificates/${c.enrollmentId}`, `certificate-${c.serialNumber}.pdf`)}>
                  ⇩ {t('student.downloadCertificate')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
