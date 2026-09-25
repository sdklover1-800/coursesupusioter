import { clsx } from 'clsx';
import { useEffect, useRef } from 'react';
import { useFormat } from '../../lib/format';
import { useNow } from '../../lib/quiz';

/**
 * Живой обратный отсчёт паузы между попытками «23:41:10» (моно, tabular-nums), абсолютное
 * время — в title (FE3 §5). Скринридер слышит время целиком один раз (без aria-live на каждую
 * секунду). onElapsed — один раз, когда пауза закончилась (страница перезапрашивает лобби).
 */
export function CooldownCountdown({ until, onElapsed, className }: { until: string; onElapsed?: () => void; className?: string }) {
  const f = useFormat();
  const now = useNow(1000);
  const left = new Date(until).getTime() - now;
  const fired = useRef(false);
  const cb = useRef(onElapsed);
  cb.current = onElapsed;

  useEffect(() => {
    fired.current = false;
  }, [until]);
  useEffect(() => {
    if (left <= 0 && !fired.current) {
      fired.current = true;
      cb.current?.();
    }
  }, [left]);

  return (
    <time dateTime={until} title={f.formatDate(until, 'datetime')} className={clsx('num whitespace-nowrap', className)}>
      {f.formatCountdown(until, now)}
    </time>
  );
}
