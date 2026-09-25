import type { TFunction } from 'i18next';
import type { LearnItemKind, LectureNeighbor } from '../../lib/learn';

/**
 * Мелкие помощники плеера лекции: римские номера модулей, «чистые» названия
 * (нумерацию рисуем сами — «II · Власть…», моно-номер лекции), подписи «Далее: …».
 */

const ROMAN: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

/** 1 → I, 4 → IV. Ноль/отрицательное → пусто. */
export function toRoman(n: number): string {
  let rest = Math.floor(n);
  if (rest <= 0) return '';
  let out = '';
  for (const [v, s] of ROMAN) {
    while (rest >= v) {
      out += s;
      rest -= v;
    }
  }
  return out;
}

/** Римский номер модуля по orderIndex (0 → I). */
export const moduleRoman = (orderIndex: number | null | undefined): string => toRoman((orderIndex ?? 0) + 1);

/** «Раздел II. Власть…», «II бөлім. Билік…», «Section II. Power…», «Модуль 2. …» → «Власть…». */
export function moduleDisplayTitle(title: string): string {
  const t = title
    .replace(/^\s*(?:Раздел|Модуль|Section|Module|Бөлім|Part|Часть)\s+[IVXLC\d]+\s*[.:)–—-]?\s*/iu, '')
    .replace(/^\s*[IVXLC\d]+\s*(?:-\s*)?(?:бөлім|модуль)\s*[.:)–—-]?\s*/iu, '')
    .trim();
  return t || title;
}

/** «1. Политология как наука…», «Лекция 3. …», «2-дәріс. …» → без номера (номер показываем отдельно). */
export function lectureDisplayTitle(title: string): string {
  const t = title
    .replace(/^\s*(?:Лекция|Lecture|Дәріс)\s*\d+\s*[.:)–—-]?\s*/iu, '')
    .replace(/^\s*\d+\s*-\s*дәріс\s*[.:)–—-]?\s*/iu, '')
    .replace(/^\s*\d+\s*[.)]\s+/u, '')
    .trim();
  return t || title;
}

/** Типизированная цель перехода: «Лекция 6», «Модульный тест II», «Итоговый практикум». */
export function targetLabel(t: TFunction, item: { kind: LearnItemKind; lectureNumber?: number; moduleOrderIndex: number | null }): string {
  switch (item.kind) {
    case 'LECTURE':
      return t('lecture.target.lecture', { n: item.lectureNumber ?? '' });
    case 'MINI_QUIZ':
      return t('lecture.target.miniQuiz');
    case 'MODULE_QUIZ':
      return t('lecture.target.moduleQuiz', { roman: moduleRoman(item.moduleOrderIndex) });
    case 'PRACTICAL':
      return t('lecture.target.practical');
    case 'FINAL_MINI_QUIZ':
      return t('lecture.target.finalMiniQuiz');
    case 'CERTIFICATE':
      return t('lecture.target.certificate');
    default:
      return t('lecture.target.course');
  }
}

export type NeighborLike = LectureNeighbor;

/** Поле ввода/редактор в фокусе — горячие клавиши не перехватываем. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset'].includes(type);
  }
  return false;
}

/** Прокрутка окна так, чтобы элемент оказался на доле `ratio` высоты окна (0.3 — «следить за видео»). */
export function scrollToRatio(el: Element, ratio = 0.3, behavior: ScrollBehavior = 'smooth'): void {
  const top = el.getBoundingClientRect().top + window.scrollY - window.innerHeight * ratio;
  window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? 'auto' : behavior });
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return document.documentElement.classList.contains('a11y') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Безопасное чтение/запись localStorage (приватный режим). */
export function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
export function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* приватный режим */
  }
}
