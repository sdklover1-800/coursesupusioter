import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { useState } from 'react';
import { LANGUAGES, type Language, Role } from '@edu/shared';
import { useAuth } from '../lib/auth';
import { api, getAccessToken } from '../lib/api';
import i18n from '../i18n';
import { Button, useTheme } from './ui';

interface NavItem { to: string; label: string; icon: string }

function navFor(role: string, t: (k: string) => string): NavItem[] {
  if (role === Role.STUDENT) {
    return [{ to: '/', label: t('nav.myCourses'), icon: '◎' }, { to: '/certificates', label: t('student.certificate'), icon: '✧' }];
  }
  const manager: NavItem[] = [
    { to: '/manage/courses', label: t('nav.courses'), icon: '▤' },
    { to: '/manage/dashboards', label: t('nav.dashboards'), icon: '◇' },
  ];
  if (role === Role.ADMIN) {
    return [
      ...manager,
      { to: '/admin/users', label: t('nav.users'), icon: '◐' },
      { to: '/admin/cohorts', label: t('nav.cohorts'), icon: '❋' },
      { to: '/admin/overview', label: t('nav.overview'), icon: '⊞' },
      { to: '/admin/export', label: t('nav.export'), icon: '⇩' },
    ];
  }
  return manager;
}

export function LanguageSwitcher() {
  const cur = i18n.language as Language;
  function pick(lng: Language) {
    void i18n.changeLanguage(lng);
    // §6.2: сохраняем выбор в профиль, если пользователь авторизован (иначе — только localStorage).
    if (getAccessToken()) void api.patch('/me', { interfaceLanguage: lng }).catch(() => undefined);
  }
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5" role="group" aria-label="language">
      {LANGUAGES.map((lng) => (
        <button
          key={lng}
          onClick={() => pick(lng)}
          className={clsx('rounded-full px-2.5 py-1 text-xs font-semibold uppercase transition-colors', cur === lng ? 'bg-brand text-white' : 'text-muted hover:text-fg')}
        >
          {lng}
        </button>
      ))}
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button onClick={toggle} aria-label="theme" className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-fg hover:border-brand/50">
      {theme === 'dark' ? '☾' : '☀'}
    </button>
  );
}

export function AppShell() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const items = navFor(user.role, t);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[264px_1fr]">
      {/* Sidebar */}
      <aside className={clsx('fixed inset-y-0 left-0 z-40 w-64 border-r border-border bg-ink text-white transition-transform lg:static lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-16 items-center gap-2 px-6">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-spark font-display font-bold text-ink">?</span>
          <span className="font-display text-lg font-semibold tracking-tight">{t('common.appName')}</span>
        </div>
        <nav className="mt-4 space-y-1 px-3">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) => clsx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors', isActive ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white')}
            >
              <span className="text-lg opacity-80">{it.icon}</span>
              {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-0 w-full border-t border-white/10 p-4">
          <div className="mb-3 px-1">
            <div className="truncate text-sm font-semibold">{user.name}</div>
            <div className="truncate text-xs text-white/50">{t(`roles.${user.role}`)}</div>
          </div>
          <button onClick={() => { void logout().then(() => navigate('/login')); }} className="text-sm text-white/60 hover:text-white">
            ← {t('common.logout')}
          </button>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-ink/40 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur lg:px-8">
          <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setOpen(true)} aria-label="menu">☰</Button>
          <div className="flex-1" />
          <LanguageSwitcher />
          <ThemeToggle />
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-6xl animate-fade-up">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
