import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher, LogoMark, ThemeToggle } from './AppShell';
import { Icon } from './icons';

/**
 * Раскладка экранов входа/регистрации: слева — тезис (hero), справа — форма.
 * variant="register" показывает в hero путь студента: регистрация → заявка → одобрение.
 * Тема применяется до рендера (lib/theme.ts), поэтому экраны входа открываются в сохранённой теме.
 */
export function AuthLayout({ children, variant = 'login' }: { children: ReactNode; variant?: 'login' | 'register' }) {
  const { t } = useTranslation();
  const steps = [
    { n: '01', title: t('catalog.step1'), hint: t('catalog.step1Hint') },
    { n: '02', title: t('catalog.step2'), hint: t('catalog.step2Hint') },
    { n: '03', title: t('catalog.step3'), hint: t('catalog.step3Hint') },
  ];

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Левая панель — тезис (hero) */}
      <div className="relative hidden overflow-hidden bg-ink text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="bg-inquiry-grid absolute inset-0 opacity-40" />
        <Link to="/catalog" className="relative flex w-fit items-center gap-2 rounded-lg">
          <LogoMark size={36} nameClassName="text-xl" />
        </Link>
        <div className="relative max-w-md">
          {variant === 'login' ? (
            <>
              {/* Сигнатурный мотив: вопрос ведёт к вопросу */}
              <div className="mb-6 font-mono text-sm text-spark">01 → 02 → 03 → ?</div>
              <h1 className="font-display text-4xl font-semibold leading-tight">{t('auth.tagline')}</h1>
              <p className="mt-5 text-lg text-white/80">{t('auth.subtitle')}</p>
            </>
          ) : (
            <>
              <h1 className="font-display text-4xl font-semibold leading-tight">{t('auth.tagline')}</h1>
              <ol className="mt-10 space-y-6">
                {steps.map((s) => (
                  <li key={s.n} className="flex gap-4">
                    <span className="font-mono text-sm font-semibold text-spark">{s.n}</span>
                    <div>
                      <div className="font-semibold">{s.title}</div>
                      <div className="mt-0.5 text-body text-white/80">{s.hint}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
        <div className="relative text-sm text-white/70">© {new Date().getFullYear()} eduopen.kz</div>
      </div>

      {/* Правая панель — форма */}
      <div className="flex min-h-screen flex-col bg-surface px-5 pt-[env(safe-area-inset-top,0px)] sm:px-6">
        <div className="flex items-center justify-between gap-2 py-4">
          <Link to="/catalog" className="inline-flex min-w-0 items-center gap-1 rounded-lg text-sm font-semibold text-fg-2 transition-colors hover:text-fg">
            <Icon name="chevron-left" size={16} />
            <span className="truncate">{t('catalog.navFull')}</span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
        <main id="main" className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-sm">
            <Link to="/catalog" className="mb-8 inline-flex lg:hidden" aria-label={t('common.appName')}>
              <LogoMark size={36} />
            </Link>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
