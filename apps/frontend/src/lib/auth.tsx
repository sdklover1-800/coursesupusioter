import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PublicUser } from '@edu/shared';
import { api, setAccessToken, setApiListeners } from './api';
import i18n from '../i18n';
import { toast } from '../components/ui';

interface AuthState {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ mustChangePassword?: boolean }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUser: (u: PublicUser) => void;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Навигация вне дерева роутера: AuthProvider стоит над RouterProvider, поэтому
 * router.tsx регистрирует здесь router.navigate (без циклического импорта).
 */
let navigateFn: ((to: string) => void) | null = null;
export function setAuthNavigator(fn: (to: string) => void): void {
  navigateFn = fn;
}
function go(to: string) {
  if (navigateFn) navigateFn(to);
  else window.location.assign(to);
}
/** Текущий путь (для ?next=) — только внутренний, без служебных экранов. */
function currentPath(): string {
  return window.location.pathname + window.location.search;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const userRef = useRef<PublicUser | null>(null);
  userRef.current = user;

  // При старте — пробуем восстановить сессию через refresh-cookie.
  useEffect(() => {
    (async () => {
      try {
        const ok = await api.tryRefresh();
        if (ok) {
          const { user } = await api.get<{ user: PublicUser }>('/me');
          applyUser(user);
        }
      } catch {
        /* нет активной сессии */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Глобальные реакции API: истёкшая сессия и гейты доступа (смена пароля, согласие)
  useEffect(() => {
    setApiListeners({
      onAuthLost: () => {
        if (!userRef.current) return;
        setAccessToken(null);
        setUserState(null);
        toast(i18n.t('shell.sessionExpired'), 'danger');
        const here = currentPath();
        go(here.startsWith('/login') ? '/login' : `/login?next=${encodeURIComponent(here)}`);
      },
      onGateError: (code) => {
        const path = window.location.pathname;
        if (code === 'PASSWORD_CHANGE_REQUIRED' && path !== '/change-password') go('/change-password');
        if (code === 'CONSENT_REQUIRED' && path !== '/consent') go(`/consent?next=${encodeURIComponent(currentPath())}`);
      },
    });
    return () => setApiListeners({});
  }, []);

  function applyUser(u: PublicUser | null) {
    setUserState(u);
    if (u) void i18n.changeLanguage(u.interfaceLanguage);
  }

  const login: AuthState['login'] = async (email, password) => {
    const res = await api.post<{ accessToken: string; user: PublicUser; mustChangePassword?: boolean }>('/auth/login', { email, password });
    setAccessToken(res.accessToken);
    applyUser(res.user);
    return { mustChangePassword: res.mustChangePassword };
  };

  const logout: AuthState['logout'] = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setAccessToken(null);
      setUserState(null);
    }
  };

  const refreshUser = async () => {
    const { user } = await api.get<{ user: PublicUser }>('/me');
    applyUser(user);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser, setUser: applyUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth вне AuthProvider');
  return ctx;
}
