import { useEffect, useState } from 'react';

/**
 * Текущее время с тиком раз в periodMs (для обратного отсчёта паузы теста).
 * enabled=false — без таймера. Без «срочности»: по умолчанию раз в 15 с (design_direction §6).
 */
export function useNow(enabled: boolean, periodMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), periodMs);
    return () => window.clearInterval(id);
  }, [enabled, periodMs]);
  return now;
}
