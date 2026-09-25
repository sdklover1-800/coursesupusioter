import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { formatDuration } from '../../lib/format';
import type { TranscriptSection } from '../../lib/transcript';

/**
 * Полоса разделов под видео (YouTube chapters, screen_specs «Lecture player»):
 * сегменты по таймкодам расшифровки с зазором 2px; просмотренное заполняется до
 * текущего времени, текущий раздел — spark (единственный маркер «вы здесь»).
 * Наведение/фокус — подсказка «04:12 · Легитимность», клик — перемотка.
 * В режиме чтения не показывается (страница её не рисует).
 */
export function ChapterStrip({
  sections, duration, currentTime, onSeek, variant = 'stage', className,
}: {
  /** Только секции шкалы (onTimeline) */
  sections: TranscriptSection[];
  /** Длительность ролика, с (0 — неизвестна: берём конец последней секции) */
  duration: number;
  currentTime: number;
  onSeek: (sec: number) => void;
  /**
   * stage — 6px с подсказками; mobile — 4px под липким плеером: только указатель (вне порядка Tab
   * и дерева доступности) — цель 12px меньше 44px (§4), а те же переходы дают таймкоды ▶ конспекта
   */
  variant?: 'stage' | 'mobile';
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const timed = sections.filter((s) => s.startSec !== null);
  if (timed.length < 2) return null;
  const lastSec = timed[timed.length - 1]!;
  const total = Math.max(duration || 0, lastSec.endSec ?? (lastSec.startSec ?? 0) + 60);
  const mobile = variant === 'mobile';

  return (
    <div
      role={mobile ? undefined : 'group'}
      aria-label={mobile ? undefined : t('lecture.chapterStrip')}
      aria-hidden={mobile || undefined}
      className={clsx('flex w-full items-center', mobile ? 'gap-px' : 'gap-[2px]', className)}
    >
      {timed.map((s, i) => {
        const start = s.startSec ?? 0;
        const end = Math.min(total, timed[i + 1]?.startSec ?? s.endSec ?? total);
        const len = Math.max(1, end - start);
        const fill = Math.min(1, Math.max(0, (currentTime - start) / len));
        const isCurrent = currentTime >= start && currentTime < end;
        const time = formatDuration(start, 'clock', i18n.language);
        const heading = s.heading ?? t('lecture.sectionN', { n: s.index + 1 });
        // Подсказка растёт от края сегмента внутрь полосы — не вылезает за сцену (и за окно на планшете)
        const edge = (start + end) / 2 < total / 2 ? 'left-0' : 'right-0';
        return (
          <button
            key={s.index}
            type="button"
            onClick={() => onSeek(start)}
            tabIndex={mobile ? -1 : undefined}
            aria-label={`${t('ui.seekTo', { time })} · ${heading}`}
            aria-current={isCurrent ? 'true' : undefined}
            className={clsx('group relative flex min-w-[6px] items-center focus-visible:outline-offset-4', mobile ? 'h-3' : 'h-6')}
            style={{ flex: `${len} 1 0` }}
          >
            <span
              className={clsx(
                'relative block w-full overflow-hidden rounded-full',
                isCurrent ? 'bg-spark/35' : 'bg-white/20',
                mobile ? 'h-1' : 'h-1.5 transition-[height] group-hover:h-2',
              )}
            >
              <span
                className={clsx('absolute inset-y-0 left-0 rounded-full', isCurrent ? 'bg-spark' : 'bg-brand')}
                style={{ width: `${fill * 100}%` }}
              />
            </span>
            {!mobile && (
              <span
                role="tooltip"
                className={clsx(
                  // Скрыта через display (не opacity): невидимая подсказка не должна расширять страницу
                  'pointer-events-none absolute bottom-full z-10 mb-1.5 hidden max-w-[20rem] truncate whitespace-nowrap rounded-md bg-card px-2 py-1 text-sm text-fg shadow-float ring-1 ring-white/15 group-hover:block group-focus-visible:block',
                  edge,
                )}
              >
                <span className="num">{time}</span> · {heading}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
