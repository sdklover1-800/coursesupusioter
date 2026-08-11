import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { Button, Field, Input } from '../components/ui';
import { LanguageSwitcher } from '../components/AppShell';

export function LoginPage() {
  const { t } = useTranslation();
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Редирект декларативно: navigate() во время рендера вызывает обновление
  // RouterProvider из чужого компонента (предупреждение React) — используем <Navigate/>.
  if (user) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { mustChangePassword } = await login(email, password);
      navigate(mustChangePassword ? '/change-password' : '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? t('auth.wrongCredentials') : t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Левая панель — тезис (hero) */}
      <div className="relative hidden overflow-hidden bg-ink text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="bg-inquiry-grid absolute inset-0 opacity-40" />
        <div className="relative flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-spark font-display font-bold text-ink">?</span>
          <span className="font-display text-xl font-semibold">{t('common.appName')}</span>
        </div>
        <div className="relative max-w-md">
          {/* Сигнатурный мотив: вопрос ведёт к вопросу */}
          <div className="mb-6 font-mono text-sm text-spark">01 → 02 → 03 → ?</div>
          <h1 className="font-display text-4xl font-semibold leading-tight">{t('auth.tagline')}</h1>
          <p className="mt-5 text-lg text-white/60">{t('auth.subtitle')}</p>
        </div>
        <div className="relative text-xs text-white/40">© {new Date().getFullYear()} · Kazakhstan · Research MVP</div>
      </div>

      {/* Правая панель — форма */}
      <div className="flex flex-col items-center justify-center bg-surface px-6 py-12">
        <div className="absolute right-4 top-4"><LanguageSwitcher /></div>
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-spark font-display font-bold text-ink">?</span>
          </div>
          <h2 className="mb-1 text-2xl font-semibold">{t('auth.welcome')}</h2>
          <p className="mb-8 text-sm text-muted">{t('auth.subtitle')}</p>
          <form onSubmit={submit} className="space-y-4">
            <Field label={t('auth.email')}>
              <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@edu.kz" />
            </Field>
            <Field label={t('auth.password')} error={error}>
              <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </Field>
            <Button type="submit" size="lg" loading={loading} className="w-full">{t('auth.signIn')}</Button>
          </form>
          <p className="mt-6 text-center text-xs text-muted">
            admin@edu.kz · manager@edu.kz · student@edu.kz — пароль см. seed
          </p>
        </div>
      </div>
    </div>
  );
}
