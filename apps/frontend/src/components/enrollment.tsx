import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { ApiError } from '../lib/api';
import { isNotApproved, langCode, notApprovedDetails, useMyCourses, type EnrollmentStatus } from '../lib/catalog';
import { buttonClass, Card, type ButtonSize, type ButtonVariant } from './ui';
import { ErrorState } from './page';

/**
 * Общие элементы потока «каталог → заявка → одобрение»:
 * бейджи языка/статуса, ссылка-кнопка и экран «доступ ещё не открыт»
 * (403 ENROLLMENT_NOT_APPROVED на контентных маршрутах).
 */

/** Ссылка, оформленная как кнопка (без вложения <button> в <a>). */
export function LinkButton({ to, variant = 'primary', size = 'md', className, children }: {
  to: string; variant?: ButtonVariant; size?: ButtonSize; className?: string; children: ReactNode;
}) {
  return <Link to={to} className={buttonClass(variant, size, className)}>{children}</Link>;
}

/**
 * Метка самостоятельной регистрации (менеджер/админ): владение email не проверялось —
 * аккаунт мог создать посторонний на чужой адрес. Перед одобрением заявки ФИО и email
 * сверяют со списком группы. withHint=false — пояснение уже есть рядом текстом.
 */
export function SelfRegisteredChip({ withHint = true, className }: { withHint?: boolean; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      title={withHint ? t('requests.selfRegisteredHint') : undefined}
      className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-spark/15 px-1.5 py-0.5 text-[11px] font-semibold text-fg', className)}
    >
      <span aria-hidden>!</span>{t('requests.selfRegistered')}
      {withHint && <span className="sr-only">. {t('requests.selfRegisteredHint')}</span>}
    </span>
  );
}

/** Бейдж языка версии: RU / KZ / EN. */
export function LangBadge({ lang, active, className }: { lang: string; active?: boolean; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex h-6 items-center rounded-md border px-1.5 font-mono text-[11px] font-semibold tracking-wide',
        active ? 'border-brand bg-brand text-white' : 'border-border bg-card text-muted',
        className,
      )}
    >
      {langCode(lang)}
    </span>
  );
}

const statusDot: Record<EnrollmentStatus, string> = {
  PENDING: 'bg-spark',
  ACTIVE: 'bg-teal',
  COMPLETED: 'bg-teal',
  REJECTED: 'bg-danger',
  WITHDRAWN: 'bg-muted',
};
const statusSurface: Record<EnrollmentStatus, string> = {
  PENDING: 'border-spark/40 bg-spark/10',
  ACTIVE: 'border-teal/35 bg-teal/10',
  COMPLETED: 'border-teal/35 bg-teal/10',
  REJECTED: 'border-danger/30 bg-danger/10',
  WITHDRAWN: 'border-border bg-border/40',
};

/** Статус записи/заявки: цветная точка + текст в fg (читается в обеих темах). */
export function StatusPill({ status, className }: { status: EnrollmentStatus; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold text-fg',
        statusSurface[status] ?? statusSurface.WITHDRAWN,
        className,
      )}
    >
      <span className={clsx('h-1.5 w-1.5 rounded-full', statusDot[status] ?? 'bg-muted', status === 'PENDING' && 'animate-pulse')} aria-hidden />
      {t(`requests.status.${status}`)}
    </span>
  );
}

/** Метка с амбер-точкой (практическое с ИИ-тьютором) — вместо text-spark на светлом фоне. */
export function SparkTag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full bg-spark/15 px-2.5 py-1 text-xs font-semibold text-fg', className)}>
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-spark font-display text-[9px] font-bold text-ink" aria-hidden>?</span>
      {children}
    </span>
  );
}

export function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Дружелюбный экран вместо общей ошибки, когда контент закрыт
 * (заявка на рассмотрении / отклонена / запись отменена).
 */
export function NotApprovedScreen({ courseId, enrollmentId, error }: { courseId?: string; enrollmentId?: string; error?: unknown }) {
  const { t } = useTranslation();
  const mine = useMyCourses();
  const e = mine.data?.items.find((x) => x.id === enrollmentId);
  // Статус — из details ошибки (сервер), иначе из «Моих курсов».
  const details = notApprovedDetails(error);
  const status = details.status ?? e?.status;
  courseId = courseId ?? details.courseId;
  const text =
    status === 'PENDING' ? t('catalog.notApprovedPending')
      : status === 'REJECTED' ? t('catalog.notApprovedRejected')
        : status === 'WITHDRAWN' ? t('catalog.notApprovedWithdrawn')
          : t('catalog.notApprovedGeneric');
  const cid = courseId ?? e?.courseId;

  return (
    <div className="mx-auto max-w-lg py-6 sm:py-12">
      <Card className="relative overflow-hidden !p-8 text-center">
        <div className="bg-inquiry-grid absolute inset-0 opacity-50" aria-hidden />
        <div className="relative">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-soft text-brand shadow-glow">
            <LockIcon className="h-6 w-6" />
          </span>
          {status && <div className="mt-5"><StatusPill status={status} /></div>}
          <h1 className="mt-4 text-xl font-semibold leading-snug">{t('catalog.notApprovedTitle')}</h1>
          {e && <p className="mt-2 text-sm font-semibold text-fg">{e.languageVersion.title}</p>}
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">{text}</p>
          {status === 'REJECTED' && e?.reviewNote && (
            <blockquote className="mx-auto mt-4 max-w-sm rounded-xl border border-border bg-surface px-4 py-3 text-left text-sm">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('catalog.reviewNote')}</div>
              {e.reviewNote}
            </blockquote>
          )}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            {cid && <LinkButton to={`/catalog/${cid}`}>{t('catalog.coursePage')}</LinkButton>}
            <LinkButton to="/" variant="secondary">{t('nav.myCourses')}</LinkButton>
          </div>
        </div>
      </Card>
    </div>
  );
}

/** Ошибка загрузки контента курса: «не одобрено» → дружелюбный экран, иначе — общий. */
export function ContentError({ error, courseId, enrollmentId }: { error: unknown; courseId?: string; enrollmentId?: string }) {
  const { t } = useTranslation();
  if (isNotApproved(error)) return <NotApprovedScreen courseId={courseId} enrollmentId={enrollmentId} error={error} />;
  return <ErrorState message={error instanceof ApiError ? error.message : t('errors.generic')} />;
}
