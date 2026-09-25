import { clsx } from 'clsx';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../icons';

/**
 * CSS-миниатюра сертификата (screen_specs «Certificates…»): ink-рамка, название курса
 * Geologica, амбер-печать. sample — диагональный водяной знак «ОБРАЗЕЦ» (карта курса,
 * каталог: правило сертификата заранее, как у edX). Размеры — в cqw, масштабируется
 * вместе с карточкой. Картинка целиком: role=img + подпись.
 */
export function CertificatePreview({
  title, sample, holder, serial, className, label,
}: {
  title: string;
  sample?: boolean;
  /** Имя владельца (выданный сертификат) — иначе полоска-заглушка */
  holder?: string;
  serial?: string;
  className?: string;
  label?: string;
}) {
  const { t } = useTranslation();
  const container: CSSProperties = { containerType: 'inline-size' };
  return (
    <div
      role="img"
      aria-label={label ?? (sample ? t('course.certificate.previewLabel', { title }) : title)}
      className={clsx('relative aspect-[1.414/1] w-full overflow-hidden rounded-lg bg-card ring-1 ring-border', className)}
      style={container}
    >
      {/* Уголок-рамка ink */}
      <div className="absolute inset-[5%] rounded-[3px] border-2 border-ink/85 dark:border-fg/60" aria-hidden />
      <div className="absolute inset-[8%] rounded-[2px] border border-ink/25 dark:border-fg/25" aria-hidden />
      {/* Водяной знак — ПОД текстом: миниатюра читается, пометка «образец» видна */}
      {sample && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
          <span
            className="-rotate-[20deg] select-none rounded-md border-2 border-danger-ink/25 px-[3cqw] font-display font-bold uppercase tracking-[0.2em] text-danger-ink/25"
            style={{ fontSize: '9cqw', lineHeight: 1.3 }}
          >
            {t('course.certificate.sample')}
          </span>
        </span>
      )}
      <div className="absolute inset-[12%] flex flex-col items-center justify-center text-center" aria-hidden>
        <span className="font-display font-semibold uppercase tracking-[0.18em] text-fg-2" style={{ fontSize: '4.2cqw', lineHeight: 1.2 }}>
          {t('course.certificate.heading')}
        </span>
        {holder ? (
          <span className="mt-[3cqw] max-w-full truncate font-display font-semibold text-fg" style={{ fontSize: '5.4cqw', lineHeight: 1.2 }}>
            {holder}
          </span>
        ) : (
          <span className="mt-[3.5cqw] block h-[2.2cqw] w-[42%] rounded-full bg-border" />
        )}
        <span className="mt-[1.6cqw] block h-[0.6cqw] w-[30%] rounded-full bg-spark" />
        <span className="mt-[2cqw] text-fg-2" style={{ fontSize: '3.2cqw', lineHeight: 1.25 }}>
          {t('course.certificate.confirms')}
        </span>
        <span
          className="mt-[1.2cqw] line-clamp-2 max-w-[92%] font-display font-semibold text-fg"
          style={{ fontSize: '5cqw', lineHeight: 1.18 }}
        >
          {title}
        </span>
        {serial && (
          <span className="mt-[2cqw] font-mono text-fg-2" style={{ fontSize: '3cqw' }}>
            {serial}
          </span>
        )}
      </div>
      {/* Амбер-печать */}
      <span
        className="absolute bottom-[9%] right-[9%] grid place-items-center rounded-full bg-spark text-ink shadow-soft"
        style={{ width: '13cqw', height: '13cqw' }}
        aria-hidden
      >
        <Icon name="award" size={20} strokeWidth={1.75} style={{ width: '7cqw', height: '7cqw' }} />
      </span>
    </div>
  );
}
