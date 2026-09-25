import type { Config } from 'tailwindcss';

/**
 * Дизайн-система «Inquiry 2.0» (см. src/styles/index.css — источник токенов,
 * design_direction §2–§6). Цвета через CSS-переменные (RGB-триплеты) → светлая/тёмная тема.
 * Роли цветов: ink — оценивание/хром, brand — действие/выбор, spark — тьютор и «вы здесь»,
 * teal — успех (только после проверки), danger — ошибка. Текст на тонированных
 * подложках — токены *-ink (контраст ≥ 4.5:1, A24).
 */
const fontFallback = ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'];

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Тёмная тема — атрибут data-theme на <html> (lib/theme.ts), а не prefers-color-scheme
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ink: 'rgb(var(--ink) / <alpha-value>)',
        stage: 'rgb(var(--stage) / <alpha-value>)', // полоса видео — тёмная в обеих темах
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        'border-strong': 'rgb(var(--border-strong) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        // Вторичный текст (§12, USER_DECISIONS §8): мета карточек, даты, пояснения статусов (≥ 7:1).
        // muted — только для по-настоящему необязательных подсказок.
        'fg-2': 'rgb(var(--fg-2) / <alpha-value>)',
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)', // текст и ссылки
          fill: 'rgb(var(--brand-fill) / <alpha-value>)', // заливка кнопок (белый текст ≥ 4.5:1)
          soft: 'rgb(var(--brand-soft) / <alpha-value>)',
        },
        spark: 'rgb(var(--spark) / <alpha-value>)', // амбер — «сократическая искра» (заливки)
        'spark-ink': 'rgb(var(--spark-ink) / <alpha-value>)', // амбер для текста/колец
        teal: 'rgb(var(--teal) / <alpha-value>)',
        'teal-ink': 'rgb(var(--teal-ink) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        'danger-ink': 'rgb(var(--danger-ink) / <alpha-value>)',
      },
      // Шаги прозрачности 8/12/15: без них bg-teal/12, bg-danger/8 молча не генерировались
      opacity: { 8: '0.08', 12: '0.12', 15: '0.15' },
      fontFamily: {
        display: ['Geologica', ...fontFallback],
        sans: ['Onest', ...fontFallback],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      // Шкала design_direction §3 + поправка §12 «читаемость» (в rem — режим для слабовидящих масштабирует корень).
      // Минимум — 13px: ничего мельче в интерфейсе нет. display-xl/lg — адаптивные (переменные в index.css)
      fontSize: {
        // Штатный xs Tailwind (12px) ниже порога читаемости → 13/20. Старые text-xs автоматически читаемы.
        xs: ['0.8125rem', { lineHeight: '1.25rem' }], // 13/20
        'display-2xl': ['2.75rem', { lineHeight: '3rem', fontWeight: '700', letterSpacing: '-0.02em' }], // 44/48
        'display-xl': ['var(--fs-display-xl)', { lineHeight: 'var(--lh-display-xl)', fontWeight: '600', letterSpacing: '-0.01em' }], // 34/40 (28/34 < md)
        'display-lg': ['var(--fs-display-lg)', { lineHeight: 'var(--lh-display-lg)', fontWeight: '600', letterSpacing: '-0.01em' }], // 26/32 (22/28 < md)
        'display-md': ['1.25rem', { lineHeight: '1.625rem', fontWeight: '600' }], // 20/26
        title: ['1.1875rem', { lineHeight: '1.75rem', fontWeight: '600' }], // 19/28
        'body-lg': ['1.0625rem', { lineHeight: '1.75rem' }], // 17/28
        transcript: ['1.125rem', { lineHeight: '1.875rem' }], // 18/30
        meta: ['0.9375rem', { lineHeight: '1.375rem' }], // 15/22 — мета-строка карточки (цвет fg-2)
        body: ['0.9375rem', { lineHeight: '1.5rem' }], // 15/24
        label: ['0.875rem', { lineHeight: '1.25rem', fontWeight: '500' }], // 14/20 — надстрочник из СЛОВ: Onest, sentence case, fg-2
        num: ['0.875rem', { lineHeight: '1.25rem', fontWeight: '500' }], // 14/20 — ТОЛЬКО числа: font-mono + tabular-nums (класс .num)
        small: ['0.8125rem', { lineHeight: '1.25rem' }], // 13/20 — подписи; минимум интерфейса
        // УПРАЗДНЁН (§12): 12px моно-капс не читается. Оставлен как псевдоним 13/20, чтобы старые
        // text-micro не пропали молча. Для слов — text-label, для чисел — .num.
        micro: ['0.8125rem', { lineHeight: '1.25rem' }],
      },
      spacing: {
        13: '3.25rem', // h-13 — кнопка lg (52px)
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.25rem',
      },
      boxShadow: {
        soft: '0 1px 2px rgb(16 18 43 / 0.04), 0 8px 24px -12px rgb(16 18 43 / 0.12)',
        glow: '0 0 0 1px rgb(var(--brand) / 0.2), 0 12px 40px -12px rgb(var(--brand) / 0.35)',
        // e2: Dialog, Sheet, поповеры, мини-плеер
        float: '0 2px 6px rgb(8 9 20 / 0.08), 0 24px 48px -16px rgb(8 9 20 / 0.32)',
      },
      transitionTimingFunction: {
        inquiry: 'cubic-bezier(.22,1,.36,1)',
      },
      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        // Только прозрачность: transform на обёртке делал её containing block для fixed-модалок
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'pip-in': { '0%': { transform: 'scale(0.6)', opacity: '0' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        // Заполнение кольца прогресса: от пустого (--ring-circ) до собственного dashoffset
        'ring-fill': { '0%': { strokeDashoffset: 'var(--ring-circ)' } },
        // «Искра» — 12 частиц разлетаются (только сданный модуль, design_direction §6)
        'spark-burst': {
          '0%': { transform: 'translate(0, 0) scale(1)', opacity: '1' },
          '100%': { transform: 'translate(var(--dx), var(--dy)) scale(0.3)', opacity: '0' },
        },
        'sheet-up': { '0%': { transform: 'translateY(100%)' }, '100%': { transform: 'translateY(0)' } },
        'sheet-left': { '0%': { transform: 'translateX(100%)' }, '100%': { transform: 'translateX(0)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-up': 'fade-up 0.32s cubic-bezier(0.22,1,0.36,1) both',
        // fill-mode backwards: после окончания анимация не оставляет эффекта (и stacking context)
        'fade-in': 'fade-in 0.2s cubic-bezier(0.22,1,0.36,1) backwards',
        'pip-in': 'pip-in 0.3s cubic-bezier(0.22,1,0.36,1) both',
        'ring-fill': 'ring-fill 0.6s cubic-bezier(0.22,1,0.36,1) backwards',
        'spark-burst': 'spark-burst 0.7s cubic-bezier(0.22,1,0.36,1) forwards',
        'sheet-up': 'sheet-up 0.32s cubic-bezier(0.22,1,0.36,1) backwards',
        'sheet-left': 'sheet-left 0.32s cubic-bezier(0.22,1,0.36,1) backwards',
      },
    },
  },
  plugins: [],
} satisfies Config;
