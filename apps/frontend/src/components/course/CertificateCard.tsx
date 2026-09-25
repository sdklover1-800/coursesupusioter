import { useState } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import type { CertificateMissing, CertificateStatus } from '../../lib/learn';
import { routes } from '../../lib/learn';
import { api } from '../../lib/api';
import { apiErrorText } from '../../lib/catalog';
import { useFormat } from '../../lib/format';
import { Button, Card, Icon, StatusIcon, buttonClass, toast } from '../ui';
import { CertificatePreview } from './CertificatePreview';
import { certificateRule, missingLabel } from './labels';

/** Скачать PDF выданного сертификата (GET /me/certificates/:enrollmentId). */
export function useCertificateDownload() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  async function download(enrollmentId: string, serial: string | null) {
    setBusy(true);
    try {
      await api.download(`/me/certificates/${enrollmentId}`, `certificate-${serial ?? enrollmentId}.pdf`);
    } catch (err) {
      toast(apiErrorText(t, err), 'danger');
    } finally {
      setBusy(false);
    }
  }
  return { download, busy };
}

/**
 * Чек-лист недостающего до сертификата: «○ Модульный тест III», «○ Итоговый практикум».
 * max — сколько строк показать, остальное — «и ещё N».
 */
export function MissingList({ missing, max, className }: { missing: CertificateMissing[]; max?: number; className?: string }) {
  const { t } = useTranslation();
  const shown = max && missing.length > max ? missing.slice(0, max - 1) : missing;
  const rest = missing.length - shown.length;
  return (
    <ul className={clsx('space-y-1.5', className)}>
      {shown.map((m, i) => (
        <li key={`${m.kind}-${m.moduleOrderIndex ?? 'x'}-${i}`} className="flex items-start gap-2 text-meta text-fg">
          <StatusIcon state="NOT_STARTED" size={18} className="mt-0.5" />
          <span className="min-w-0">{missingLabel(t, m)}</span>
        </li>
      ))}
      {rest > 0 && <li className="pl-[26px] text-meta text-fg-2">{t('course.certificate.more', { count: rest })}</li>}
    </ul>
  );
}

/**
 * Карточка сертификата (правый рельс курса и главной): правило одной фразой,
 * миниатюра «ОБРАЗЕЦ» (full), список недостающего; выдан — рамка spark-ink,
 * «Сертификат готов» и «Скачать PDF».
 */
export function CertificateCard({
  certificate, enrollmentId, courseTitle, facts, variant = 'full', maxItems, className, headingLevel = 2, eyebrow,
}: {
  certificate: CertificateStatus;
  enrollmentId: string;
  courseTitle: string;
  facts?: { lectures: number; quizModuleIndexes: number[]; hasPractical: boolean };
  variant?: 'full' | 'compact';
  maxItems?: number;
  className?: string;
  headingLevel?: 2 | 3;
  /** Название курса над заголовком (главная) */
  eyebrow?: string;
}) {
  const { t } = useTranslation();
  const { formatDate } = useFormat();
  const { download, busy } = useCertificateDownload();
  const H = headingLevel === 2 ? 'h2' : 'h3';

  if (certificate.issued) {
    return (
      <Card className={clsx('!border-2 !border-spark-ink/70 !p-5', className)}>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-spark text-ink" aria-hidden>
            <Icon name="award" size={22} strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow mb-0.5 line-clamp-1">{eyebrow}</p>}
            <H className="font-sans text-title">{t('course.certificate.ready')}</H>
            <p className="mt-0.5 text-meta text-fg-2">
              {certificate.issuedAt ? t('certificate.issuedOn', { date: formatDate(certificate.issuedAt) }) : null}
            </p>
            {certificate.serialNumber && <p className="num mt-1 break-all text-fg">{certificate.serialNumber}</p>}
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <Button loading={busy} onClick={() => void download(enrollmentId, certificate.serialNumber)} className="w-full">
            <Icon name="download" size={18} />
            {t('course.certificate.download')}
          </Button>
          <Link to={routes.certificates()} className={buttonClass('ghost', 'sm', 'w-full')}>
            {t('course.certificate.all')}
          </Link>
        </div>
      </Card>
    );
  }

  const rule = facts ? certificateRule(t, certificate.rule, facts) : null;
  return (
    <Card className={clsx('!p-5', className)}>
      {eyebrow && <p className="eyebrow mb-0.5 line-clamp-1">{eyebrow}</p>}
      <H className="font-sans text-title">{t('course.certificate.title')}</H>
      {variant === 'full' && <CertificatePreview title={courseTitle} sample className="mt-3" />}
      {rule && <p className="mt-3 text-meta text-fg-2">{rule}</p>}
      {certificate.eligible ? (
        <p className="mt-3 flex items-start gap-2 text-meta font-medium text-teal-ink">
          <StatusIcon state="PASSED" size={18} className="mt-0.5" />
          <span>{t('course.certificate.pending')}</span>
        </p>
      ) : certificate.missing.length > 0 ? (
        <div className="mt-3">
          <p className="text-label text-fg-2">{t('course.certificate.missingTitle')}</p>
          <MissingList missing={certificate.missing} max={maxItems} className="mt-2" />
        </div>
      ) : null}
    </Card>
  );
}
