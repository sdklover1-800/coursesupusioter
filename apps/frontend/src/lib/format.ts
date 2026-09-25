import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

/**
 * Форматирование дат, длительностей и процентов в языке интерфейса (design_direction §10).
 * Intl: ru-RU / kk-KZ / en-GB. В ICU браузеров (Chrome) НЕТ казахских названий месяцев —
 * Intl('kk-KZ') даёт «2026 M09 25», поэтому для kk месяцы подставляем сами.
 */
export type Lng = 'ru' | 'kk' | 'en' | string;
export type DateStyle = 'date' | 'long' | 'datetime' | 'time' | 'numeric';
export type DurationStyle = 'clock' | 'human';

const LOCALES: Record<string, string> = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' };
export const intlLocale = (lng: Lng): string => LOCALES[lng] ?? 'ru-RU';

const KK_MONTHS = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'];

type DateInput = Date | string | number | null | undefined;

function toDate(d: DateInput): Date | null {
  if (d === null || d === undefined || d === '') return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Дата: 'date' — «25 сент. 2026 г.» / «25 қыркүйек 2026 ж.» / «25 Sept 2026»;
 * 'long' — с полным месяцем; 'datetime' — дата + время; 'time' — «14:30»; 'numeric' — «25.09.2026».
 * Пустое/некорректное значение → «—».
 */
export function formatDate(date: DateInput, lng: Lng = i18n.language, style: DateStyle = 'date'): string {
  const d = toDate(date);
  if (!d) return '—';
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (style === 'time') return time;
  if (style === 'numeric') return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
  if (lng === 'kk') {
    const base = `${d.getDate()} ${KK_MONTHS[d.getMonth()]} ${d.getFullYear()} ж.`;
    return style === 'datetime' ? `${base}, ${time}` : base;
  }
  const opts: Intl.DateTimeFormatOptions =
    style === 'long'
      ? { day: 'numeric', month: 'long', year: 'numeric' }
      : style === 'datetime'
        ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { day: 'numeric', month: 'short', year: 'numeric' };
  try {
    return new Intl.DateTimeFormat(intlLocale(lng), opts).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

const HUMAN_UNITS: Record<string, { h: string; m: string; s: string }> = {
  ru: { h: 'ч', m: 'мин', s: 'с' },
  kk: { h: 'сағ', m: 'мин', s: 'с' },
  en: { h: 'h', m: 'min', s: 's' },
};

/**
 * Длительность: 'clock' — «22:00» / «1:05:03»; 'human' — «≈ 1 ч 20 мин» / «≈ 1 сағ 20 мин» / «≈ 1 h 20 min»
 * (округление до минуты, меньше минуты — «≈ 1 мин»). null/undefined → «—».
 */
export function formatDuration(sec: number | null | undefined, style: DurationStyle = 'clock', lng: Lng = i18n.language): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  const total = Math.max(0, Math.round(sec));
  if (style === 'clock') {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
  }
  const u = HUMAN_UNITS[lng] ?? HUMAN_UNITS.ru!;
  const minutes = Math.max(1, Math.round(total / 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const parts = [h > 0 ? `${h} ${u.h}` : '', m > 0 || h === 0 ? `${m} ${u.m}` : ''].filter(Boolean);
  return `≈ ${parts.join(' ')}`;
}

/** Обратный отсчёт до момента: «hh:mm:ss» (часы могут быть > 24). Прошедшее время → «00:00:00». */
export function formatCountdown(untilIso: DateInput, now: Date | number = Date.now()): string {
  const d = toDate(untilIso);
  if (!d) return '—';
  const nowMs = now instanceof Date ? now.getTime() : now;
  const left = Math.max(0, Math.floor((d.getTime() - nowMs) / 1000));
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

/**
 * Процент: ratio в долях (0..1) → «83%». digits — знаков после запятой.
 * Единый вид «83%» во всех языках (без неразрывного пробела ru-RU), как в остальном UI.
 */
export function formatPercent(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  const v = ratio * 100;
  return `${digits > 0 ? v.toFixed(digits) : Math.round(v)}%`;
}

/**
 * Числа для kk — по правилам ru-RU: в ICU Chrome нет казахских числовых данных, и Intl('kk-KZ')
 * даёт «12,277» и «1.3» (в Казахстане запятая — десятичный разделитель, «12,277» читается как дробь).
 * Нормы kk и ru совпадают: пробел между разрядами, запятая в дроби.
 */
const numberLocale = (lng: Lng): string => (lng === 'kk' ? 'ru-RU' : intlLocale(lng));

/**
 * Число с разделителями разрядов языка интерфейса: «12 277» (ru/kk), «12,277» (en).
 * digits — ровно столько знаков после запятой: formatNumber(1.3, 'kk', 1) → «1,3».
 */
export function formatNumber(n: number | null | undefined, lng: Lng = i18n.language, digits?: number): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  try {
    const opts: Intl.NumberFormatOptions | undefined = digits === undefined ? undefined : { minimumFractionDigits: digits, maximumFractionDigits: digits };
    return new Intl.NumberFormat(numberLocale(lng), opts).format(n);
  } catch {
    return digits === undefined ? String(n) : n.toFixed(digits);
  }
}

/** Форматтеры, привязанные к текущему языку интерфейса (перерисовка при смене языка). */
export function useFormat() {
  const { i18n: inst } = useTranslation();
  const lng = inst.language;
  return useMemo(
    () => ({
      lng,
      formatDate: (d: DateInput, style: DateStyle = 'date') => formatDate(d, lng, style),
      formatDuration: (sec: number | null | undefined, style: DurationStyle = 'clock') => formatDuration(sec, style, lng),
      formatCountdown: (untilIso: DateInput, now?: Date | number) => formatCountdown(untilIso, now),
      formatPercent,
      formatNumber: (n: number | null | undefined, digits?: number) => formatNumber(n, lng, digits),
    }),
    [lng],
  );
}
