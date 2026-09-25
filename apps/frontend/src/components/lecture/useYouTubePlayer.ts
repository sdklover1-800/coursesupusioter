import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { isReadingModeVideo, loadYouTubeApi, YT_HOST, YT_STATE, type YTPlayer } from '../../lib/youtube';

/**
 * Плеер лекции через YouTube IFrame API (FR-4.2, screen_specs «Lecture player»).
 * Iframe создаётся ИМПЕРАТИВНО внутри mountRef — React его не пересоздаёт, поэтому
 * мини-плеер (док) двигает обёртку только CSS-ом, без перезагрузки видео.
 * Заглушка PLACEHOLDER_VIDEO_ID или пустой id → режим чтения, API не грузится.
 */
export interface YouTubePlayerHandle {
  mountRef: RefObject<HTMLDivElement>;
  ready: boolean;
  /** YT.PlayerState: -1 не начато, 0 конец, 1 идёт, 2 пауза, 3 буфер, 5 подготовлено */
  state: number;
  currentTime: number;
  duration: number;
  /** Скрипт/плеер не загрузился (сеть, блокировщик) */
  error: boolean;
  readingMode: boolean;
  playing: boolean;
  /** Перемотка; play — сразу воспроизвести (клик по таймкоду/разделу) */
  seekTo: (sec: number, play?: boolean) => void;
  play: () => void;
  pause: () => void;
  /** С начала, не запуская (тост «Продолжаем с 12:40 · С начала») */
  restart: () => void;
  /** Текущая позиция «здесь и сейчас» (для сохранения — без ожидания опроса) */
  getTime: () => number;
  /** Реально проигранные секунды за этот визит (копятся на клиенте, для watchedSec) */
  playedSecRef: MutableRefObject<number>;
}

interface Options {
  /** Старт с секунды (?t= или сохранённая позиция) */
  startSec?: number;
  /** Язык интерфейса плеера */
  lang?: string;
}

const POLL_MS = 500;

export function useYouTubePlayer(videoId: string | null | undefined, opts: Options = {}): YouTubePlayerHandle {
  const readingMode = isReadingModeVideo(videoId);
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const pendingSeek = useRef<{ sec: number; play: boolean } | null>(null);
  // Точка старта берётся при создании плеера (optsStart — последнее значение из пропсов)
  const optsStart = useRef(Math.max(0, Math.floor(opts.startSec ?? 0)));
  optsStart.current = Math.max(0, Math.floor(opts.startSec ?? 0));
  const startRef = useRef(optsStart.current);
  const langRef = useRef(opts.lang);
  const playedSecRef = useRef(0);
  const lastTick = useRef<number | null>(null);

  const [ready, setReady] = useState(false);
  const [state, setState] = useState<number>(YT_STATE.UNSTARTED);
  const [currentTime, setCurrentTime] = useState(startRef.current);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (readingMode || !videoId) return;
    let cancelled = false;
    let host: HTMLDivElement | null = null;
    startRef.current = optsStart.current;
    setReady(false);
    setError(false);
    setState(YT_STATE.UNSTARTED);
    setCurrentTime(startRef.current);
    playedSecRef.current = 0;
    readyRef.current = false;

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !mountRef.current) return;
        host = document.createElement('div');
        host.style.width = '100%';
        host.style.height = '100%';
        mountRef.current.appendChild(host);
        const player = new YT.Player(host, {
          host: YT_HOST,
          videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            enablejsapi: 1,
            origin: window.location.origin,
            rel: 0,
            playsinline: 1,
            modestbranding: 1,
            iv_load_policy: 3,
            ...(startRef.current > 0 ? { start: startRef.current } : {}),
            ...(langRef.current ? { hl: langRef.current } : {}),
          },
          events: {
            onReady: (e) => {
              if (cancelled) return;
              readyRef.current = true;
              setReady(true);
              setDuration(e.target.getDuration() || 0);
              const p = pendingSeek.current;
              if (p) {
                pendingSeek.current = null;
                e.target.seekTo(p.sec, true);
                setCurrentTime(p.sec);
                if (p.play) e.target.playVideo();
              }
            },
            onStateChange: (e) => {
              if (cancelled) return;
              setState(e.data);
              const t = e.target.getCurrentTime();
              if (Number.isFinite(t) && (t > 0 || e.data !== YT_STATE.UNSTARTED)) setCurrentTime(t);
              const d = e.target.getDuration();
              if (d > 0) setDuration(d);
            },
            onError: () => {
              if (!cancelled) setError(true);
            },
          },
        });
        playerRef.current = player;
        // Для приёмочных проверок (puppeteer читает getCurrentTime) — только в dev
        if (import.meta.env.DEV) (window as unknown as { __lecturePlayer?: YTPlayer }).__lecturePlayer = player;
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
      readyRef.current = false;
      try {
        playerRef.current?.destroy();
      } catch {
        /* плеер уже уничтожен */
      }
      playerRef.current = null;
      host?.remove();
    };
  }, [videoId, readingMode]);

  // Опрос позиции раз в 500 мс, пока видео идёт; копим реально проигранное время
  const playing = state === YT_STATE.PLAYING;
  useEffect(() => {
    if (!playing) {
      lastTick.current = null;
      return;
    }
    lastTick.current = performance.now();
    const id = window.setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      const now = performance.now();
      if (lastTick.current !== null) {
        // Не больше секунды за тик: сон вкладки/ноутбука — не просмотр
        playedSecRef.current += Math.min(1, Math.max(0, (now - lastTick.current) / 1000));
      }
      lastTick.current = now;
      const t = p.getCurrentTime();
      if (Number.isFinite(t)) setCurrentTime(t);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [playing]);

  const seekTo = useCallback((sec: number, play = false) => {
    const target = Math.max(0, sec);
    const p = playerRef.current;
    setCurrentTime(target);
    if (!p || !readyRef.current) {
      pendingSeek.current = { sec: target, play };
      return;
    }
    p.seekTo(target, true);
    if (play) p.playVideo();
  }, []);

  const play = useCallback(() => {
    const p = playerRef.current;
    if (p && readyRef.current) p.playVideo();
  }, []);

  const pause = useCallback(() => {
    const p = playerRef.current;
    if (p && readyRef.current) p.pauseVideo();
  }, []);

  const restart = useCallback(() => {
    const p = playerRef.current;
    setCurrentTime(0);
    startRef.current = 0;
    if (!p || !readyRef.current) {
      pendingSeek.current = { sec: 0, play: false };
      return;
    }
    const st = p.getPlayerState();
    p.seekTo(0, true);
    // Из состояния «не начато/подготовлено» seekTo запускает видео — оставляем на паузе
    if (st === YT_STATE.UNSTARTED || st === YT_STATE.CUED) p.pauseVideo();
  }, []);

  const getTime = useCallback(() => {
    const p = playerRef.current;
    if (p && readyRef.current) {
      const t = p.getCurrentTime();
      const st = p.getPlayerState();
      // До первого запуска с ?t=/позиции плеер отдаёт 0 — точка старта ещё не «сыграна»
      if ((st === YT_STATE.UNSTARTED || st === YT_STATE.CUED) && t < 1) return startRef.current;
      if (Number.isFinite(t)) return t;
    }
    return startRef.current;
  }, []);

  return {
    mountRef,
    ready,
    state,
    currentTime,
    duration,
    error,
    readingMode,
    playing,
    seekTo,
    play,
    pause,
    restart,
    getTime,
    playedSecRef,
  };
}
