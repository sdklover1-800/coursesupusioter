import { clsx } from 'clsx';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useFocusMode } from '../AppShell';

interface ShellBase {
  /** Заголовок FocusBar («Модульный тест II», «Тренировка по модулю») */
  title: string;
  /** ✕ в FocusBar (страница может сначала спросить подтверждение) */
  onExit: () => void;
  exitLabel?: string;
  /** Правый слот FocusBar: чип режима + моно-счётчик «3 / 8» (тёмная палитра) */
  right?: ReactNode;
  /** Полоса прогресса 0..1 под FocusBar */
  progress: number;
  /** Доступное имя полосы прогресса («Вопрос 3 из 8») */
  progressLabel: string;
  /** Под полосой прогресса (горизонтальный навигатор на мобильных) */
  above?: ReactNode;
  /** Правая колонка на lg (рельс навигатора) */
  rail?: ReactNode;
  /** Подвал (фиксированный, safe area): кнопки + статус */
  footer: ReactNode;
  /** Поверхность колонки: тренировка — .surface-practice */
  surfaceClassName?: string;
  /** data-атрибут корня (для проверок DOM) */
  testId?: string;
  children: ReactNode;
}

/**
 * Официальная попытка: полосы обратной связи НЕТ по типу (band?: never). Вместе с
 * FeedbackBand.mode: 'practice' и OptionGroup {mode:'official'; marks?: never} это делает
 * раскрытие правильности в официальном раннере ошибкой компиляции (FE3, правила исследования).
 */
export type QuestionShellProps =
  | (ShellBase & { mode: 'practice'; band?: ReactNode })
  | (ShellBase & { mode: 'official'; band?: never });

/**
 * Оболочка вопроса в режиме фокуса (FE3 §2): FocusBar (✕, заголовок, правый слот),
 * полоса прогресса, колонка 640px (+ рельс справа на lg), фиксированный подвал с safe area:
 * на десктопе основная кнопка справа (≥ 160px), на мобильных — во всю ширину, 52px.
 */
export function QuestionShell(props: QuestionShellProps) {
  const { title, onExit, exitLabel, right, progress, progressLabel, above, rail, footer, surfaceClassName, testId, children } = props;
  useFocusMode({ title, onExit, right, exitLabel });

  // Высота фиксированного подвала → отступ снизу у контента (полоса обратной связи меняет высоту)
  const footerRef = useRef<HTMLDivElement>(null);
  const [footerH, setFooterH] = useState(96);
  useLayoutEffect(() => {
    const el = footerRef.current;
    if (!el) return;
    const update = () => setFooterH(el.getBoundingClientRect().height);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const band = props.mode === 'practice' ? props.band : null;

  return (
    <div data-quiz-shell={props.mode} data-testid={testId}>
      {/* Полоса прогресса: во всю ширину окна под FocusBar (fixed — не зависит от ширины колонки) */}
      <div className="fixed inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-20">
        <div
          role="progressbar"
          aria-label={progressLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-1 w-full bg-border/70"
        >
          <div className="h-full bg-brand transition-[width] duration-300 ease-inquiry" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {above && <div className="-mx-4 -mt-5 border-b border-border bg-card/60 px-4 sm:-mx-6 sm:px-6 lg:hidden">{above}</div>}

      <div
        className={clsx(
          'mx-auto mt-6 w-full',
          rail ? 'max-w-[640px] lg:grid lg:max-w-[944px] lg:grid-cols-[minmax(0,640px)_264px] lg:items-start lg:gap-10' : 'max-w-[640px]',
        )}
      >
        <div className={clsx('min-w-0', surfaceClassName)}>{children}</div>
        {rail && <aside className="hidden lg:sticky lg:top-24 lg:block">{rail}</aside>}
      </div>

      {/* Отступ под фиксированный подвал */}
      <div aria-hidden style={{ height: footerH + 24 }} />

      <div
        ref={footerRef}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur"
      >
        <div className={clsx('mx-auto w-full px-4 py-3 sm:px-6', rail ? 'max-w-[688px] lg:max-w-[992px]' : 'max-w-[688px]')}>
          {/* Длинное пояснение не закрывает весь экран: полоса прокручивается сама */}
          {band && <div className="mb-3 max-h-[40vh] overflow-y-auto overscroll-contain rounded-xl sm:max-h-[45vh]">{band}</div>}
          {footer}
        </div>
      </div>
    </div>
  );
}

/**
 * Строка подвала: слева — вторичные действия и статус, справа — основная кнопка
 * (на мобильных — отдельной строкой во всю ширину).
 */
export function ShellFooter({ start, status, primary }: { start?: ReactNode; status?: ReactNode; primary: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        {start}
        {status && <div className="ml-auto min-w-0 sm:ml-0">{status}</div>}
      </div>
      <div className="flex w-full items-center gap-2 sm:w-auto">{primary}</div>
    </div>
  );
}

/** Классы основной кнопки подвала: во всю ширину 52px на мобильных, ≥ 160px справа на десктопе. */
export const FOOTER_CTA = 'h-13 w-full sm:h-11 sm:w-auto sm:min-w-[160px]';
