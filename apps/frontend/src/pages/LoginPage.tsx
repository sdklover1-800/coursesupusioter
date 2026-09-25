import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { safeNext } from '../lib/catalog';
import { Button, Field, Input } from '../components/ui';
import { AuthLayout } from '../components/AuthLayout';

export function LoginPage() {
  const { t } = useTranslation();
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // ?next — возврат после входа (только относительный путь, без open redirect)
  const next = safeNext(params.get('next'));
  // ?registered=1 — пришли после регистрации (ответ регистрации одинаков для
  // нового и существующего email, поэтому подсказка нейтральна — без перечисления).
  const registered = params.get('registered') === '1';
  const [email, setEmail] = useState(() => params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Редирект декларативно: navigate() во время рендера вызывает обновление
  // RouterProvider из чужого компонента (предупреждение React) — используем <Navigate/>.
  // Во время отправки формы не перехватываем — там свой переход (смена пароля / next).
  if (user && !loading) return <Navigate to={next ?? '/'} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { mustChangePassword } = await login(email, password);
      navigate(mustChangePassword ? '/change-password' : next ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? t('auth.wrongCredentials') : t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }

  const registerHref = next ? `/register?next=${encodeURIComponent(next)}` : '/register';

  return (
    <AuthLayout>
      <h2 className="mb-1 text-2xl font-semibold">{registered ? t('auth.signIn') : t('auth.welcome')}</h2>
      <p className="mb-6 text-sm text-muted">{t('auth.subtitle')}</p>

      {registered && (
        <div role="status" className="mb-6 flex gap-3 rounded-xl border border-teal/35 bg-teal/10 px-4 py-3 text-sm">
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-teal text-[11px] font-bold text-white" aria-hidden>✓</span>
          <div>
            <div className="font-semibold text-fg">{t('register.loginNoticeTitle')}</div>
            <p className="mt-0.5 leading-relaxed text-fg/75">{t('register.loginNotice')}</p>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <Field label={t('auth.email')}>
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@example.com" />
        </Field>
        <Field label={t('auth.password')} error={error}>
          <Input
            type="password"
            autoComplete="current-password"
            required
            autoFocus={registered && !!email}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
        <Button type="submit" size="lg" loading={loading} className="w-full">{t('auth.signIn')}</Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        {t('register.noAccount')}{' '}
        <Link to={registerHref} className="font-semibold text-brand hover:underline">{t('register.signUp')}</Link>
      </p>
    </AuthLayout>
  );
}
