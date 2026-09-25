import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './AppShell';

/**
 * Раскладка экранов входа/регистрации: слева — тезис (hero), справа — форма.
 * variant="register" показывает в hero путь студента: регистрация → заявка → одобрение.
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
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-spark font-display font-bold text-ink">?</span>
          <span className="font-display text-xl font-semibold">{t('common.appName')}</span>
        </Link>
        <div className="relative max-w-md">
          {variant === 'login' ? (
            <>
              {/* Сигнатурный мотив: вопрос ведёт к вопросу */}
              <div className="mb-6 font-mono text-sm text-spark">01 → 02 → 03 → ?</div>
              <h1 className="font-display text-4xl font-semibold leading-tight">{t('auth.tagline')}</h1>
              <p className="mt-5 text-lg text-white/60">{t('auth.subtitle')}</p>
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
                      <div className="mt-0.5 text-sm text-white/55">{s.hint}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
        <div className="relative text-xs text-white/40">© {new Date().getFullYear()} eduopen.kz</div>
      </div>

      {/* Правая панель — форма */}
      <div className="flex min-h-screen flex-col bg-surface px-5 sm:px-6">
        <div className="flex items-center justify-between gap-3 py-4">
          <Link to="/catalog" className="rounded-lg text-sm font-semibold text-muted transition-colors hover:text-fg">
            ← {t('catalog.navFull')}
          </Link>
          <LanguageSwitcher />
        </div>
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-sm">
            <Link to="/catalog" className="mb-8 inline-flex lg:hidden" aria-label={t('common.appName')}>
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-spark font-display font-bold text-ink">?</span>
            </Link>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
