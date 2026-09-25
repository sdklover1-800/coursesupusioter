import { useEffect, useRef } from 'react';
import { api } from '../../lib/api';
import { YT_STATE } from '../../lib/youtube';
import type { YouTubePlayerHandle } from './useYouTubePlayer';

/**
 * Автосохранение позиции видео (FR-4.4, critique A14): PATCH /lectures/:id/progress
 * {enrollmentId, positionSec, watchedSec}.
 * - каждые 15 с, пока видео идёт; на паузе/в конце; при уходе со вкладки (visibilitychange)
 *   и при размонтировании/закрытии страницы — с fetch keepalive;
 * - плановые сохранения не чаще раза в 2 с (BE1: 6 запросов за 10 с на пару user+lecture);
 * - watchedSec = сохранённое ранее + реально проигранное на клиенте (сервер берёт максимум);
 * - ошибки (в т.ч. 429) — молча: это фоновая запись, студенту она не мешает.
 * Сохраняем только если видео реально запускали или перематывали — простой визит ничего не пишет.
 */
const PERIOD_MS = 15_000;
const MIN_GAP_MS = 2_000;
const MAX_POSITION = 36_000;

export function useProgressSaver({
  lectureId, enrollmentId, player, baseWatchedSec, enabled,
}: {
  lectureId: string | undefined;
  enrollmentId: string | undefined;
  player: YouTubePlayerHandle;
  /** watchedSec из LectureView — накопленный в прошлые визиты */
  baseWatchedSec: number;
  enabled: boolean;
}) {
  const last = useRef<{ pos: number; watched: number; at: number } | null>(null);
  const touched = useRef(false);
  const trailing = useRef<number | null>(null);
  const live = useRef({ lectureId, enrollmentId, player, baseWatchedSec, enabled });
  live.current = { lectureId, enrollmentId, player, baseWatchedSec, enabled };
  // Последняя известная позиция: при размонтировании плеер может быть уже уничтожен
  const lastTime = useRef(0);
  lastTime.current = player.getTime();

  // Состояние, из которого считается «что сохранять» (одна функция на все поводы)
  const saveRef = useRef<(opts?: { keepalive?: boolean; final?: boolean }) => void>(() => undefined);
  saveRef.current = (opts = {}) => {
    const cur = live.current;
    if (!cur.enabled || !cur.lectureId || !cur.enrollmentId || !touched.current) return;
    const t = opts.final ? lastTime.current : cur.player.getTime();
    const pos = Math.min(MAX_POSITION, Math.max(0, Math.floor(t)));
    const watched = Math.max(0, Math.floor(cur.baseWatchedSec + cur.player.playedSecRef.current));
    const prev = last.current;
    if (prev && prev.pos === pos && prev.watched === watched) return;
    const now = Date.now();
    if (!opts.keepalive && prev && now - prev.at < MIN_GAP_MS) {
      // Слишком часто — одно отложенное сохранение на границе окна
      if (trailing.current === null) {
        trailing.current = window.setTimeout(() => {
          trailing.current = null;
          saveRef.current();
        }, MIN_GAP_MS - (now - prev.at));
      }
      return;
    }
    last.current = { pos, watched, at: now };
    void api
      .patch(`/lectures/${cur.lectureId}/progress`, { enrollmentId: cur.enrollmentId, positionSec: pos, watchedSec: watched }, { keepalive: opts.keepalive })
      .catch(() => undefined);
  };

  // Первое воспроизведение/перемотка — дальше есть что сохранять
  const { state, playing } = player;
  useEffect(() => {
    if (state === YT_STATE.PLAYING || state === YT_STATE.BUFFERING) touched.current = true;
    if (state === YT_STATE.PAUSED || state === YT_STATE.ENDED) saveRef.current();
  }, [state]);

  // Каждые 15 с, пока идёт видео
  useEffect(() => {
    if (!playing || !enabled) return;
    const id = window.setInterval(() => saveRef.current(), PERIOD_MS);
    return () => window.clearInterval(id);
  }, [playing, enabled]);

  // Уход со вкладки / закрытие страницы — keepalive
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') saveRef.current({ keepalive: true });
    };
    const onPageHide = () => saveRef.current({ keepalive: true });
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  // Размонтирование (уход со страницы, другая лекция — страница пересоздаётся по key) —
  // финальное сохранение с keepalive по последней известной позиции
  useEffect(
    () => () => {
      if (trailing.current !== null) {
        window.clearTimeout(trailing.current);
        trailing.current = null;
      }
      saveRef.current({ keepalive: true, final: true });
    },
    [],
  );
}
