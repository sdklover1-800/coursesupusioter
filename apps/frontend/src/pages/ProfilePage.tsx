import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { LANGUAGES, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type Language, type PublicUser } from '@edu/shared';
import { api, ApiError } from '../lib/api';
import { apiErrorText } from '../lib/catalog';
import { useAuth } from '../lib/auth';
import { useA11yMode, useTheme, type ThemePreference } from '../lib/theme';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import i18n from '../i18n';
import { Button, Card, Field, Icon, Input, SegmentedControl, toast } from '../components/ui';
import { PageHeader } from '../components/page';

/**
 * Профиль (/profile, screen_specs «Onboarding»): ФИО и email (только чтение), язык интерфейса
 * (как переключатель в оболочке: i18n + PATCH /me), тема, версия для слабовидящих и смена пароля.
 * Язык ОБУЧЕНИЯ курса меняется на странице курса (фиксируется в исследовании), не здесь.
 */
export function ProfilePage() {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const { preference, setPreference } = useTheme();
  const a11y = useA11yMode();
  useDocumentTitle(t('profile.title'));
  const current = (LANGUAGES as readonly string[]).includes(i18n.language) ? (i18n.language as Language) : 'ru';

  function pickLanguage(lng: Language) {
    void i18n.changeLanguage(lng);
    api
      .patch<{ user: PublicUser }>('/me', { interfaceLanguage: lng })
      .then((r) => r?.user && setUser(r.user))
      .catch(() => undefined);
  }

  if (!user) return null;
  return (
    <>
      <PageHeader title={t('profile.title')} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card className="!p-5 sm:!p-6">
            <h2 className="font-sans text-title">{t('profile.account')}</h2>
            <dl className="mt-4 divide-y divide-border border-y border-border">
              {[
                { k: 'name', label: t('profile.name'), value: user.name },
                { k: 'email', label: t('profile.email'), value: user.email },
                { k: 'role', label: t('profile.role'), value: t(`roles.${user.role}`) },
              ].map((r) => (
                <div key={r.k} className="grid gap-0.5 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                  <dt className="text-meta text-fg-2">{r.label}</dt>
                  <dd className="break-words text-body font-medium text-fg">{r.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-meta text-fg-2">{t('profile.readOnlyHint')}</p>
          </Card>

          <Card className="!p-5 sm:!p-6">
            <h2 className="font-sans text-title">{t('profile.interface')}</h2>
            <div className="mt-4 space-y-5">
              <div>
                <p id="profile-lang" className="text-label font-semibold text-fg">{t('profile.interfaceLanguage')}</p>
                <SegmentedControl<Language>
                  ariaLabel={t('profile.interfaceLanguage')}
                  value={current}
                  onChange={pickLanguage}
                  className="mt-2"
                  options={LANGUAGES.map((lng) => ({ value: lng, label: t(`languages.${lng}`), lang: lng }))}
                />
                <p className="mt-1.5 text-meta text-fg-2">{t('profile.interfaceLanguageHint')}</p>
              </div>
              <ThemePicker value={preference} onChange={setPreference} />
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p id="profile-a11y" className="text-label font-semibold text-fg">{t('profile.a11y')}</p>
                  <p id="profile-a11y-hint" className="mt-0.5 text-meta text-fg-2">{t('profile.a11yHint')}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={a11y.enabled}
                  aria-labelledby="profile-a11y"
                  aria-describedby="profile-a11y-hint"
                  onClick={a11y.toggle}
                  className={clsx(
                    'relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors',
                    a11y.enabled ? 'border-brand-fill bg-brand-fill' : 'border-border-strong bg-surface-2',
                  )}
                >
                  <span
                    className={clsx(
                      'inline-grid h-5 w-5 place-items-center rounded-full bg-white shadow-soft transition-transform',
                      a11y.enabled ? 'translate-x-6 text-brand' : 'translate-x-1 text-fg-2',
                    )}
                    aria-hidden
                  >
                    <Icon name="eye" size={12} strokeWidth={2} />
                  </span>
                </button>
              </div>
            </div>
          </Card>
        </div>

        <Card className="!p-5 sm:!p-6">
          <h2 className="font-sans text-title">{t('profile.password')}</h2>
          <div className="mt-4">
            <PasswordChangeForm
              submitLabel={t('profile.passwordSubmit')}
              onDone={() => toast(t('profile.passwordChangedHint'), 'teal', { duration: 6000 })}
            />
          </div>
        </Card>
      </div>
    </>
  );
}

type PwKey = 'current' | 'next' | 'confirm';

/**
 * Форма смены пароля (FR-1.7): текущий / новый / повтор, autocomplete current-password и
 * new-password, подсказка «Не менее 8 символов» (политика общая с сервером, @edu/shared).
 * Ошибки — у полей (aria-invalid), неверный текущий пароль — у первого поля.
 */
export function PasswordChangeForm({ submitLabel, onDone }: { submitLabel: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<Record<PwKey, string>>({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState<Partial<Record<PwKey, string>>>({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);

  function validate(): Partial<Record<PwKey, string>> {
    const e: Partial<Record<PwKey, string>> = {};
    if (!form.current) e.current = t('auth.errRequired');
    if (form.next.length < PASSWORD_MIN_LENGTH) e.next = t('auth.errShort', { min: PASSWORD_MIN_LENGTH });
    else if (form.next.length > PASSWORD_MAX_LENGTH) e.next = t('auth.errLong', { max: PASSWORD_MAX_LENGTH });
    if (form.confirm !== form.next) e.confirm = t('auth.errMismatch');
    return e;
  }

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setFormError('');
    const e = validate();
    setErrors(e);
    const first = (['current', 'next', 'confirm'] as PwKey[]).find((k) => e[k]);
    if (first) {
      ev.currentTarget.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/password/change', { currentPassword: form.current, newPassword: form.next });
      setForm({ current: '', next: '', confirm: '' });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setErrors({ current: t('auth.errCurrent') });
      else setFormError(apiErrorText(t, err));
    } finally {
      setLoading(false);
    }
  }

  const set = (k: PwKey) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
      {formError && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/8 px-4 py-2.5 text-body font-medium text-danger-ink">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          {formError}
        </p>
      )}
      <Field label={t('auth.currentPassword')} error={errors.current}>
        <Input name="current" type="password" autoComplete="current-password" value={form.current} onChange={set('current')} aria-invalid={!!errors.current || undefined} />
      </Field>
      <Field label={t('auth.newPassword')} hint={t('auth.passwordHint', { min: PASSWORD_MIN_LENGTH })} error={errors.next}>
        <Input
          name="next"
          type="password"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          value={form.next}
          onChange={set('next')}
          aria-invalid={!!errors.next || undefined}
        />
      </Field>
      <Field label={t('auth.confirmPassword')} error={errors.confirm}>
        <Input
          name="confirm"
          type="password"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          value={form.confirm}
          onChange={set('confirm')}
          aria-invalid={!!errors.confirm || undefined}
        />
      </Field>
      <Button type="submit" loading={loading} className="w-full sm:w-auto">
        {submitLabel}
      </Button>
    </form>
  );
}

/**
 * Тема: три плитки-радиокнопки (иконка + подпись). Сегментный переключатель с иконками
 * не помещался в 390px (особенно «Жүйедегідей»), плитки делят ширину поровну и переносят текст.
 */
function ThemePicker({ value, onChange }: { value: ThemePreference; onChange: (v: ThemePreference) => void }) {
  const { t } = useTranslation();
  const options: { value: ThemePreference; icon: 'sun' | 'moon' | 'monitor'; label: string }[] = [
    { value: 'light', icon: 'sun', label: t('profile.themeLight') },
    { value: 'dark', icon: 'moon', label: t('profile.themeDark') },
    { value: 'system', icon: 'monitor', label: t('profile.themeSystem') },
  ];
  return (
    <fieldset>
      <legend className="text-label font-semibold text-fg">{t('profile.theme')}</legend>
      <div className="mt-2 grid max-w-md grid-cols-3 gap-2">
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <label
              key={o.value}
              className={clsx(
                'flex min-h-[4.5rem] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-center text-label font-semibold transition-colors',
                'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand',
                checked ? 'border-ink bg-ink text-white dark:border-fg dark:bg-fg dark:text-ink' : 'border-border bg-card text-fg-2 hover:border-brand/50 hover:text-fg',
              )}
            >
              <input type="radio" name="theme" value={o.value} checked={checked} onChange={() => onChange(o.value)} className="sr-only" />
              <Icon name={o.icon} size={20} />
              <span className="min-w-0 break-words">{o.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
