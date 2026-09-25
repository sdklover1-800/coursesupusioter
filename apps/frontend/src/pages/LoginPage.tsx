import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { safeNext } from '../lib/catalog';
import { Button, Field, Icon, Input } from '../components/ui';
import { useDocumentTitle } from '../lib/useDocumentTitle';
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
  // ?consent=declined — вышли со страницы согласия: объясняем, почему доступ закрыт
  const consentDeclined = params.get('consent') === 'declined';
  const [email, setEmail] = useState(() => params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useDocumentTitle(t('auth.loginTitle'));

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
      setError(
        err instanceof ApiError && err.status === 429
          ? t('auth.errTooMany')
          : err instanceof ApiError && (err.status === 401 || err.status === 400 || err.status === 422)
            ? t('auth.wrongCredentials')
            : t('errors.generic'),
      );
    } finally {
      setLoading(false);
    }
  }

  const registerHref = next ? `/register?next=${encodeURIComponent(next)}` : '/register';

  return (
    <AuthLayout>
      <h2 className="font-display text-display-lg">{registered ? t('auth.signIn') : t('auth.welcome')}</h2>

      {consentDeclined && (
        <div role="status" className="mt-5 flex gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3 text-body">
          <Icon name="info" size={20} className="mt-0.5 text-fg-2" />
          <div>
            <div className="font-semibold text-fg">{t('auth.consentDeclinedTitle')}</div>
            <p className="mt-0.5 text-meta text-fg-2">{t('auth.consentDeclined')}</p>
          </div>
        </div>
      )}

      {registered && (
        <div role="status" className="mt-5 flex gap-3 rounded-xl border border-teal/35 bg-teal/10 px-4 py-3 text-body">
          <Icon name="check" size={20} strokeWidth={2.25} className="mt-0.5 text-teal-ink" />
          <div>
            <div className="font-semibold text-fg">{t('register.loginNoticeTitle')}</div>
            <p className="mt-0.5 text-meta text-fg-2">{t('register.loginNotice')}</p>
          </div>
        </div>
      )}

      {/* Ошибка формы — в заранее зарезервированном месте: появление не сдвигает поля */}
      <div className="flex min-h-[4.25rem] items-center py-2" aria-live="assertive">
        {error && (
          <div id="login-error" role="alert" className="flex w-full items-start gap-2 rounded-xl border border-danger/30 bg-danger/8 px-4 py-2.5 text-body font-medium text-danger-ink">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Field label={t('auth.email')}>
          <Input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="example@example.com"
            aria-invalid={!!error || undefined}
            aria-describedby={error ? 'login-error' : undefined}
          />
        </Field>
        <Field label={t('auth.password')}>
          <Input
            type="password"
            autoComplete="current-password"
            required
            autoFocus={registered && !!email}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            aria-invalid={!!error || undefined}
            aria-describedby={error ? 'login-error' : undefined}
          />
        </Field>
        <Button type="submit" size="lg" loading={loading} className="w-full">{t('auth.signIn')}</Button>
      </form>

      <p className="mt-6 text-center text-body text-fg-2">
        {t('register.noAccount')}{' '}
        <Link to={registerHref} className="font-semibold text-brand hover:underline">{t('register.signUp')}</Link>
      </p>
    </AuthLayout>
  );
}
