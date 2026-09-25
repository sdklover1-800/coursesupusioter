import { clsx } from 'clsx';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { Tone } from '../../lib/tones';
import { Icon } from '../icons';

/* ── Spinner ────────────────────────────────────────────── */
export function Spinner({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <svg className={clsx('animate-spin', className)} viewBox="0 0 24 24" fill="none" role="img" aria-label={t('common.loading')}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ── Skeleton ───────────────────────────────────────────── */
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('shimmer rounded-lg bg-border/50', className)} aria-hidden />;
}

/* ── Toast (лёгкий; одна живая область role=status) ────── */
export type ToastTone = Tone;
export interface ToastOptions {
  /** Кнопка действия в тосте (например, «С начала» у FE2) */
  action?: { label: string; onClick: () => void };
  /** Длительность показа, мс (по умолчанию 4000; с действием — 6000) */
  duration?: number;
}
interface ToastItem extends ToastOptions {
  id: number;
  msg: string;
  tone: Tone;
}

let toastFn: ((msg: string, tone?: Tone, opts?: ToastOptions) => void) | null = null;
export function toast(msg: string, tone: Tone = 'brand', opts?: ToastOptions) {
  toastFn?.(msg, tone, opts);
}

/*
 * Открытые модальные слои (Dialog/Sheet сообщают через useModalBehavior). Пока слой открыт,
 * тосты уходят к верхнему краю: иначе на мобильных они ложатся на подвал нижнего листа
 * (кнопка подтверждения под тостом не нажимается 4–8 с), а на десктопе — на подвал правой панели.
 */
let modalLayers = 0;
const modalListeners = new Set<() => void>();
export function setModalLayers(count: number) {
  if (count === modalLayers) return;
  modalLayers = count;
  modalListeners.forEach((l) => l());
}
const subscribeModal = (l: () => void) => {
  modalListeners.add(l);
  return () => {
    modalListeners.delete(l);
  };
};
const getModalOpen = () => modalLayers > 0;

const toneIcon: Partial<Record<Tone, { name: 'check' | 'alert' | 'info'; cls: string }>> = {
  teal: { name: 'check', cls: 'text-teal-ink' },
  danger: { name: 'alert', cls: 'text-danger-ink' },
  spark: { name: 'info', cls: 'text-spark-ink' },
};

export function ToastHost() {
  const { t } = useTranslation();
  const [items, setItems] = useState<ToastItem[]>([]);
  const overModal = useSyncExternalStore(subscribeModal, getModalOpen, getModalOpen);
  useEffect(() => {
    toastFn = (msg, tone = 'brand', opts) => {
      const id = Date.now() + Math.random();
      setItems((s) => [...s, { id, msg, tone, ...opts }]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), opts?.duration ?? (opts?.action ? 6000 : 4000));
    };
    return () => {
      toastFn = null;
    };
  }, []);
  const dismiss = (id: number) => setItems((s) => s.filter((x) => x.id !== id));
  return (
    // Обычно — над нижней панелью вкладок на мобильных (h-16 + safe area) и справа внизу на десктопе;
    // при открытом Dialog/Sheet — сверху по центру, чтобы не закрывать его кнопки
    <div
      className={clsx(
        'pointer-events-none fixed z-[60] flex flex-col items-center gap-2',
        overModal
          ? 'inset-x-4 top-[calc(0.75rem+env(safe-area-inset-top,0px))]'
          : 'inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] sm:inset-x-auto sm:right-4 sm:items-end lg:bottom-4',
      )}
      role="status"
      aria-live="polite"
    >
      {items.map((x) => {
        const ic = toneIcon[x.tone];
        return (
          <div
            key={x.id}
            className={clsx(
              'card pointer-events-auto flex w-full max-w-sm animate-fade-up items-start gap-2.5 px-4 py-3 text-sm font-medium shadow-float',
              x.tone === 'danger' && 'border-danger/40',
            )}
          >
            {ic && <Icon name={ic.name} size={18} className={clsx('mt-px', ic.cls)} />}
            <span className="flex-1">{x.msg}</span>
            {x.action && (
              <button
                type="button"
                className="shrink-0 rounded-md px-1.5 font-semibold text-brand hover:underline"
                onClick={() => {
                  x.action?.onClick();
                  dismiss(x.id);
                }}
              >
                {x.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss(x.id)}
              aria-label={t('ui.toast.dismiss')}
              className="-mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted hover:text-fg"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
