import { clsx } from 'clsx';
import { useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ApiError } from '../../../lib/api';
import {
  IMPORT_COLUMNS, csvCell, downloadText, useImportUsers, type AdminCohort, type ImportReport,
} from '../../../lib/staffAdmin';
import { Badge, Button, Card, ConfirmDialog, Icon, toast } from '../../ui';
import { EmailText, Notice, Th } from './bits';

/** Серверные сообщения валидации строк (import.service) → локализованные подписи. */
function importError(t: TFunction, msg: string): string {
  const exact: Record<string, string> = {
    'Некорректный email': 'email',
    'Пустое имя': 'name',
    'Неизвестный язык интерфейса': 'language',
    'Дубль email внутри файла': 'duplicate',
    'Email уже существует в системе': 'exists',
  };
  if (exact[msg]) return t(`admin.importFlow.errors.${exact[msg]}`);
  if (msg.startsWith('Email занят аккаунтом с самостоятельной регистрацией')) return t('admin.importFlow.errors.selfRegistered');
  const m = msg.match(/^Когорта «(.+)» не найдена$/);
  if (m) return t('admin.importFlow.errors.cohort', { name: m[1] });
  return msg;
}

const REQUIRED = new Set(['email', 'name']);

/**
 * Импорт студентов (FR-1.3, Приложение A): шаг 1 — предпросмотр (ничего не создаёт),
 * шаг 2 — применение с подтверждением. Локализованная зона перетаскивания, описание
 * столбцов, шаблон CSV и файл стартовых паролей собираются на клиенте (Blob URL).
 */
export function ImportPanel({ cohorts }: { cohorts: AdminCohort[] }) {
  const { t, i18n } = useTranslation();
  const importM = useImportUsers();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [applied, setApplied] = useState<ImportReport | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const step = applied ? 3 : preview ? 2 : 1;
  const report = applied ?? preview;

  const pick = (f: File | null) => {
    setFile(f);
    setPreview(null);
    setApplied(null);
    if (inputRef.current) inputRef.current.value = '';
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) pick(f);
  };
  const fail = (err: unknown) => toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger');

  const check = () => {
    if (!file) return;
    importM.mutate({ file, apply: false }, { onSuccess: (r) => setPreview(r.report), onError: fail });
  };
  const apply = () => {
    if (!file) return;
    importM.mutate(
      { file, apply: true },
      {
        onSuccess: (r) => {
          setConfirmOpen(false);
          setApplied(r.report);
          toast(t('admin.importFlow.appliedTitle'), 'teal');
        },
        onError: (err) => {
          setConfirmOpen(false);
          fail(err);
        },
      },
    );
  };

  const downloadTemplate = () => {
    const lng = (['ru', 'kk', 'en'] as const).find((l) => l === i18n.language) ?? 'ru';
    const example = ['student@example.com', t('admin.importFlow.exampleName'), lng, cohorts[0]?.name ?? ''];
    downloadText(`${IMPORT_COLUMNS.join(',')}\n${example.map(csvCell).join(',')}\n`, t('admin.importFlow.templateFile'));
  };
  const downloadPasswords = () => {
    if (!applied) return;
    const rows = applied.results.filter((r) => r.startPassword);
    const text = ['email,name,start_password', ...rows.map((r) => [r.email, r.name, r.startPassword].map(csvCell).join(','))].join('\n');
    downloadText(`${text}\n`, t('admin.importFlow.passwordsFile'));
  };

  const steps = [
    { n: 1, label: t('admin.importFlow.step1') },
    { n: 2, label: t('admin.importFlow.step2') },
  ];

  return (
    <div className="space-y-6">
      {/* Шаги: Предпросмотр → Применить */}
      <ol aria-label={t('admin.importFlow.steps')} className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {steps.map((s, i) => {
          const done = step > s.n;
          const current = step === s.n;
          return (
            <li key={s.n} className="flex items-center gap-3" aria-current={current ? 'step' : undefined}>
              {i > 0 && <span aria-hidden className="h-px w-8 bg-border-strong" />}
              <span
                className={clsx(
                  'grid h-8 w-8 place-items-center rounded-full border text-sm font-semibold',
                  done ? 'border-transparent bg-ink text-white dark:bg-fg dark:text-ink' : current ? 'border-brand bg-brand-soft text-brand' : 'border-border-strong text-fg-2',
                )}
              >
                {done ? <Icon name="check" size={16} strokeWidth={2} /> : <span className="num">{s.n}</span>}
              </span>
              <span className={clsx('text-body font-semibold', current || done ? 'text-fg' : 'text-fg-2')}>
                <span className="sr-only">{t('admin.importFlow.stepN', { n: s.n })}: </span>
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <Card className="space-y-4">
            {/* Зона перетаскивания (локализованная; нативный input скрыт) */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={clsx(
                'flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors',
                dragOver ? 'border-brand bg-brand-soft/60' : 'border-border-strong bg-surface-2/60',
              )}
            >
              <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand">
                <Icon name="upload" size={24} />
              </span>
              <div className="text-body-lg font-semibold text-fg">{t('admin.importFlow.dropTitle')}</div>
              <div className="flex flex-wrap items-center justify-center gap-2 text-body text-fg-2">
                <span>{t('admin.importFlow.dropOr')}</span>
                <label className="cursor-pointer rounded-lg font-semibold text-brand underline-offset-4 hover:underline focus-within:outline focus-within:outline-2 focus-within:outline-brand">
                  {t('admin.importFlow.choose')}
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls,text/csv"
                    className="sr-only"
                    onChange={(e) => pick(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              <div className="text-small text-fg-2">{t('admin.importFlow.dropHint')}</div>
              {file && (
                <div className="mt-1 inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-body font-medium text-fg">
                  <Icon name="file-text" size={18} className="text-fg-2" />
                  <span className="truncate">{t('admin.importFlow.fileSelected', { name: file.name })}</span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-body text-fg-2">{t('admin.importFlow.checkHint')}</p>
              <Button onClick={check} disabled={!file} loading={importM.isPending} className="shrink-0">
                {t('admin.importFlow.check')}
              </Button>
            </div>
          </Card>

          {/* Описание столбцов + шаблон */}
          <Card>
            <h3 className="text-base font-semibold text-fg">{t('admin.importFlow.columnsTitle')}</h3>
            <dl className="mt-3 divide-y divide-border">
              {IMPORT_COLUMNS.map((c) => (
                <div key={c} className="py-2.5">
                  <dt className="flex flex-wrap items-baseline gap-x-2">
                    <code className="font-mono text-sm font-semibold text-fg">{c}</code>
                    <span className={clsx('text-small', REQUIRED.has(c) ? 'font-semibold text-fg' : 'text-fg-2')}>
                      {REQUIRED.has(c) ? t('admin.importFlow.required') : t('admin.importFlow.optional')}
                    </span>
                  </dt>
                  <dd className="mt-0.5 text-body text-fg-2">{t(`admin.importFlow.col.${c}`)}</dd>
                </div>
              ))}
            </dl>
            <Button variant="secondary" className="mt-4 w-full" onClick={downloadTemplate}>
              <Icon name="download" size={18} />
              {t('admin.importFlow.template')}
            </Button>
          </Card>
        </div>
      )}

      {report && (
        <>
          {applied ? (
            <Notice tone="spark" icon="alert" title={t('admin.importFlow.appliedTitle')}>
              {t('admin.importFlow.passwordsWarning')}
            </Notice>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <Count label={t('admin.importFlow.rowsTotal')} value={report.total} />
            <Count label={applied ? t('admin.importFlow.status.created') : t('admin.importFlow.rowsReady')} value={report.valid} tone="teal" />
            <Count label={t('admin.importFlow.rowsError')} value={report.invalid} tone={report.invalid ? 'danger' : undefined} />
          </div>

          {/* Мобильные: строки отчёта — карточками (ошибки видны без горизонтальной прокрутки) */}
          <ul className="space-y-2 sm:hidden">
            {report.results.map((r) => {
              const bad = r.errors.length > 0;
              return (
                <li key={r.rowNumber} className={clsx('card space-y-1.5 p-4', bad && '!border-danger/30 bg-danger/8')}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-label text-fg-2">
                      {t('admin.importFlow.colRow')} <span className="num text-fg">{r.rowNumber}</span>
                    </span>
                    <RowStatus bad={bad} applied={!!applied} />
                  </div>
                  <div className="font-semibold text-fg">{r.name || '—'}</div>
                  <EmailText email={r.email || '—'} className="block text-meta text-fg-2" />
                  {bad && (
                    <ul className="space-y-1 text-body text-danger-ink">
                      {r.errors.map((err, i) => (
                        <li key={i}>{importError(t, err)}</li>
                      ))}
                    </ul>
                  )}
                  {applied && r.startPassword && <div className="font-mono text-base font-semibold tabular-nums text-fg">{r.startPassword}</div>}
                </li>
              );
            })}
          </ul>

          <Card className="hidden !p-0 sm:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-body">
                <thead className="border-b border-border">
                  <tr>
                    <Th className="w-20">{t('admin.importFlow.colRow')}</Th>
                    <Th>{t('admin.email')}</Th>
                    <Th>{t('admin.fullName')}</Th>
                    <Th>{t('admin.importFlow.colCheck')}</Th>
                    {applied && <Th>{t('admin.startPassword')}</Th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.results.map((r) => {
                    const bad = r.errors.length > 0;
                    return (
                      <tr key={r.rowNumber} className={clsx('align-top', bad && 'bg-danger/8')}>
                        <td className="px-4 py-3 num text-fg-2">{r.rowNumber}</td>
                        <td className="px-4 py-3 text-fg">
                          <EmailText email={r.email || '—'} />
                        </td>
                        <td className="px-4 py-3 text-fg">{r.name || '—'}</td>
                        <td className="px-4 py-3">
                          <RowStatus bad={bad} applied={!!applied} />
                          {bad && (
                            <ul className="mt-1.5 space-y-1 text-body text-danger-ink">
                              {r.errors.map((err, i) => (
                                <li key={i}>{importError(t, err)}</li>
                              ))}
                            </ul>
                          )}
                        </td>
                        {applied && <td className="px-4 py-3 font-mono text-sm font-semibold tabular-nums text-fg">{r.startPassword ?? '—'}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <Button variant="secondary" onClick={() => pick(null)}>
              {applied ? t('admin.importFlow.startOver') : t('admin.importFlow.change')}
            </Button>
            {applied ? (
              <Button onClick={downloadPasswords} disabled={!applied.results.some((r) => r.startPassword)}>
                <Icon name="download" size={18} />
                {t('admin.importFlow.downloadPasswords')}
              </Button>
            ) : report.valid > 0 ? (
              <Button onClick={() => setConfirmOpen(true)}>{t('admin.importFlow.apply', { count: report.valid })}</Button>
            ) : (
              <p className="text-body font-medium text-danger-ink">{t('admin.importFlow.nothingToApply')}</p>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t('admin.importFlow.applyTitle')}
        body={t('admin.importFlow.applyBody', { valid: preview?.valid ?? 0, invalid: preview?.invalid ?? 0 })}
        confirmLabel={t('admin.importFlow.apply', { count: preview?.valid ?? 0 })}
        busy={importM.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={apply}
      />
    </div>
  );
}

function RowStatus({ bad, applied }: { bad: boolean; applied: boolean }) {
  const { t } = useTranslation();
  return (
    <Badge tone={bad ? 'danger' : 'teal'}>
      <Icon name={bad ? 'x' : 'check'} size={14} strokeWidth={2} />
      {bad ? t('admin.importFlow.status.error') : applied ? t('admin.importFlow.status.created') : t('admin.importFlow.status.ok')}
    </Badge>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: 'teal' | 'danger' }) {
  return (
    <div className="card flex items-baseline justify-between gap-3 px-5 py-4">
      <span className="text-label text-fg-2">{label}</span>
      <span className={clsx('font-display text-display-md tabular-nums', tone === 'teal' ? 'text-teal-ink' : tone === 'danger' ? 'text-danger-ink' : 'text-fg')}>{value}</span>
    </div>
  );
}
