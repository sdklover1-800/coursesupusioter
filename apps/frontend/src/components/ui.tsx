import { clsx } from 'clsx';
import {
  forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes, useEffect, useState,
} from 'react';

/* ── Button ─────────────────────────────────────────────── */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'spark';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:brightness-110 shadow-soft',
  secondary: 'bg-card border border-border text-fg hover:border-brand/50',
  ghost: 'text-fg hover:bg-brand-soft',
  danger: 'bg-danger text-white hover:brightness-110',
  spark: 'bg-spark text-ink hover:brightness-105 shadow-soft',
};
const sizes: Record<Size, string> = { sm: 'h-9 px-3 text-sm', md: 'h-11 px-5 text-sm', lg: 'h-12 px-6 text-base' };

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }>(
  ({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150',
        'disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]',
        variants[variant], sizes[size], className,
      )}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

/* ── Inputs ─────────────────────────────────────────────── */
const fieldBase = 'w-full rounded-xl bg-card border border-border px-4 py-2.5 text-sm text-fg placeholder:text-muted transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={clsx(fieldBase, className)} {...p} />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={clsx(fieldBase, 'resize-y min-h-[96px] leading-relaxed', className)} {...p} />
));
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={clsx(fieldBase, 'appearance-none pr-9 bg-[length:16px] cursor-pointer', className)} {...p}>
    {children}
  </select>
));
Select.displayName = 'Select';

export function Field({ label, hint, error, children }: { label?: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      {label && <span className="text-sm font-semibold text-fg">{label}</span>}
      {children}
      {hint && !error && <span className="block text-xs text-muted">{hint}</span>}
      {error && <span className="block text-xs text-danger">{error}</span>}
    </label>
  );
}

/* ── Card ───────────────────────────────────────────────── */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('card p-6', className)}>{children}</div>;
}

/* ── Badge ──────────────────────────────────────────────── */
type Tone = 'brand' | 'spark' | 'teal' | 'danger' | 'muted';
const tones: Record<Tone, string> = {
  brand: 'bg-brand-soft text-brand', spark: 'bg-spark/15 text-spark', teal: 'bg-teal/15 text-teal',
  danger: 'bg-danger/12 text-danger', muted: 'bg-border/60 text-muted',
};
export function Badge({ tone = 'muted', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone], className)}>{children}</span>;
}

/* ── Spinner ────────────────────────────────────────────── */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-label="loading">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ── Skeleton ───────────────────────────────────────────── */
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('shimmer rounded-lg bg-border/50', className)} />;
}

/* ── SIGNATURE: QuestionGlyph — «?» в амбер-кольце (аватар ассистента) ── */
export function QuestionGlyph({ size = 40 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-display font-semibold text-ink shrink-0"
      style={{ width: size, height: size, background: 'rgb(var(--spark))', boxShadow: '0 0 0 4px rgb(var(--spark) / 0.18)' }}
      aria-hidden
    >
      ?
    </span>
  );
}

/**
 * SIGNATURE: InquiryMeter — «бюджет вопросов».
 * Оставшиеся реплики ассистента как сегментированная линия пипов (FR-6.7).
 * Токены не показываем (непрозрачны и зависят от языка).
 */
export function InquiryMeter({ used, max }: { used: number; max: number }) {
  const remaining = Math.max(0, max - used);
  const pips = Array.from({ length: max }, (_, i) => i < used);
  return (
    <div className="flex items-center gap-3" role="meter" aria-valuenow={remaining} aria-valuemax={max}>
      <div className="flex flex-wrap gap-1">
        {pips.map((spent, i) => (
          <span
            key={i}
            className={clsx('h-2.5 w-2.5 rounded-full transition-colors', spent ? 'bg-border' : 'bg-spark animate-pip-in')}
          />
        ))}
      </div>
      <span className="font-mono text-sm font-semibold tabular-nums text-fg whitespace-nowrap">{remaining}</span>
    </div>
  );
}

/* ── Toast (лёгкий) ─────────────────────────────────────── */
let toastFn: ((msg: string, tone?: Tone) => void) | null = null;
export function toast(msg: string, tone: Tone = 'brand') { toastFn?.(msg, tone); }

export function ToastHost() {
  const [items, setItems] = useState<{ id: number; msg: string; tone: Tone }[]>([]);
  useEffect(() => {
    toastFn = (msg, tone = 'brand') => {
      const id = Date.now() + Math.random();
      setItems((s) => [...s, { id, msg, tone }]);
      setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4000);
    };
    return () => { toastFn = null; };
  }, []);
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} className={clsx('card px-4 py-3 text-sm font-medium animate-fade-up max-w-sm', t.tone === 'danger' && 'border-danger/40')}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

/* ── Тема (свет/тьма) ───────────────────────────────────── */
export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (typeof localStorage !== 'undefined' && localStorage.getItem('edu.theme') === 'dark' ? 'dark' : 'light'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('edu.theme', theme);
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}
