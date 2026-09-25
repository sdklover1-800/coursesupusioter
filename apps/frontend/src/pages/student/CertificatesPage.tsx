import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { isApproved, useMyCourses } from '../../lib/catalog';
import { routes } from '../../lib/learn';
import { useFormat } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useAuth } from '../../lib/auth';
import { Button, Card, Icon, Skeleton, toast } from '../../components/ui';
import { EmptyState, ErrorState, MeterBar, PageHeader } from '../../components/page';
import { LinkButton } from '../../components/enrollment';
import { CertificatePreview } from '../../components/course/CertificatePreview';
import { MissingList, useCertificateDownload } from '../../components/course/CertificateCard';
import { keepTogether, languageName } from '../../components/course/labels';

/** Строка GET /me/certificates (выданные сертификаты допущенных записей). */
interface Cert { id: string; serialNumber: string; issuedAt: string; enrollmentId: string; course: string; language: string }

/** Публичная ссылка проверки — та же, что печатается в PDF рядом с QR-кодом. */
export function verifyLink(serial: string): string {
  return `${window.location.origin}/verify/${encodeURIComponent(serial)}`;
}

/**
 * Сертификаты студента (FR-9.3, screen_specs «Certificates…»): миниатюра, дата (Intl в языке
 * интерфейса), серийный номер, «Скачать PDF» и «Скопировать ссылку для проверки».
 * Пусто — сертификат появится после завершения курса + что осталось по каждому курсу.
 */
export function CertificatesPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('certificate.title'));
  const certs = useQuery({ queryKey: ['my-certs'], queryFn: () => api.get<{ items: Cert[] }>('/me/certificates') });
  const items = certs.data?.items ?? [];

  return (
    <>
      <PageHeader eyebrow={t('certificate.eyebrow')} title={t('certificate.title')} />
      {certs.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
          <Skeleton className="h-80 w-full rounded-2xl" />
          <Skeleton className="h-80 w-full rounded-2xl" />
        </div>
      ) : certs.isError ? (
        <ErrorState message={t('certificate.loadError')} />
      ) : !items.length ? (
        <EmptyCertificates />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((c) => <CertificateItem key={c.id} cert={c} />)}
        </div>
      )}
    </>
  );
}

function CertificateItem({ cert: c }: { cert: Cert }) {
  const { t } = useTranslation();
  const { formatDate } = useFormat();
  const { download, busy } = useCertificateDownload();
  const { user } = useAuth();

  async function copy() {
    const url = verifyLink(c.serialNumber);
    try {
      await navigator.clipboard.writeText(url);
      toast(t('certificate.copied'), 'teal');
    } catch {
      toast(t('certificate.copyFailed', { url }), 'danger', { duration: 8000 });
    }
  }

  return (
    <article className="card flex flex-col p-5">
      <CertificatePreview title={c.course} holder={user?.name} label={`${t('course.certificate.heading')}: ${c.course}`} />
      <h2 className="mt-4 line-clamp-2 font-sans text-title" lang={c.language}>{c.course}</h2>
      <p className="mt-1 text-meta text-fg-2">
        {languageName(t, c.language)} · {t('certificate.issuedOn', { date: keepTogether(formatDate(c.issuedAt)) })}
      </p>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-meta text-fg-2">
        <span>{t('certificate.serial')}:</span>
        <span className="num break-all text-fg">{c.serialNumber}</span>
      </p>
      <div className="mt-auto flex flex-col gap-2 pt-5">
        <Button loading={busy} onClick={() => void download(c.enrollmentId, c.serialNumber)}>
          <Icon name="download" size={18} />
          {t('certificate.download')}
        </Button>
        <Button variant="secondary" onClick={() => void copy()}>
          <Icon name="copy" size={18} />
          {t('certificate.copyLink')}
        </Button>
      </div>
    </article>
  );
}

/** Пустое состояние: по каждому активному курсу — прогресс и что осталось до сертификата. */
function EmptyCertificates() {
  const { t } = useTranslation();
  const mine = useMyCourses();
  const courses = (mine.data?.items ?? []).filter((e) => isApproved(e.status) && e.summary);

  if (mine.isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (!courses.length) {
    return (
      <EmptyState
        title={t('certificate.emptyTitle')}
        hint={t('certificate.emptyNoCourses')}
        action={<LinkButton to="/catalog" className="mt-2">{t('student.openCatalog')}</LinkButton>}
      />
    );
  }
  return (
    <Card className="!p-5 sm:!p-6">
      <div className="flex items-start gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-spark/15 text-spark-ink" aria-hidden>
          <Icon name="award" size={24} />
        </span>
        <div className="min-w-0">
          <h2 className="font-sans text-title">{t('certificate.emptyTitle')}</h2>
          <p className="mt-1 text-meta text-fg-2">{t('certificate.emptyHint')}</p>
        </div>
      </div>
      <ul className="mt-5 grid gap-4 lg:grid-cols-2">
        {courses.map((e) => {
          const s = e.summary!;
          const pct = Math.round(s.progress.percent);
          return (
            <li key={e.id} className="flex flex-col rounded-xl border border-border bg-surface/60 p-4">
              <h3 className="line-clamp-2 text-title" lang={e.languageVersion.language}>{e.languageVersion.title}</h3>
              {/* Процент — в мета-строке, полоса без подписи (§8: ≤ 3 уровня текста) */}
              <p className="mt-1 text-meta text-fg-2">
                {languageName(t, e.languageVersion.language)} · {t('student.completePercent', { percent: pct })}
              </p>
              <div className="mt-3" aria-hidden>
                <MeterBar value={pct / 100} />
              </div>
              {s.certificate.eligible ? (
                <p className="mt-3 text-meta font-medium text-teal-ink">{t('certificate.allDone')}</p>
              ) : (
                <MissingList missing={s.certificate.missing} max={5} className="mt-3" />
              )}
              <div className="mt-auto pt-4">
                <LinkButton to={routes.course(e.courseId, e.id)} variant="secondary" size="sm">
                  {t('certificate.toCourse')}
                  <Icon name="arrow-right" size={16} />
                </LinkButton>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
