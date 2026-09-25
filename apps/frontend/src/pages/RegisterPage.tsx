import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LANGUAGES, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USER_NAME_MAX_LENGTH, USER_NAME_MIN_LENGTH, type Language,
} from '@edu/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { safeNext } from '../lib/catalog';
import { Button, Field, Input, Select } from '../components/ui';
import { AuthLayout } from '../components/AuthLayout';

/** Политика — общая с бэкендом (@edu/shared): ФИО 2..100 после trim, пароль 8..128 (как при смене пароля). */
const NAME_MIN = USER_NAME_MIN_LENGTH;
const NAME_MAX = USER_NAME_MAX_LENGTH;
const PASSWORD_MIN = PASSWORD_MIN_LENGTH;
const PASSWORD_MAX = PASSWORD_MAX_LENGTH;
// Управляющие символы в ФИО сервер отклоняет (имя попадает в сертификат и выгрузки)
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldKey = 'name' | 'email' | 'password' | 'password2';
type FormState = Record<FieldKey, string>;

function validate(f: FormState): Partial<Record<FieldKey, string>> {
  const e: Partial<Record<FieldKey, string>> = {};
  const name = f.name.trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX || CONTROL_CHARS.test(name)) e.name = 'register.errName';
  if (!EMAIL_RE.test(f.email.trim()) || f.email.trim().length > 254) e.email = 'register.errEmail';
  if (f.password.length < PASSWORD_MIN) e.password = 'register.errPasswordShort';
  else if (f.password.length > PASSWORD_MAX) e.password = 'register.errPasswordLong';
  if (f.password2 !== f.password) e.password2 = 'register.errPasswordMismatch';
  return e;
}

/**
 * Самостоятельная регистрация студента. Ответ сервера всегда 202 — и для нового,
 * и для уже существующего email (защита от перечисления), поэтому после отправки
 * всегда ведём на вход с нейтральной подсказкой.
 */
export function RegisterPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [form, setForm] = useState<FormState>({ name: '', email: '', password: '', password2: '' });
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  if (user && !loading) return <Navigate to={next ?? '/'} replace />;

  const errors = validate(form);
  const errorOf = (k: FieldKey) => ((touched[k] || submitted) && errors[k] ? t(errors[k]!) : undefined);
  const set = (k: FieldKey) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const blur = (k: FieldKey) => () => setTouched((s) => ({ ...s, [k]: true }));
  const lang = (LANGUAGES as readonly string[]).includes(i18n.language) ? (i18n.language as Language) : 'ru';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setServerError('');
    const invalid = (Object.keys(errors) as FieldKey[])[0];
    if (invalid) {
      formRef.current?.querySelector<HTMLInputElement>(`[name="${invalid}"]`)?.focus();
      return;
    }
    setLoading(true);
    try {
      const email = form.email.trim();
      await api.post('/auth/register', { name: form.name.trim(), email, password: form.password, interfaceLanguage: lang });
      const qs = new URLSearchParams({ registered: '1', email });
      if (next) qs.set('next', next);
      navigate(`/login?${qs.toString()}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setServerError(t('register.errTooMany'));
      else if (err instanceof ApiError && err.status === 400) setServerError(t('register.errInvalid'));
      else setServerError(t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }

  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login';

  return (
    <AuthLayout variant="register">
      <h2 className="mb-1 text-2xl font-semibold">{t('register.title')}</h2>
      <p className="mb-6 text-sm text-muted">{t('register.subtitle')}</p>

      <form ref={formRef} onSubmit={submit} noValidate className="space-y-4">
        <Field label={t('register.name')} error={errorOf('name')}>
          <Input
            name="name" autoComplete="name" maxLength={NAME_MAX} required
            value={form.name} onChange={set('name')} onBlur={blur('name')}
            placeholder={t('register.namePlaceholder')} aria-invalid={!!errorOf('name')}
          />
        </Field>
        <Field label={t('auth.email')} error={errorOf('email')}>
          <Input
            name="email" type="email" autoComplete="email" inputMode="email" required
            value={form.email} onChange={set('email')} onBlur={blur('email')}
            placeholder="example@example.com" aria-invalid={!!errorOf('email')}
          />
        </Field>
        <Field label={t('auth.password')} hint={t('register.passwordHint')} error={errorOf('password')}>
          <Input
            name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX}
            value={form.password} onChange={set('password')} onBlur={blur('password')}
            placeholder="••••••••" aria-invalid={!!errorOf('password')}
          />
        </Field>
        <Field label={t('register.passwordRepeat')} error={errorOf('password2')}>
          <Input
            name="password2" type="password" autoComplete="new-password" required maxLength={PASSWORD_MAX}
            value={form.password2} onChange={set('password2')} onBlur={blur('password2')}
            placeholder="••••••••" aria-invalid={!!errorOf('password2')}
          />
        </Field>
        <Field label={t('register.interfaceLanguage')}>
          <Select value={lang} onChange={(e) => void i18n.changeLanguage(e.target.value)}>
            {LANGUAGES.map((l) => <option key={l} value={l}>{t(`languages.${l}`)}</option>)}
          </Select>
        </Field>

        {serverError && (
          <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">{serverError}</div>
        )}

        <Button type="submit" size="lg" loading={loading} className="w-full">{t('register.submit')}</Button>
        <p className="text-xs leading-relaxed text-muted">{t('register.consentNote')}</p>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        {t('register.haveAccount')}{' '}
        <Link to={loginHref} className="font-semibold text-brand hover:underline">{t('auth.signIn')}</Link>
      </p>
    </AuthLayout>
  );
}
