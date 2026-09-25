import { clsx } from 'clsx';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Spinner } from './feedback';

/* ── Button (design_direction §1, §3: sentence case, никогда не капсом) ── */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'spark';
export type ButtonSize = 'sm' | 'md' | 'lg';

const variants: Record<ButtonVariant, string> = {
  // brand-fill: белый текст ≥ 4.5:1 в обеих темах (в тёмной brand — светлый, только для текста)
  primary: 'bg-brand-fill text-white hover:brightness-110 shadow-soft',
  secondary: 'bg-card border border-border text-fg hover:border-brand/50 hover:bg-brand-soft/40',
  outline: 'border border-brand/50 bg-transparent text-brand hover:bg-brand-soft',
  ghost: 'text-fg hover:bg-brand-soft',
  danger: 'bg-danger-ink text-white hover:brightness-110 dark:bg-danger dark:text-ink',
  /**
   * ТОЛЬКО для действий тьютора/практикума (амбер — роль тьютора, design_direction §1).
   * Не для общих CTA вроде «Добавить вопрос» — там secondary.
   */
  spark: 'bg-spark text-ink hover:brightness-105 shadow-soft',
};
// Кнопки — 15px (lg — 16px): §12 «читаемость», мельче не делаем.
// Цель касания на мобильных ≥ 44px (§4): sm компактна (36px) только от sm; min-w — для кнопок-иконок.
const sizes: Record<ButtonSize, string> = {
  sm: 'h-11 min-w-11 px-3 text-body sm:h-9 sm:min-w-9',
  md: 'h-11 min-w-11 px-5 text-body',
  lg: 'h-13 px-6 text-base',
};

/**
 * Недоступная кнопка — приглушёнными токенами, а не opacity-50 (давала 2.4–2.6:1):
 * текст fg-2 на border ≈ 7:1, muted на surface-2 ≥ 4.8:1 в обеих темах. На ink-панелях
 * с data-theme="dark" (лобби теста) токены тёмные — кнопка читается как недоступная.
 * disabled: (0,2,0) сильнее вариантов и их hover:.
 */
const FILLED_DISABLED = 'disabled:bg-border disabled:text-fg-2 disabled:shadow-none disabled:filter-none';
const disabledLook: Record<ButtonVariant, string> = {
  primary: FILLED_DISABLED,
  danger: FILLED_DISABLED,
  spark: FILLED_DISABLED,
  secondary: 'disabled:border-border disabled:bg-surface-2 disabled:text-muted',
  outline: 'disabled:border-border disabled:bg-transparent disabled:text-muted',
  ghost: 'disabled:bg-transparent disabled:text-muted',
};

/**
 * Классы кнопки — для ссылок, оформленных как кнопка (<Link className={buttonClass(...)}>).
 * busy — идёт запрос (Button loading): кнопка disabled, но сохраняет цвет варианта рядом со спиннером.
 */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string, busy?: boolean): string {
  return clsx(
    'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150 active:scale-[0.98]',
    variants[variant],
    busy ? 'disabled:cursor-wait' : ['disabled:cursor-not-allowed', disabledLook[variant]],
    sizes[size],
    className,
  );
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }
>(({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }, ref) => (
  <button
    ref={ref}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    className={buttonClass(variant, size, className, !!loading && !disabled)}
    {...props}
  >
    {loading && <Spinner className="h-4 w-4" />}
    {children}
  </button>
));
Button.displayName = 'Button';
