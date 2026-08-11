import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { PublicUser } from '@edu/shared';
import { api, setAccessToken } from './api';
import i18n from '../i18n';

interface AuthState {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ mustChangePassword?: boolean }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUser: (u: PublicUser) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

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
