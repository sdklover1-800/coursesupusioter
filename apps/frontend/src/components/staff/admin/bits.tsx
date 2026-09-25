import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Badge, Icon } from '../../ui';
import { conditionTone, roleTone, toneOf } from '../../../lib/tones';
import { LOW_N, type ConsentState } from '../../../lib/staffAdmin';
import { LowDataMark } from '../primitives';

/**
 * Мелкие общие элементы админ-экранов (FE5b). Подписи условий — ТОЛЬКО t('conditions.*'),
 * тоны — ТОЛЬКО lib/tones (одинаково на «Когортах», «Обзоре» и в «Пользователях»).
 */

/** Подпись условия эксперимента (неизвестный код — как есть). */
export const conditionLabel = (t: TFunction, condition: string | null | undefined): string =>
  condition ? t(`conditions.${condition}`, { defaultValue: condition }) : t('admin.noCohort');

/**
 * Email с точкой переноса перед «@»: длинные адреса переносятся по границе, а не посреди
 * слова (break-all рвал «example.c|om»).
 */
export function EmailText({ email, className }: { email: string; className?: string }) {
  const at = email.indexOf('@');
  return (
    <span className={clsx('[overflow-wrap:anywhere]', className)}>
      {at > 0 ? (
        <>
          {email.slice(0, at)}
          <wbr />
          {email.slice(at)}
        </>
      ) : (
        email
      )}
    </span>
  );
}

/** Бейдж условия эксперимента когорты. */
export function ConditionBadge({ condition, className }: { condition: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <Badge tone={toneOf(conditionTone, condition)} className={className}>
      {conditionLabel(t, condition)}
    </Badge>
  );
}

/** Бейдж роли (показывается один раз в строке). */
export function RoleBadge({ role, className }: { role: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <Badge tone={toneOf(roleTone, role)} className={className}>
      {t(`roles.${role}`, { defaultValue: role })}
    </Badge>
  );
}

/**
 * Статус согласия: глиф + слово (+ «версия 2026-07-01» — именно версия документа, а не дата
 * согласия: подпись словом, чтобы её не читали как «дал согласие 1 июля»). Цвет не единственный носитель смысла.
 */
export function ConsentMark({ state, version, compact }: { state: ConsentState; version?: string | null; compact?: boolean }) {
  const { t } = useTranslation();
  if (state === 'missing') {
    return (
      <span className="inline-flex items-center gap-1.5 text-fg-2">
        <span aria-hidden className="w-4 text-center">—</span>
        {t('admin.consent.missing')}
      </span>
    );
  }
  const given = state === 'given';
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className={clsx('inline-flex items-center gap-1.5 font-medium', given ? 'text-teal-ink' : 'text-spark-ink')}>
        <Icon name={given ? 'check' : 'alert'} size={16} strokeWidth={2} />
        {t(`admin.consent.${state}`)}
      </span>
      {version && !compact && <span className="text-small text-fg-2">{t('admin.consent.version', { version })}</span>}
    </span>
  );
}

/**
 * Метка «мало данных» (n < 10) — тот же приглушённый вид, что у SampleSize на «Аналитике»
 * (без амбер-плашки: амбер зарезервирован за тьютором, §1); подсказка — про базу обзора.
 */
export function LowNBadge({ n, className }: { n: number; className?: string }) {
  const { t } = useTranslation();
  if (n >= LOW_N) return null;
  return <LowDataMark label={t('admin.overviewPage.lowN')} hint={t('admin.overviewPage.lowNHint')} className={className} />;
}

/** Заголовок столбца таблицы: слова — sentence case, 14px, fg-2 (§12: без моно-капса). */
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th scope="col" className={clsx('px-4 py-3 text-left text-label font-medium text-fg-2', className)}>{children}</th>;
}

/** Подзаголовок секции внутри карточки/листа (h3 — Onest 600). */
export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx('mb-3 flex flex-wrap items-center justify-between gap-2', className)}>
      <h3 className="text-base font-semibold text-fg">{children}</h3>
      {action}
    </div>
  );
}

/** Пара «подпись — значение» в сведениях (dl). */
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="text-label text-fg-2 sm:w-44 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 text-body text-fg">{children}</dd>
    </div>
  );
}

/** Предупреждение/пояснение в карточке: иконка + текст (тон spark или danger). */
export function Notice({ tone = 'spark', icon = 'info', title, children, className }: {
  tone?: 'spark' | 'danger' | 'brand';
  icon?: 'info' | 'alert' | 'lock';
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const cls = {
    spark: 'border-spark/40 bg-spark/8 text-spark-ink',
    danger: 'border-danger/30 bg-danger/8 text-danger-ink',
    brand: 'border-brand/25 bg-brand-soft/60 text-brand',
  }[tone];
  return (
    <div className={clsx('flex items-start gap-3 rounded-xl border px-4 py-3', cls, className)}>
      <Icon name={icon} size={20} className="mt-0.5" />
      <div className="min-w-0 text-body text-fg">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={clsx(title && 'mt-0.5', 'text-fg-2')}>{children}</div>}
      </div>
    </div>
  );
}
