import { clsx } from 'clsx';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { youTubeThumbnail } from '../../lib/youtube';
import { Spinner } from '../ui';
import { Icon } from '../icons';
import type { YouTubePlayerHandle } from './useYouTubePlayer';
import { prefersReducedMotion } from './lectureUtils';

/** Медиа-запрос как внешнее хранилище (lg — десктоп, sm — мобильная раскладка). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Видео на сцене (screen_specs «Lecture player»): 16:9, скругление на sm+, от края до края
 * на мобильных. Постер (превью YouTube) до готовности плеера, сообщение при ошибке загрузки.
 * МИНИ-ПЛЕЕР (lg+): сцена ушла из виду во время воспроизведения → ОБЁРТКА становится
 * fixed bottom-4 right-4 w-80 (✕ и «К видео»); заглушка той же высоты держит раскладку.
 * Iframe не пересоздаётся — меняются только классы обёртки.
 */
export function LectureStage({
  player, videoId, title, overlay, className,
}: {
  player: YouTubePlayerHandle;
  videoId: string;
  title: string;
  /** Экран окончания (рисуется поверх видео, но не в мини-плеере) */
  overlay?: (docked: boolean) => ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const placeholderRef = useRef<HTMLDivElement>(null);
  const isLg = useMediaQuery('(min-width: 1024px)');
  const [outOfView, setOutOfView] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [docked, setDocked] = useState(false);

  useEffect(() => {
    const el = placeholderRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => setOutOfView(!!entry && (!entry.isIntersecting || entry.intersectionRatio < 0.35)),
      { threshold: [0, 0.35, 0.6, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Док «защёлкивается»: начинается при воспроизведении вне экрана, держится (и на паузе),
  // пока сцена не вернётся в поле зрения или студент не закроет мини-плеер
  useEffect(() => {
    if (!isLg || !outOfView) {
      setDocked(false);
      if (!outOfView) setDismissed(false);
      return;
    }
    if (player.playing && !dismissed) setDocked(true);
  }, [isLg, outOfView, player.playing, dismissed]);

  const closeDock = () => {
    player.pause();
    setDismissed(true);
    setDocked(false);
  };
  const backToVideo = () => {
    placeholderRef.current?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  return (
    <div ref={placeholderRef} className={clsx('relative aspect-video w-full', className)}>
      <div
        className={clsx(
          'overflow-hidden bg-black',
          docked
            ? 'fixed bottom-4 right-4 z-40 w-80 animate-fade-in rounded-xl bg-stage shadow-float ring-1 ring-white/15'
            : 'absolute inset-0 sm:rounded-xl',
        )}
        role="region"
        aria-label={docked ? t('lecture.dock.label') : `${t('lecture.player')}: ${title}`}
      >
        {docked && (
          <div className="flex h-10 items-center justify-between gap-1 px-1.5">
            <button
              type="button"
              onClick={backToVideo}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-white/90 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Icon name="chevron-up" size={16} />
              {t('lecture.dock.toVideo')}
            </button>
            <button
              type="button"
              onClick={closeDock}
              aria-label={t('lecture.dock.close')}
              className="grid h-8 w-8 place-items-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Icon name="x" size={18} />
            </button>
          </div>
        )}
        <div className={clsx('relative w-full', docked ? 'aspect-video' : 'h-full')}>
          {/* Постер до готовности плеера */}
          {!player.ready && !player.error && (
            <div className="absolute inset-0">
              <img src={youTubeThumbnail(videoId)} alt="" className="h-full w-full object-cover opacity-60" />
              <div className="absolute inset-0 grid place-items-center">
                <Spinner className="h-8 w-8 text-white" />
              </div>
            </div>
          )}
          {/* Хост iframe: YouTube IFrame API подменяет вложенный div на iframe */}
          <div ref={player.mountRef} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />
          {player.error && (
            <div className="absolute inset-0 grid place-items-center bg-stage p-6 text-center">
              <div className="max-w-sm">
                <Icon name="alert" size={28} className="mx-auto text-spark" />
                <p className="mt-3 text-body text-white/90">{t('lecture.videoError')}</p>
              </div>
            </div>
          )}
          {overlay?.(docked)}
        </div>
      </div>
    </div>
  );
}

/** Режим чтения: видео ещё нет (заглушка) — узкая плашка вместо плеера. */
export function ReadingModeBanner({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={clsx('flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3.5', className)}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-fg">
        <Icon name="book-open" size={20} />
      </span>
      <p className="text-body font-medium text-fg">{t('lecture.readingMode')}</p>
    </div>
  );
}
