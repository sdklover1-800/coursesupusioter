import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import type { MouseEvent } from 'react';
import { GUTTER, LanguageSwitcher, LogoMark, ThemeToggle } from './AppShell';
import { buttonClass } from './ui';
import { Icon } from './icons';

/** Логотип-марка «?» + название (ведёт в каталог). */
export function Brand({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <Link to="/catalog" className="flex shrink-0 items-center gap-2 rounded-lg" aria-label={t('common.appName')}>
      <LogoMark size={32} nameClassName={clsx(compact && 'hidden sm:inline')} />
    </Link>
  );
}

/**
 * Публичная оболочка для анонимных посетителей (каталог открыт без входа,
 * публичная проверка сертификата /verify). Со страницы курса «Войти/Регистрация»
 * возвращают обратно через ?next.
 */
export function PublicLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const nextQs = pathname.startsWith('/catalog/') ? `?next=${encodeURIComponent(pathname)}` : '';
  const skipToMain = (e: MouseEvent) => {
    e.preventDefault();
    document.getElementById('main')?.focus();
  };

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        onClick={skipToMain}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-card focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-fg focus:shadow-float"
      >
        {t('shell.skipToContent')}
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-surface/85 pt-[env(safe-area-inset-top,0px)] backdrop-blur">
        <div className={clsx('mx-auto flex h-16 max-w-[1200px] items-center gap-1.5 sm:gap-3', GUTTER)}>
          <Brand compact />
          <nav className="ml-4 hidden md:block" aria-label={t('shell.mainNav')}>
            <NavLink
              to="/catalog"
              className={({ isActive }) => clsx('rounded-lg px-3 py-2 text-sm font-semibold transition-colors', isActive ? 'text-brand' : 'text-fg-2 hover:text-fg')}
            >
              {t('catalog.navFull')}
            </NavLink>
          </nav>
          <div className="flex-1" />
          <LanguageSwitcher variant="responsive" />
          <ThemeToggle className="hidden sm:grid" />
          <Link to={`/login${nextQs}`} className={buttonClass('ghost', 'sm', 'whitespace-nowrap !px-2.5 sm:!px-3')}>{t('auth.signIn')}</Link>
          <Link to={`/register${nextQs}`} className={buttonClass('primary', 'sm', 'whitespace-nowrap !px-2.5 sm:!px-3')}>{t('register.link')}</Link>
        </div>
      </header>

      <main id="main" tabIndex={-1} className={clsx('flex-1 py-6 focus:outline-none sm:py-8 lg:py-10', GUTTER)}>
        <div className="mx-auto max-w-[1200px] animate-fade-in">
          <Outlet />
        </div>
      </main>

      <footer className={clsx('border-t border-border py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]', GUTTER)}>
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-6 gap-y-2 text-small text-fg-2">
          <span>© {new Date().getFullYear()} eduopen.kz</span>
          <span className="hidden sm:inline">{t('auth.subtitle')}</span>
          <Link to="/verify" className="inline-flex items-center gap-1.5 rounded-md font-semibold text-brand hover:underline">
            <Icon name="award" size={16} />
            {t('shell.verifyCertificate')}
          </Link>
        </div>
      </footer>
    </div>
  );
}
