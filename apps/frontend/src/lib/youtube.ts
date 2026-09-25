/**
 * YouTube IFrame API (FR-4.2, screen_specs «Lecture player»): загрузчик на промисе и
 * минимальные типы плеера — без зависимости @types/youtube. Скрипт грузится ОДИН раз
 * (CSP index.html: script-src https://www.youtube.com https://s.ytimg.com,
 * frame-src https://www.youtube-nocookie.com). Плеер — с хоста youtube-nocookie.
 */
import { PLACEHOLDER_VIDEO_ID } from '@edu/shared';

/** Состояния плеера (YT.PlayerState). */
export const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;
export type YTStateCode = (typeof YT_STATE)[keyof typeof YT_STATE];

/** Используемая часть YT.Player. */
export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
}

export interface YTPlayerOptions {
  host?: string;
  videoId: string;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (e: { target: YTPlayer }) => void;
    onStateChange?: (e: { data: number; target: YTPlayer }) => void;
    onError?: (e: { data: number; target: YTPlayer }) => void;
  };
}

export interface YTNamespace {
  Player: new (el: HTMLElement | string, opts: YTPlayerOptions) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_SRC = 'https://www.youtube.com/iframe_api';
/** Хост без cookie до воспроизведения (приватность студентов) */
export const YT_HOST = 'https://www.youtube-nocookie.com';
/** Сеть/CSP/блокировщик могут не пустить скрипт — не ждём вечно */
const LOAD_TIMEOUT_MS = 15_000;

let apiPromise: Promise<YTNamespace> | null = null;

/** Загрузить IFrame API один раз на всё приложение. Ошибка → промис сбрасывается (можно повторить). */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no-window'));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const fail = (why: string) => {
      apiPromise = null;
      reject(new Error(why));
    };
    const timer = window.setTimeout(() => fail('yt-timeout'), LOAD_TIMEOUT_MS);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      window.clearTimeout(timer);
      if (window.YT?.Player) resolve(window.YT);
      else fail('yt-missing');
    };
    if (!document.querySelector(`script[src="${API_SRC}"]`)) {
      const s = document.createElement('script');
      s.src = API_SRC;
      s.async = true;
      s.onerror = () => {
        window.clearTimeout(timer);
        s.remove();
        fail('yt-load');
      };
      document.head.appendChild(s);
    }
  });
  return apiPromise;
}

/** Видео ещё нет (заглушка или пусто) — режим чтения, API не грузим. */
export function isReadingModeVideo(videoId: string | null | undefined): boolean {
  return !videoId || videoId.trim() === '' || videoId === PLACEHOLDER_VIDEO_ID;
}

/** Превью ролика (карточки, постер до загрузки плеера). */
export function youTubeThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}
