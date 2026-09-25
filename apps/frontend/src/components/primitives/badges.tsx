import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toneClasses, type Tone } from '../../lib/tones';
import { Icon } from '../icons';

/* ── Badge ──────────────────────────────────────────────── */
export type BadgeTone = Tone;

/**
 * Плашка статуса. Тонированные тона — текст *-ink (bg-teal/12 text-teal-ink, A24),
 * ink — сплошной (оценивание, полномочия). Цвет не единственный носитель смысла:
 * рядом всегда текст (и глиф — у статусов).
 */
export function Badge({ tone = 'muted', children, className, title }: { tone?: BadgeTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-small font-semibold', toneClasses[tone].badge, className)}
    >
      {children}
    </span>
  );
}

/* ── ModeBadge — язык режимов (design_direction §8) ─────── */
export type LearningMode = 'practice' | 'graded';

/** ◆ — знак оценивания (залитый ромб). */
function GradedDiamond({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden className="shrink-0">
      <path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" fill="currentColor" />
    </svg>
  );
}

/**
 * «Тренировка / Жаттығу / Practice» — пунктир brand на brand-soft/60 с ↻;
 * «Оценивание / Бағалау / Graded» — сплошной ink с ◆.
 * long — у тренировки добавляется «· не влияет на результат».
 */
export function ModeBadge({ mode, long, className }: { mode: LearningMode; long?: boolean; className?: string }) {
  const { t } = useTranslation();
  if (mode === 'practice') {
    return (
      <span
        title={t('ui.mode.practiceHint')}
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-full border border-dashed border-brand/40 bg-brand-soft/60 px-2.5 py-0.5 text-small font-semibold text-brand',
          className,
        )}
      >
        <Icon name="refresh" size={12} strokeWidth={2} />
        <span>
          {t('ui.mode.practice')}
          {long && <span className="font-medium"> · {t('ui.mode.practiceLong')}</span>}
        </span>
      </span>
    );
  }
  return (
    <span
      title={t('ui.mode.gradedHint')}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-0.5 text-small font-semibold text-white dark:ring-1 dark:ring-inset dark:ring-border-strong',
        className,
      )}
    >
      <GradedDiamond />
      <span>{t('ui.mode.graded')}</span>
    </span>
  );
}

/* ── QuestionGlyph — «?» в амбер-кольце (аватар тьютора, SIGNATURE) ── */
export function QuestionGlyph({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span
      className={clsx('inline-flex shrink-0 items-center justify-center rounded-full font-display font-semibold text-ink', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.5),
        background: 'rgb(var(--spark))',
        boxShadow: `0 0 0 ${size >= 32 ? 4 : 2}px rgb(var(--spark) / 0.18)`,
      }}
      aria-hidden
    >
      ?
    </span>
  );
}

/* ── Kbd ────────────────────────────────────────────────── */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={clsx(
        'inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md border border-b-2 border-border-strong bg-surface-2 px-1.5 font-mono text-xs font-medium leading-none text-fg',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
