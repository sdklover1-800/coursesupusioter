import { clsx } from 'clsx';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../icons';

/**
 * CSS-миниатюра сертификата (screen_specs «Certificates…»): ink-рамка, название курса
 * Geologica, амбер-печать. sample — штамп «Образец» в нижнем левом углу (карта курса,
 * каталог: правило сертификата заранее, как у edX); текст он не перекрывает. Размеры — в cqw,
 * масштабируется вместе с карточкой, но не мельче 13px (§8: без капса и разрядки; серийный
 * номер — в карточке под миниатюрой). Картинка целиком: role=img + подпись.
 */
export function CertificatePreview({
  title, sample, holder, className, label,
}: {
  title: string;
  sample?: boolean;
  /** Имя владельца (выданный сертификат) — иначе полоска-заглушка */
  holder?: string;
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
      <div className="absolute inset-x-[12%] bottom-[20%] top-[10%] flex flex-col items-center justify-center text-center" aria-hidden>
        <span className="font-display font-semibold text-fg-2" style={{ fontSize: 'max(14px, 4.6cqw)', lineHeight: 1.2 }}>
          {t('course.certificate.heading')}
        </span>
        {holder ? (
          <span className="mt-[2.4cqw] max-w-full truncate font-display font-semibold text-fg" style={{ fontSize: 'max(15px, 5.4cqw)', lineHeight: 1.2 }}>
            {holder}
          </span>
        ) : (
          <span className="mt-[3cqw] block h-[2.2cqw] w-[42%] rounded-full bg-border" />
        )}
        <span className="mt-[1.6cqw] block h-[0.6cqw] w-[30%] rounded-full bg-spark" />
        <span className="mt-[1.6cqw] text-fg-2" style={{ fontSize: 'max(13px, 3.4cqw)', lineHeight: 1.25 }}>
          {t('course.certificate.confirms')}
        </span>
        <span
          className="mt-[1cqw] line-clamp-2 max-w-full font-display font-semibold text-fg"
          style={{ fontSize: 'max(14px, 5cqw)', lineHeight: 1.18 }}
        >
          {title}
        </span>
      </div>
      {/* Штамп «Образец» — в углу, под текстом не лежит */}
      {sample && (
        <span
          className="pointer-events-none absolute bottom-[9%] left-[9%] -rotate-6 select-none rounded-md border-2 border-border-strong bg-card/80 px-[1.6cqw] font-display font-bold text-fg-2"
          style={{ fontSize: 'max(13px, 4.6cqw)', lineHeight: 1.35 }}
          aria-hidden
        >
          {t('course.certificate.sample')}
        </span>
      )}
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
