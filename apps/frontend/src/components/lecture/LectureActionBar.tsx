import { clsx } from 'clsx';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatDuration } from '../../lib/format';
import type { TranscriptSection } from '../../lib/transcript';
import { Button, buttonClass, Menu } from '../ui';
import { Icon } from '../icons';

export interface NavTarget {
  label: string;
  /** Подпись для скринридера, если видимая короче */
  ariaLabel?: string;
  href?: string;
  onClick?: () => void;
}

/**
 * Панель действий под видео (Laracasts/LinkedIn Learning, screen_specs «Lecture player»):
 * «‹ Лекция 4» · отметка «Пройдено» (никогда не уводит со страницы) · «Раздел 3/7 · …»
 * (список разделов) · основная «Далее: Мини-квиз / Лекция 6 / Модульный тест II».
 * «Далее» — рекомендация: порядок изучения свободный (USER_DECISIONS §3).
 */
export function LectureActionBar({
  prev, completed, completing, onComplete, sections, activeSection, onSeekSection, next, outline, wide, className,
}: {
  prev: NavTarget | null;
  completed: boolean;
  completing: boolean;
  onComplete: () => void;
  /** Секции шкалы времени (пусто — «пилюля» разделов скрыта) */
  sections: TranscriptSection[];
  activeSection: TranscriptSection | null;
  onSeekSection: (s: TranscriptSection) => void;
  next: NavTarget;
  /** Кнопка «Содержание» (лист на планшете, раскрыть свёрнутый рельс на десктопе) */
  outline?: { onClick: () => void; expanded?: boolean; className?: string };
  /** Сцена без рельса (или очень широкий экран): в «пилюле» помещается название раздела */
  wide?: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const timed = sections.filter((s) => s.startSec !== null);
  const k = activeSection ? timed.findIndex((s) => s.index === activeSection.index) + 1 : 1;
  const chapterHeading = (activeSection ?? timed[0])?.heading ?? '';

  return (
    <div className={clsx('flex flex-wrap items-center gap-2', className)}>
      {prev &&
        (prev.href ? (
          <Link to={prev.href} aria-label={prev.ariaLabel} title={prev.ariaLabel} className={buttonClass('secondary', 'sm', 'max-w-[12rem] px-3')}>
            <Icon name="chevron-left" size={18} />
            <span className="truncate">{prev.label}</span>
          </Link>
        ) : null)}

      {completed ? (
        <span role="status" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-teal/40 bg-teal/15 px-3 text-body font-semibold text-teal-ink">
          <Icon name="check" size={18} strokeWidth={2} />
          {t('lecture.done')}
        </span>
      ) : (
        <Button variant="secondary" size="sm" loading={completing} onClick={onComplete} className="px-3">
          {!completing && <Icon name="check" size={18} />}
          {t('lecture.markDone')}
        </Button>
      )}

      {timed.length > 1 && (
        <Menu
          align="left"
          triggerLabel={`${t('lecture.sections')}: ${t('lecture.chapter', { k, n: timed.length })} · ${chapterHeading}`}
          triggerClassName="!h-9 !rounded-xl border border-border bg-card px-3 hover:!bg-brand-soft/40"
          trigger={
            <span className="inline-flex max-w-[18rem] items-center gap-2 text-body font-medium text-fg">
              <span className="shrink-0 text-fg-2">
                {t('lecture.chapterWord')} <span className="num">{k}/{timed.length}</span>
              </span>
              <span className={clsx('truncate', wide ? 'hidden xl:inline' : 'hidden 2xl:inline')}>{chapterHeading}</span>
              <Icon name="chevron-down" size={16} className="shrink-0 text-fg-2" />
            </span>
          }
          items={timed.map((s, i) => ({
            key: String(s.index),
            checked: activeSection?.index === s.index,
            onSelect: () => onSeekSection(s),
            label: (
              <span className="flex items-baseline gap-3">
                <span className="num shrink-0 text-fg-2">{formatDuration(s.startSec, 'clock', i18n.language)}</span>
                <span className="min-w-0">
                  {i + 1}. {s.heading ?? t('lecture.sectionN', { n: s.index + 1 })}
                </span>
              </span>
            ),
          }))}
        />
      )}

      <div className="ml-auto flex items-center gap-2">
        {outline && (
          <Button variant="secondary" size="sm" onClick={outline.onClick} aria-expanded={outline.expanded} className={clsx('px-3', outline.className)}>
            <Icon name="menu" size={18} />
            {t('lecture.outline.open')}
          </Button>
        )}
        {next.href ? (
          <Link to={next.href} aria-label={next.ariaLabel} className={buttonClass('primary', 'sm', 'max-w-[20rem] px-4')}>
            <span className="truncate">{next.label}</span>
            <Icon name="chevron-right" size={18} />
          </Link>
        ) : (
          <Button size="sm" onClick={next.onClick} aria-label={next.ariaLabel} className="max-w-[20rem] px-4">
            <span className="truncate">{next.label}</span>
            <Icon name="chevron-right" size={18} />
          </Button>
        )}
      </div>
    </div>
  );
}
