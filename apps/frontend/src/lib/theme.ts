import { useSyncExternalStore } from 'react';

/**
 * Тема и режим для слабовидящих (design_direction §9).
 * initTheme() вызывается в main.tsx СИНХРОННО до createRoot: inline-скрипт в index.html
 * запрещён CSP, поэтому тему применяем из бандла — так страницы входа/согласия/смены
 * пароля тоже открываются в сохранённой теме, без вспышки.
 *
 * localStorage['edu.theme'] = 'light' | 'dark' | 'system' (по умолчанию system → matchMedia);
 * localStorage['edu.a11y'] = '1' | '0'.
 */
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const THEME_KEY = 'edu.theme';
const A11Y_KEY = 'edu.a11y';

function readStorage(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* приватный режим — просто не сохраняем */
  }
}

function darkQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;
}

function readPreference(): ThemePreference {
  const v = readStorage(THEME_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === 'system') return darkQuery()?.matches ? 'dark' : 'light';
  return pref;
}

/* ── Внешнее хранилище (useSyncExternalStore) ── */
interface State {
  preference: ThemePreference;
  theme: ResolvedTheme;
  a11y: boolean;
}
let state: State = { preference: 'system', theme: 'light', a11y: false };
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function apply() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = state.theme;
  root.classList.toggle('a11y', state.a11y);
}

let initialized = false;

/** Применить сохранённые тему и режим до первого рендера. Идемпотентно. */
export function initTheme(): void {
  const preference = readPreference();
  state = { preference, theme: resolveTheme(preference), a11y: readStorage(A11Y_KEY) === '1' };
  apply();
  if (initialized) return;
  initialized = true;
  // «Системная» тема следует за ОС на лету
  const mq = darkQuery();
  const onChange = () => {
    if (state.preference !== 'system') return;
    state = { ...state, theme: resolveTheme('system') };
    apply();
    emit();
  };
  mq?.addEventListener?.('change', onChange);
  // Синхронизация между вкладками
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key !== THEME_KEY && e.key !== A11Y_KEY) return;
      initTheme();
      emit();
    });
  }
}

export function setThemePreference(preference: ThemePreference): void {
  writeStorage(THEME_KEY, preference);
  state = { ...state, preference, theme: resolveTheme(preference) };
  apply();
  emit();
}

export function setA11yMode(enabled: boolean): void {
  writeStorage(A11Y_KEY, enabled ? '1' : '0');
  state = { ...state, a11y: enabled };
  apply();
  emit();
}

const getState = () => state;

/**
 * Тема: theme — фактическая (light/dark), preference — выбор пользователя.
 * toggle() переключает фактическую тему и сохраняет явный выбор.
 */
export function useTheme() {
  const s = useSyncExternalStore(subscribe, getState, getState);
  return {
    theme: s.theme,
    preference: s.preference,
    setPreference: setThemePreference,
    toggle: () => setThemePreference(s.theme === 'dark' ? 'light' : 'dark'),
  };
}

/** Режим для слабовидящих («глаз» рядом с переключателем языка, как на egov/Enbek). */
export function useA11yMode() {
  const s = useSyncExternalStore(subscribe, getState, getState);
  return {
    enabled: s.a11y,
    setEnabled: setA11yMode,
    toggle: () => setA11yMode(!s.a11y),
  };
}
