import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { LanguageSwitcher, ThemeToggle } from './AppShell';
import { buttonClass } from './ui';

/** Логотип-марка «?» + название (ведёт в каталог). */
export function Brand({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <Link to="/catalog" className="flex shrink-0 items-center gap-2 rounded-lg" aria-label={t('common.appName')}>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-spark font-display font-bold text-ink">?</span>
      <span className={clsx('font-display text-lg font-semibold tracking-tight', compact && 'hidden sm:inline')}>{t('common.appName')}</span>
    </Link>
  );
}

/**
 * Публичная оболочка для анонимных посетителей (каталог открыт без входа).
 * Со страницы курса «Войти/Регистрация» возвращают обратно через ?next.
 */
export function PublicLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const nextQs = pathname.startsWith('/catalog/') ? `?next=${encodeURIComponent(pathname)}` : '';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:gap-3 lg:px-8">
          <Brand compact />
          <nav className="ml-4 hidden md:block" aria-label={t('catalog.navFull')}>
            <NavLink
              to="/catalog"
              className={({ isActive }) => clsx('rounded-lg px-3 py-2 text-sm font-semibold transition-colors', isActive ? 'text-brand' : 'text-muted hover:text-fg')}
            >
              {t('catalog.navFull')}
            </NavLink>
          </nav>
          <div className="flex-1" />
          <LanguageSwitcher />
          <ThemeToggle className="hidden sm:grid" />
          <Link to={`/login${nextQs}`} className={buttonClass('ghost', 'sm', 'whitespace-nowrap !px-2.5 sm:!px-3')}>{t('auth.signIn')}</Link>
          <Link to={`/register${nextQs}`} className={buttonClass('primary', 'sm', 'whitespace-nowrap !px-2.5 sm:!px-3')}>{t('register.link')}</Link>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 sm:py-8 lg:px-8 lg:py-10">
        <div className="mx-auto max-w-6xl animate-fade-up">
          <Outlet />
        </div>
      </main>

      <footer className="border-t border-border px-4 py-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>© {new Date().getFullYear()} eduopen.kz</span>
          <span>{t('auth.subtitle')}</span>
        </div>
      </footer>
    </div>
  );
}
