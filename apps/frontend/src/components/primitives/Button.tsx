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
// Кнопки — 15px (lg — 16px): §12 «читаемость», мельче не делаем
const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-body',
  md: 'h-11 px-5 text-body',
  lg: 'h-13 px-6 text-base',
};

/** Классы кнопки — для ссылок, оформленных как кнопка (<Link className={buttonClass(...)}>). */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string): string {
  return clsx(
    'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150',
    'disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]',
    variants[variant],
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
    className={buttonClass(variant, size, className)}
    {...props}
  >
    {loading && <Spinner className="h-4 w-4" />}
    {children}
  </button>
));
Button.displayName = 'Button';
