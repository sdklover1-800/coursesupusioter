import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { VerifyResult } from '@edu/shared';
import { api, ApiError } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { Button, Card, Icon, Input, Spinner } from '../../components/ui';
import { cleanModuleTitle, languageName, romanOf } from '../../components/course/labels';

/** Номер как на сертификате: без пробелов, верхним регистром (сервер регистр не различает). */
const normalize = (s: string) => s.replace(/\s+/g, '').toUpperCase();

/**
 * Публичная проверка сертификата (Enbek «Проверка подлинности», Coursera verify URL):
 * /verify — форма с моно-полем номера; /verify/:serial — результат. Показывается только
 * напечатанное на сертификате: ФИО, курс, язык, дата, модули, эмитент — без email, группы
 * и баллов. Неизвестный номер: сервер отвечает 404 { valid:false } → «Сертификат не найден».
 */
export function VerifyCertificatePage() {
  const { t } = useTranslation();
  const { serial: rawSerial } = useParams();
  const serial = rawSerial ? normalize(decodeURIComponent(rawSerial)) : '';
  const navigate = useNavigate();
  const [value, setValue] = useState(serial);
  const [touched, setTouched] = useState(false);
  useEffect(() => setValue(serial), [serial]);
  useDocumentTitle(serial ? `${t('verify.title')} ${serial}` : t('verify.title'));

  const q = useQuery({
    queryKey: ['verify', serial],
    queryFn: async (): Promise<VerifyResult> => {
      try {
        return await api.get<VerifyResult>(`/verify/${encodeURIComponent(serial)}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return { valid: false };
        throw e;
      }
    },
    enabled: !!serial,
    retry: false,
    staleTime: 60_000,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    const v = normalize(value);
    if (!v) return;
    navigate(`/verify/${encodeURIComponent(v)}`);
  }

  const emptyError = touched && !normalize(value);
  const tooMany = q.error instanceof ApiError && q.error.status === 429;

  return (
    <div className="mx-auto w-full max-w-xl">
      <Card className="!p-5 sm:!p-8">
        <p className="eyebrow">{t('verify.eyebrow')}</p>
        <h1 className="mt-1 font-display text-display-lg">{t('verify.title')}</h1>
        <p className="mt-2 text-body text-fg-2">{t('verify.lead')}</p>
        <form onSubmit={submit} noValidate className="mt-5">
          <label htmlFor="verify-serial" className="text-label font-semibold text-fg">{t('verify.label')}</label>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <Input
              id="verify-serial"
              name="serial"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t('verify.placeholder')}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={emptyError || undefined}
              aria-describedby={emptyError ? 'verify-serial-error' : undefined}
              className="font-mono tracking-wide sm:flex-1"
            />
            <Button type="submit" loading={q.isFetching} className="shrink-0">
              {t('verify.submit')}
            </Button>
          </div>
          {emptyError && (
            <p id="verify-serial-error" className="mt-1.5 text-small font-medium text-danger-ink">{t('verify.empty')}</p>
          )}
        </form>
      </Card>

      {serial && (
        <div className="mt-4" aria-live="polite">
          {q.isLoading ? (
            <Card className="flex items-center gap-3 !p-5 text-body text-fg-2">
              <Spinner className="h-5 w-5 text-brand" />
              {t('verify.checking')}
            </Card>
          ) : q.isError ? (
            <Card className="!p-5" >
              <p role="alert" className="flex items-start gap-2 text-body text-danger-ink">
                <Icon name="alert" size={20} className="mt-0.5" />
                {tooMany ? t('verify.tooMany') : t('verify.error')}
              </p>
            </Card>
          ) : q.data?.valid ? (
            <ValidResult result={q.data} />
          ) : q.data ? (
            <Card className="!border-danger/40 !p-5 sm:!p-6">
              <p className="flex items-center gap-3 font-sans text-title text-danger-ink">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-danger-ink" aria-hidden>
                  <Icon name="x" size={18} strokeWidth={2.5} />
                </span>
                {t('verify.invalid')}
              </p>
              <p className="mt-2 text-body text-fg-2">{t('verify.invalidHint')}</p>
              <p className="mt-3 flex flex-wrap gap-x-2 text-meta text-fg-2">
                <span>{t('verify.number')}:</span>
                <span className="num break-all text-fg">{serial}</span>
              </p>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ValidResult({ result: r }: { result: Extract<VerifyResult, { valid: true }> }) {
  const { t } = useTranslation();
  const { formatDate } = useFormat();
  const rows: { key: string; label: string; value: ReactNode }[] = [
    { key: 'holder', label: t('verify.holder'), value: <span className="font-semibold">{r.holderName}</span> },
    { key: 'course', label: t('verify.course'), value: <span lang={r.language}>{r.courseTitle}</span> },
    { key: 'language', label: t('verify.language'), value: languageName(t, r.language) },
    { key: 'issued', label: t('verify.issuedAt'), value: formatDate(r.issuedAt, 'long') },
    { key: 'issuer', label: t('verify.issuer'), value: r.issuer },
    { key: 'number', label: t('verify.number'), value: <span className="num break-all">{r.serialNumber}</span> },
  ];
  return (
    <Card className="!border-teal-ink/50 !p-5 sm:!p-6">
      <p className="flex items-center gap-3 font-sans text-title text-teal-ink">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-teal/12 ring-2 ring-teal-ink" aria-hidden>
          <Icon name="check" size={20} strokeWidth={2.5} />
        </span>
        {t('verify.valid')}
      </p>
      <dl className="mt-5 divide-y divide-border border-y border-border">
        {rows.map((row) => (
          <div key={row.key} className="grid gap-1 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-meta text-fg-2">{row.label}</dt>
            <dd className="text-body text-fg">{row.value}</dd>
          </div>
        ))}
        {r.moduleTitles.length > 0 && (
          <div className="grid gap-1 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-meta text-fg-2">{t('verify.modules')}</dt>
            <dd>
              <ol className="space-y-1.5 text-body text-fg" lang={r.language}>
                {r.moduleTitles.map((m, i) => (
                  <li key={`${i}-${m}`} className="flex gap-2">
                    <span className="w-7 shrink-0 font-display font-semibold text-fg-2">{romanOf(i)}</span>
                    <span className="min-w-0">{cleanModuleTitle(m)}</span>
                  </li>
                ))}
              </ol>
            </dd>
          </div>
        )}
      </dl>
      <p className="mt-4 flex items-start gap-2 text-small text-fg-2">
        <Icon name="info" size={16} className="mt-0.5" />
        {t('verify.privacy')}
      </p>
    </Card>
  );
}
