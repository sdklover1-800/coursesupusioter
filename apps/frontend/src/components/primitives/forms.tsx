import { clsx } from 'clsx';
import {
  forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';

/* ── Поля ввода (staff-формы плоские, без «губы») ───────── */
// Размеры (отступы, 15/20, высота селекта) — компонентные классы .field/.field-select в index.css:
// утилиты страницы (h-9 py-1 text-xs в таблицах) их переопределяют, а не проигрывают по порядку CSS.
const fieldBase =
  'field w-full rounded-xl bg-card border border-border text-fg placeholder:text-muted transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={clsx(fieldBase, className)} {...p} />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={clsx(fieldBase, 'field-textarea min-h-[96px] resize-y', className)} {...p} />
));
Textarea.displayName = 'Textarea';

/** Шеврон селекта (data: URI разрешён CSP img-src; цвет — muted, читается в обеих темах). */
const SELECT_CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M4 6l4 4 4-4' stroke='%236C6E84' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`;

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, style, ...p }, ref) => (
  <select
    ref={ref}
    className={clsx(fieldBase, 'field-select cursor-pointer appearance-none bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat', className)}
    style={{ backgroundImage: SELECT_CHEVRON, ...style }}
    {...p}
  >
    {children}
  </select>
));
Select.displayName = 'Select';

export function Field({ label, hint, error, children }: { label?: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      {label && <span className="text-sm font-semibold text-fg">{label}</span>}
      {children}
      {hint && !error && <span className="block text-small text-fg-2">{hint}</span>}
      {error && <span className="block text-small font-medium text-danger-ink">{error}</span>}
    </label>
  );
}

/* ── Card (e1) ──────────────────────────────────────────── */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('card p-6', className)}>{children}</div>;
}
