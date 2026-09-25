import { clsx } from 'clsx';
import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Textarea } from '../ui';
import { Icon, type IconName } from '../icons';
import { toneClasses, type Tone } from '../../lib/tones';
import { isLowN } from '../../lib/staff';

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

/* ── Размер выборки: «n = 12» и «мало данных» при n < 10 (A16) ── */
export function SampleSize({ n, className, unit = 'students' }: { n: number; className?: string; unit?: 'students' | 'answers' | 'attempts' }) {
  const { t } = useTranslation();
  const low = isLowN(n);
  return (
    <span className={clsx('inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-small text-fg-2', className)}>
      <span title={t(`dashboard.nTitle.${unit}`)}>
        <span className="num text-small">n = {n}</span>
      </span>
      {low && (
        <span className="inline-flex items-center gap-1 text-fg-2" title={t('dashboard.lowDataHint')}>
          <Icon name="info" size={14} />
          {t('dashboard.lowData')}
        </span>
      )}
    </span>
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

/* ── Карточка метрики с размером выборки (n = …, «мало данных») ── */
export function MetricCard({ label, value, sub, n, unit, tone = 'brand' }: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  n?: number;
  unit?: 'students' | 'answers' | 'attempts';
  tone?: 'brand' | 'spark' | 'teal' | 'ink';
}) {
  return (
    <Card className="relative overflow-hidden !p-5">
      <div className={clsx('absolute left-0 top-0 h-full w-1', toneClasses[tone].fill)} aria-hidden />
      <div className="text-label text-fg-2">{label}</div>
      <div className="mt-2 font-display text-3xl font-semibold tabular-nums text-fg">{value}</div>
      {sub && <div className="mt-1 text-small text-fg-2">{sub}</div>}
      {n !== undefined && <SampleSize n={n} unit={unit} className="mt-1.5" />}
    </Card>
  );
}
