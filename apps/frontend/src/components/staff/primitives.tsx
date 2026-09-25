import { clsx } from 'clsx';
import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Textarea } from '../ui';
import { Icon, type IconName } from '../icons';
import { toneClasses, type Tone } from '../../lib/tones';
import { apiErrorMessage, isLowN } from '../../lib/staff';

/**
 * Мелкие элементы поверхностей сотрудника (FE5). Staff UI плоский: без «губы»
 * обучающих плиток (design_direction §5). Подписи из слов — Onest, sentence case,
 * fg-2 (§12); числа — .num.
 */

/* ── Автовысота для длинных полей (формулировки, расшифровки, пояснения) ── */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number; maxHeight?: number }>(
  ({ minRows = 2, maxHeight, className, onChange, value, ...p }, fwd) => {
    const inner = useRef<HTMLTextAreaElement | null>(null);
    const setRef = useCallback(
      (el: HTMLTextAreaElement | null) => {
        inner.current = el;
        if (typeof fwd === 'function') fwd(el);
        else if (fwd) fwd.current = el;
      },
      [fwd],
    );
    const resize = useCallback(() => {
      const el = inner.current;
      if (!el) return;
      el.style.height = 'auto';
      const h = el.scrollHeight + 2;
      el.style.height = `${maxHeight ? Math.min(h, maxHeight) : h}px`;
      el.style.overflowY = maxHeight && h > maxHeight ? 'auto' : 'hidden';
    }, [maxHeight]);
    useLayoutEffect(resize, [value, resize]);
    useEffect(() => {
      window.addEventListener('resize', resize);
      return () => window.removeEventListener('resize', resize);
    }, [resize]);
    return (
      <Textarea
        ref={setRef}
        rows={minRows}
        value={value}
        onChange={(e) => {
          onChange?.(e);
          resize();
        }}
        className={clsx('!min-h-0 !resize-none', className)}
        {...p}
      />
    );
  },
);
AutoTextarea.displayName = 'AutoTextarea';

/* ── Чип «здоровья» / метаданных (13px, иконка + текст; цвет не единственный носитель) ── */
export function MetaChip({
  icon, children, tone = 'muted', title, className,
}: {
  icon?: IconName;
  children: ReactNode;
  tone?: Tone | 'plain';
  title?: string;
  className?: string;
}) {
  const cls = tone === 'plain' ? 'border border-border bg-card text-fg-2' : toneClasses[tone].badge;
  return (
    <span title={title} className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-small font-medium', cls, className)}>
      {icon && <Icon name={icon} size={14} className="shrink-0" />}
      {children}
    </span>
  );
}

/*
 * ── Метка «мало данных» (n < 10, A16) ──
 * Единый вид на «Аналитике» и в «Обзоре» админки: приглушённый текст fg-2 с иконкой,
 * без тонированной плашки (амбер зарезервирован за тьютором и маркером «сейчас/далее», §1).
 */
export function LowDataMark({ label, hint, className }: { label?: string; hint?: string; className?: string }) {
  const { t } = useTranslation();
  const text = label ?? t('dashboard.lowData');
  const title = hint ?? t('dashboard.lowDataHint');
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap text-small text-fg-2', className)} title={title}>
      <Icon name="info" size={14} />
      {text}
      <span className="sr-only">. {title}</span>
    </span>
  );
}

/* ── Размер выборки: «n = 12» и «мало данных» при n < 10 (A16) ── */
export function SampleSize({ n, className, unit = 'students' }: { n: number; className?: string; unit?: 'students' | 'answers' | 'attempts' }) {
  const { t } = useTranslation();
  const low = isLowN(n);
  return (
    <span className={clsx('inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-small text-fg-2', className)}>
      <span title={t(`dashboard.nTitle.${unit}`)}>
        <span className="num text-small">n = {n}</span>
      </span>
      {low && <LowDataMark />}
    </span>
  );
}

/*
 * ── Ошибка загрузки с «Повторить» ──
 * Сообщение — через apiErrorMessage: известные коды переведены, текст сервера показывается
 * только для 4xx (при 5xx — локализованное «Что-то пошло не так», а не «Internal error»).
 */
export function LoadError({ error, onRetry, retrying, className }: { error: unknown; onRetry?: () => void; retrying?: boolean; className?: string }) {
  const { t } = useTranslation();
  return (
    <Card className={clsx('flex flex-col items-center gap-3 border-danger/30 text-center', className)}>
      <div role="alert" className="inline-flex items-start gap-2 text-body text-danger-ink">
        <Icon name="alert" size={18} className="mt-0.5" />
        <span>{apiErrorMessage(error, t)}</span>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} loading={retrying}>
          {!retrying && <Icon name="refresh" size={16} />}
          {t('common.retry')}
        </Button>
      )}
    </Card>
  );
}

/* ── Пустое состояние с нейтральной иконкой (без «?» — это знак тьютора) ── */
export function QuietEmpty({ icon = 'inbox', title, hint, action, className }: { icon?: IconName; title: string; hint?: string; action?: ReactNode; className?: string }) {
  return (
    <Card className={clsx('flex flex-col items-center justify-center gap-3 py-14 text-center', className)}>
      <span className="grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-fg-2" aria-hidden>
        <Icon name={icon} size={24} />
      </span>
      <div className="text-base font-semibold text-fg">{title}</div>
      {hint && <p className="max-w-sm text-body text-fg-2">{hint}</p>}
      {action}
    </Card>
  );
}

/*
 * ── Признак прокрутки у длинного списка с max-height ──
 * Оборачивает прокручиваемый блок (первый потомок) и рисует затухание у верхнего/нижнего края,
 * за которым ещё есть строки: иначе срезанная посередине последняя строка выглядит как конец списка.
 * (Горизонтальные вкладки это уже умеют сами — primitives/nav Tabs.)
 */
const FADE_FROM = { surface: 'from-surface', card: 'from-card' } as const;
export function EdgeFade({ children, bg = 'surface', watch, className }: {
  children: ReactNode;
  /** Цвет подложки под затуханием: фон страницы или карточки */
  bg?: 'surface' | 'card';
  /** Значение, при смене которого пересчитать края (например, число строк) */
  watch?: unknown;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  useEffect(() => {
    const el = host.current?.firstElementChild as HTMLElement | null | undefined;
    if (!el) return;
    const update = () => {
      const max = el.scrollHeight - el.clientHeight;
      const next = { top: el.scrollTop > 2, bottom: el.scrollTop < max - 2 };
      setEdges((prev) => (prev.top === next.top && prev.bottom === next.bottom ? prev : next));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [watch]);

  return (
    <div ref={host} className={clsx('relative', className)}>
      {children}
      {edges.top && <span aria-hidden className={clsx('pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b to-transparent', FADE_FROM[bg])} />}
      {edges.bottom && <span aria-hidden className={clsx('pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t to-transparent', FADE_FROM[bg])} />}
    </div>
  );
}

/* ── Чекбокс выбора строки (с indeterminate) ── */
export function Checkbox({ checked, indeterminate, disabled, onChange, label, className }: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      aria-label={label}
      className={clsx('h-[18px] w-[18px] shrink-0 cursor-pointer rounded accent-[rgb(var(--brand))] disabled:cursor-not-allowed disabled:opacity-40', className)}
    />
  );
}

/* ── Плашка-пояснение (замороженный тест, канонический сценарий, опубликованная версия) ── */
export function Notice({ tone = 'muted', icon = 'info', title, children, action, className }: {
  tone?: Tone;
  icon?: IconName;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const surface: Record<Tone, string> = {
    brand: 'border-brand/30 bg-brand-soft/60',
    ink: 'border-border-strong bg-ink/8',
    spark: 'border-spark-ink/30 bg-spark/12',
    teal: 'border-teal-ink/25 bg-teal/12',
    danger: 'border-danger/30 bg-danger/8',
    muted: 'border-border bg-surface-2',
  };
  const iconCls: Record<Tone, string> = {
    brand: 'text-brand', ink: 'text-fg', spark: 'text-spark-ink', teal: 'text-teal-ink', danger: 'text-danger-ink', muted: 'text-fg-2',
  };
  return (
    <div className={clsx('flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border px-4 py-3', surface[tone], className)}>
      <Icon name={icon} size={20} className={clsx('mt-0.5 shrink-0', iconCls[tone])} />
      <div className="min-w-0 flex-1 basis-56 text-body">
        {title && <div className="font-semibold text-fg">{title}</div>}
        {children && <div className={clsx('text-fg-2', title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ── Секция внутри карточки: заголовок h2/h3 Onest + подпись ── */
export function SectionTitle({ children, hint, action, as: Tag = 'h2', className }: { children: ReactNode; hint?: ReactNode; action?: ReactNode; as?: 'h2' | 'h3'; className?: string }) {
  return (
    <div className={clsx('mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-0">
        <Tag className="text-title">{children}</Tag>
        {hint && <p className="mt-0.5 text-meta text-fg-2">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

/*
 * ── Карточка метрики с размером выборки (n = …, «мало данных») ──
 * Полоса слева — декоративная и нейтральная: teal (успех) и spark (тьютор) на метриках
 * без оценки «хорошо/плохо» вводили бы в заблуждение (§1).
 */
export function MetricCard({ label, value, sub, n, unit }: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  n?: number;
  unit?: 'students' | 'answers' | 'attempts';
}) {
  return (
    <Card className="relative overflow-hidden !p-5">
      <div className="absolute left-0 top-0 h-full w-1 bg-border-strong" aria-hidden />
      <div className="text-label text-fg-2">{label}</div>
      <div className="mt-2 font-display text-3xl font-semibold tabular-nums text-fg">{value}</div>
      {sub && <div className="mt-1 text-small text-fg-2">{sub}</div>}
      {n !== undefined && <SampleSize n={n} unit={unit} className="mt-1.5" />}
    </Card>
  );
}
