import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import { LANGUAGES, type Language, Role } from '@edu/shared';
import { useAuth } from '../lib/auth';
import { api, ApiError, getAccessToken } from '../lib/api';
import { usePendingRequestsCount } from '../lib/catalog';
import { useA11yMode, useTheme } from '../lib/theme';
import i18n from '../i18n';
import { Icon, type IconName } from './icons';
import { Menu, SegmentedControl, Sheet } from './ui';

/**
 * Оболочка приложения Inquiry 2.0 (screen_specs «Global shell…»):
 * десктоп — липкая ink-панель 248px с блоком пользователя внизу + шапка 56px
 * (язык «Қаз · Рус · Eng», режим для слабовидящих, тема); мобильные — верхняя
 * панель 52px и нижняя панель вкладок; режим фокуса (useFocusMode) скрывает всё,
 * кроме FocusBar 56px. Обёртка страницы — только opacity-анимация: transform сделал бы
 * её containing block для fixed-оверлеев.
 */

/** Горизонтальные поля контента — задаются один раз в оболочке (FE2 строит full-bleed сцену от них). */
export const GUTTER = 'px-4 sm:px-6 lg:px-8';

/* ── Режим фокуса ─────────────────────────────────────────────────────── */
export interface FocusModeOptions {
  /** Заголовок в FocusBar (обрезается многоточием) */
  title: string;
  /** ✕ — выход (страница может сначала спросить подтверждение) */
  onExit: () => void;
  /** Правый слот: счётчик, InquiryMeter compact и т.п. (внутри действует тёмная палитра) */
  right?: ReactNode;
  /** Подпись кнопки выхода для скринридера (по умолчанию «Выйти») */
  exitLabel?: string;
  /** false — режим выключен (удобно для условного включения без условного вызова хука) */
  enabled?: boolean;
}

// Внешнее хранилище: страница пишет конфиг на каждом рендере — перерисовывается только FocusBar
const focus = {
  owner: null as symbol | null,
  config: null as FocusModeOptions | null,
  version: 0,
  listeners: new Set<() => void>(),
};
function emitFocus() {
  focus.version += 1;
  focus.listeners.forEach((l) => l());
}
function subscribeFocus(l: () => void) {
  focus.listeners.add(l);
  return () => focus.listeners.delete(l);
}
const getFocusActive = () => focus.owner !== null;
const getFocusVersion = () => focus.version;

/**
 * Режим фокуса для раннеров тестов и чата практикума: скрывает боковую панель, шапку
 * и нижние вкладки; показывает FocusBar (✕, заголовок, правый слот). Снимается при размонтировании.
 */
export function useFocusMode(options: FocusModeOptions): void {
  const token = useRef<symbol>(Symbol('focus-mode'));
  const enabled = options.enabled ?? true;
  useLayoutEffect(() => {
    if (!enabled) return;
    const me = token.current;
    focus.owner = me;
    emitFocus();
    return () => {
      if (focus.owner === me) {
        focus.owner = null;
        focus.config = null;
        emitFocus();
      }
    };
  }, [enabled]);
  // Актуальный конфиг (новый right-слот) — после каждого рендера страницы
  useLayoutEffect(() => {
    if (!enabled || focus.owner !== token.current) return;
    focus.config = options;
    emitFocus();
  });
}

function FocusBar() {
  const { t } = useTranslation();
  useSyncExternalStore(subscribeFocus, getFocusVersion, getFocusVersion);
  const cfg = focus.config;
  return (
    <header className="sticky top-0 z-30 bg-ink pt-[env(safe-area-inset-top,0px)] text-white">
      <div data-theme="dark" className={clsx('flex h-14 items-center gap-2 text-fg', GUTTER, '!pl-2 sm:!pl-3')}>
        <button
          type="button"
          onClick={() => cfg?.onExit()}
          aria-label={cfg?.exitLabel ?? t('shell.exitFocus')}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Icon name="x" size={20} />
        </button>
        <div className="min-w-0 flex-1 truncate text-body font-semibold sm:text-base">{cfg?.title}</div>
        {cfg?.right && <div className="flex shrink-0 items-center gap-2">{cfg.right}</div>}
      </div>
    </header>
  );
}

/* ── Язык, тема, режим для слабовидящих ───────────────────────────────── */
const LANG_ORDER = LANGUAGES; // kk → ru → en: казахский первым

function pickLanguage(lng: Language) {
  void i18n.changeLanguage(lng);
  // §6.2: сохраняем выбор в профиль, если пользователь авторизован (иначе — только localStorage).
  if (getAccessToken()) void api.patch('/me', { interfaceLanguage: lng }).catch(() => undefined);
}

/**
 * Переключатель языка интерфейса: родное письмо «Қаз · Рус · Eng», без флагов.
 * segmented — сегменты (активный — ink); menu — компактное меню (мобильная шапка);
 * responsive — меню до sm, сегменты от sm.
 */
export function LanguageSwitcher({ variant = 'segmented', className }: { variant?: 'segmented' | 'menu' | 'responsive'; className?: string }) {
  const { t, i18n: inst } = useTranslation();
  const cur = (LANG_ORDER as readonly string[]).includes(inst.language) ? (inst.language as Language) : 'ru';
  const segmented = (
    <SegmentedControl<Language>
      ariaLabel={t('shell.language')}
      size="sm"
      value={cur}
      onChange={pickLanguage}
      className={variant === 'responsive' ? clsx('hidden sm:inline-flex', className) : className}
      options={LANG_ORDER.map((lng) => ({ value: lng, label: t(`shell.langShort.${lng}`), ariaLabel: t(`languages.${lng}`), lang: lng }))}
    />
  );
  const menu = (
    <Menu
      className={variant === 'responsive' ? clsx('sm:hidden', className) : className}
      triggerLabel={t('shell.language')}
      trigger={
        <span className="inline-flex items-center gap-1 px-2 text-sm font-semibold">
          <Icon name="globe" size={18} className="text-fg-2" />
          <span lang={cur}>{t(`shell.langShort.${cur}`)}</span>
        </span>
      }
      items={LANG_ORDER.map((lng) => ({
        key: lng,
        label: t(`languages.${lng}`),
        lang: lng,
        checked: lng === cur,
        onSelect: () => pickLanguage(lng),
      }))}
    />
  );
  if (variant === 'menu') return menu;
  if (variant === 'responsive') return <>{menu}{segmented}</>;
  return segmented;
}

const roundBtn =
  'grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-card text-fg transition-colors hover:border-brand/50';

export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <button type="button" onClick={toggle} aria-label={t('shell.darkTheme')} aria-pressed={dark} title={t('shell.darkTheme')} className={clsx(roundBtn, className)}>
      <Icon name={dark ? 'moon' : 'sun'} size={18} />
    </button>
  );
}

/** «Глаз» — версия для слабовидящих (конвенция egov/Enbek), рядом с языком. */
export function A11yToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { enabled, toggle } = useA11yMode();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t('shell.a11y')}
      aria-pressed={enabled}
      title={t('shell.a11y')}
      className={clsx(roundBtn, enabled && '!border-brand bg-brand-soft text-brand', className)}
    >
      <Icon name="eye" size={18} />
    </button>
  );
}

/** Марка «?» + EduOpen. */
export function LogoMark({ size = 32, withName = true, nameClassName }: { size?: number; withName?: boolean; nameClassName?: string }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="grid shrink-0 place-items-center rounded-lg bg-spark font-display font-bold text-ink"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
        aria-hidden
      >
        ?
      </span>
      {withName && <span className={clsx('font-display text-lg font-semibold tracking-tight', nameClassName)}>{t('common.appName')}</span>}
    </span>
  );
}

/* ── Навигация ────────────────────────────────────────────────────────── */
interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  badge?: number;
  /** Префиксы путей, при которых пункт активен (кроме точного to) */
  match?: string[];
}

/**
 * Счётчик открытых жалоб на контент для бейджа (все курсы менеджера, A29).
 * До появления маршрута (BE2) — 404 → 0, без шума в консоли и повторов.
 */
function useOpenIssuesCount(enabled: boolean): number {
  const q = useQuery({
    queryKey: ['content-issues', 'summary'],
    queryFn: async () => {
      try {
        return await api.get<{ open: number; openSystem?: number }>('/content-issues/summary');
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) return { open: 0 };
        throw e;
      }
    },
    enabled,
    retry: false,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  return q.data?.open ?? 0;
}

function useNav(role: string, pendingRequests: number, openIssues: number) {
  const { t } = useTranslation();
  if (role === Role.STUDENT) {
    const items: NavItem[] = [
      { to: '/', label: t('nav.myCourses'), icon: 'home', match: ['/learn/'] },
      { to: '/catalog', label: t('catalog.nav'), icon: 'compass' },
      { to: '/certificates', label: t('shell.certificates'), icon: 'award' },
    ];
    const tabs: NavItem[] = [
      { ...items[0]!, label: t('shell.home') },
      items[1]!,
      // Короткая подпись: «Сертификаттар» не помещается во вкладку 390px при 13px
      { ...items[2]!, label: t('shell.tabCertificates') },
      { to: '/profile', label: t('shell.profile'), icon: 'user' },
    ];
    return { items, tabs, more: [] as NavItem[] };
  }
  const courses: NavItem = { to: '/manage/courses', label: t('nav.courses'), icon: 'layers', match: ['/manage/quiz/', '/manage/practical/'] };
  // Заявки на курсы: бейдж — число ожидающих (обновляется раз в 60 с)
  const requests: NavItem = { to: '/manage/requests', label: t('requests.nav'), icon: 'mail', badge: pendingRequests };
  const dashboards: NavItem = { to: '/manage/dashboards', label: t('nav.dashboards'), icon: 'bar-chart' };
  const issues: NavItem = { to: '/manage/issues', label: t('shell.issues'), icon: 'flag', badge: openIssues };
  const admin: NavItem[] =
    role === Role.ADMIN
      ? [
          { to: '/admin/users', label: t('nav.users'), icon: 'users' },
          { to: '/admin/cohorts', label: t('nav.cohorts'), icon: 'grid' },
          { to: '/admin/overview', label: t('nav.overview'), icon: 'compass' },
          { to: '/admin/export', label: t('nav.export'), icon: 'download' },
          { to: '/admin/audit', label: t('nav.audit'), icon: 'history' },
        ]
      : [];
  const items = [courses, requests, dashboards, issues, ...admin];
  const profile: NavItem = { to: '/profile', label: t('shell.profile'), icon: 'user' };
  return { items, tabs: [courses, requests, dashboards], more: [issues, ...admin, profile] };
}

function isActive(pathname: string, item: NavItem): boolean {
  if (item.to === '/') return pathname === '/' || !!item.match?.some((p) => pathname.startsWith(p));
  return pathname === item.to || pathname.startsWith(item.to + '/') || !!item.match?.some((p) => pathname.startsWith(p));
}

function CountBadge({ n, className }: { n: number; className?: string }) {
  if (!n) return null;
  return (
    <span className={clsx('min-w-[1.5rem] rounded-full bg-spark px-1.5 text-center font-mono text-xs font-bold leading-6 tabular-nums text-ink', className)}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/* ── Оболочка ─────────────────────────────────────────────────────────── */
export function AppShell() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();
  const a11y = useA11yMode();
  const focusActive = useSyncExternalStore(subscribeFocus, getFocusActive, getFocusActive);
  const isStaff = user?.role === Role.COURSE_MANAGER || user?.role === Role.ADMIN;
  const pendingRequests = usePendingRequestsCount(!!isStaff);
  const openIssues = useOpenIssuesCount(!!isStaff);
  const nav = useNav(user?.role ?? Role.STUDENT, pendingRequests, openIssues);
  if (!user) return null;

  const doLogout = () => {
    void logout().then(() => navigate('/login'));
  };
  const skipToMain = (e: MouseEvent) => {
    e.preventDefault();
    const main = document.getElementById('main');
    main?.focus();
    main?.scrollIntoView({ block: 'start' });
  };
  const moreBadge = nav.more.reduce((s, i) => s + (i.badge ?? 0), 0);

  return (
    <div className={clsx('min-h-screen', !focusActive && 'lg:grid lg:grid-cols-[248px_minmax(0,1fr)]')}>
      {/* Первый фокусируемый элемент — пропуск навигации */}
      <a
        href="#main"
        onClick={skipToMain}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-card focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-fg focus:shadow-float"
      >
        {t('shell.skipToContent')}
      </a>

      {/* Десктоп: липкая ink-панель */}
      {!focusActive && (
        <aside className="hidden bg-ink text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
          <div className="flex h-14 shrink-0 items-center px-5">
            <Link to="/" className="rounded-lg" aria-label={t('common.appName')}>
              <LogoMark size={30} />
            </Link>
          </div>
          <nav aria-label={t('shell.mainNav')} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <ul className="space-y-0.5">
              {nav.items.map((it) => {
                const active = isActive(pathname, it);
                return (
                  <li key={it.to}>
                    <Link
                      to={it.to}
                      aria-current={active ? 'page' : undefined}
                      className={clsx(
                        'flex min-h-[2.75rem] items-center gap-3 rounded-xl px-3 text-body font-medium transition-colors',
                        active ? 'bg-white/10 text-white' : 'text-white/80 hover:bg-white/5 hover:text-white',
                      )}
                    >
                      <Icon name={it.icon} size={20} className={active ? 'text-white' : 'text-white/75'} />
                      <span className="flex-1">{it.label}</span>
                      <CountBadge n={it.badge ?? 0} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          {/* Блок пользователя: всегда виден внизу панели */}
          <div className="mt-auto shrink-0 border-t border-white/10 p-3">
            <div className="flex items-center gap-3 px-2 py-1.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-semibold text-white" aria-hidden>
                {initials(user.name)}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{user.name}</div>
                <div className="truncate text-sm text-white/80">{t(`roles.${user.role}`)}</div>
              </div>
            </div>
            <div className="mt-1 flex items-center gap-1">
              <NavLink
                to="/profile"
                className={({ isActive: a }) =>
                  clsx('inline-flex h-9 flex-1 items-center gap-2 rounded-lg px-2 text-sm transition-colors hover:bg-white/5 hover:text-white', a ? 'text-white' : 'text-white/80')
                }
              >
                <Icon name="user" size={16} />
                {t('shell.profile')}
              </NavLink>
              <button type="button" onClick={doLogout} className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-sm text-white/80 transition-colors hover:bg-white/5 hover:text-white">
                <Icon name="logout" size={16} />
                {t('shell.logout')}
              </button>
            </div>
          </div>
        </aside>
      )}

      <div className="flex min-h-screen min-w-0 flex-col">
        {focusActive ? (
          <FocusBar />
        ) : (
          <>
            {/* Десктоп-шапка */}
            <header className="sticky top-0 z-30 hidden h-14 items-center justify-end gap-2 border-b border-border bg-surface/85 px-8 backdrop-blur lg:flex">
              <LanguageSwitcher />
              <A11yToggle />
              <ThemeToggle />
            </header>
            {/* Мобильная верхняя панель 52px */}
            <header className="sticky top-0 z-30 border-b border-border bg-surface/90 pt-[env(safe-area-inset-top,0px)] backdrop-blur lg:hidden">
              <div className="flex h-[52px] items-center gap-1 pl-4 pr-2">
                <Link to="/" className="mr-auto inline-flex min-h-11 items-center rounded-lg" aria-label={t('common.appName')}>
                  <LogoMark size={28} nameClassName="text-base" />
                </Link>
                <LanguageSwitcher variant="menu" />
                <Menu
                  triggerLabel={t('shell.moreMenu')}
                  trigger={<Icon name="more" size={22} />}
                  items={[
                    { key: 'theme', icon: theme === 'dark' ? 'moon' : 'sun', label: t('shell.darkTheme'), checked: theme === 'dark', onSelect: toggleTheme },
                    { key: 'a11y', icon: 'eye', label: t('shell.a11y'), checked: a11y.enabled, onSelect: a11y.toggle },
                    { key: 'logout', icon: 'logout', label: t('shell.logout'), onSelect: doLogout, danger: true },
                  ]}
                />
              </div>
            </header>
          </>
        )}

        <main
          id="main"
          tabIndex={-1}
          className={clsx(
            GUTTER,
            'flex-1 py-6 focus:outline-none lg:py-8',
            !focusActive && 'pb-[calc(4rem+env(safe-area-inset-bottom,0px)+1.5rem)] lg:pb-8',
          )}
        >
          <div className="mx-auto w-full max-w-[1200px] animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Мобильная нижняя панель вкладок */}
      {!focusActive && (
        <nav aria-label={t('shell.tabBar')} className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur lg:hidden">
          <ul className="grid h-16 grid-cols-4">
            {nav.tabs.map((it) => {
              const active = isActive(pathname, it);
              return (
                <li key={it.to} className="min-w-0">
                  <Link to={it.to} aria-current={active ? 'page' : undefined} className="flex h-full flex-col items-center justify-center gap-0.5 px-1">
                    <TabIcon icon={it.icon} active={active} badge={it.badge} />
                    <span className={clsx('max-w-full truncate text-xs font-medium leading-4', active ? 'text-fg' : 'text-fg-2')}>{it.label}</span>
                  </Link>
                </li>
              );
            })}
            {nav.more.length > 0 && (
              <li className="min-w-0">
                <button
                  type="button"
                  onClick={() => setMoreOpen(true)}
                  aria-haspopup="dialog"
                  aria-expanded={moreOpen}
                  className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1"
                >
                  <TabIcon icon="more" active={moreOpen || nav.more.some((i) => isActive(pathname, i))} dot={moreBadge > 0} />
                  <span className="max-w-full truncate text-xs font-medium leading-4 text-fg-2">{t('shell.more')}</span>
                </button>
              </li>
            )}
          </ul>
        </nav>
      )}

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title={t('shell.more')} side="bottom">
        <ul className="-mx-2 space-y-0.5">
          {nav.more.map((it) => {
            const active = isActive(pathname, it);
            return (
              <li key={it.to}>
                <Link
                  to={it.to}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={clsx('flex min-h-[3rem] items-center gap-3 rounded-xl px-3 text-body font-medium transition-colors hover:bg-brand-soft', active ? 'bg-brand-soft text-brand' : 'text-fg')}
                >
                  <Icon name={it.icon} size={20} className={active ? 'text-brand' : 'text-fg-2'} />
                  <span className="flex-1">{it.label}</span>
                  <CountBadge n={it.badge ?? 0} />
                </Link>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </div>
  );
}

function TabIcon({ icon, active, badge, dot }: { icon: IconName; active: boolean; badge?: number; dot?: boolean }) {
  return (
    <span className={clsx('relative grid h-7 w-12 place-items-center rounded-full transition-colors', active ? 'bg-brand-soft text-brand' : 'text-fg-2')}>
      <Icon name={icon} size={20} />
      {!!badge && (
        <span className="absolute -right-1 -top-1.5 min-w-[1.25rem] rounded-full bg-spark px-1 text-center font-mono text-xs font-bold leading-5 tabular-nums text-ink">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {!badge && dot && <span className="absolute right-2 top-0.5 h-2 w-2 rounded-full bg-spark ring-2 ring-card" aria-hidden />}
    </span>
  );
}
