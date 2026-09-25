import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PublicUser } from '@edu/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { apiErrorText, safeNext } from '../lib/catalog';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { Button, Card, Icon, type IconName } from '../components/ui';
import { LanguageSwitcher, LogoMark, ThemeToggle } from '../components/AppShell';

/** Контакты исследования и одобрение этического комитета — из env сборки (A28), если заданы. */
const RESEARCH_CONTACT = (import.meta.env.VITE_RESEARCH_CONTACT as string | undefined)?.trim() || null;
const ETHICS_APPROVAL = (import.meta.env.VITE_ETHICS_APPROVAL as string | undefined)?.trim() || null;
const CONSENT_FULL_TEXT_URL = (import.meta.env.VITE_CONSENT_FULL_TEXT_URL as string | undefined)?.trim() || null;

const POINTS: { key: 'point1' | 'point2' | 'point3'; icon: IconName }[] = [
  { key: 'point1', icon: 'bar-chart' },
  { key: 'point2', icon: 'lock' },
  { key: 'point3', icon: 'user' },
];

/**
 * Информированное согласие — гейт контента (FR-R.6, DP-3; screen_specs «Onboarding»):
 * три пункта, версия текста, контакт исследовательской группы и одобрение этики (если заданы),
 * ссылка на полный текст; «Принять и продолжить» / «Не соглашаюсь — выйти» (выход с пояснением
 * на экране входа). Неактивная кнопка — приглушённые токены, а не прозрачность (контраст).
 */
export function ConsentPage() {
  const { t } = useTranslation();
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  useDocumentTitle(t('consent.pageTitle'));
  // ?next — возврат к курсу, с которого пришли на гейт согласия
  const next = safeNext(params.get('next')) ?? '/';
  const [version, setVersion] = useState('');
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user?.researchConsentAt) navigate(next, { replace: true });
    api.get<{ version: string }>('/admin/consent-info').then((r) => setVersion(r.version)).catch(() => setVersion(''));
  }, [user, navigate, next]);

  async function accept() {
    setLoading(true);
    setError('');
    try {
      const { user: updated } = await api.post<{ user: PublicUser }>('/me/consent', { version });
      setUser(updated);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? t('consent.acceptError') : apiErrorText(t, err, 'consent.acceptError'));
    } finally {
      setLoading(false);
    }
  }

  async function decline() {
    setLeaving(true);
    try {
      await logout();
    } finally {
      navigate('/login?consent=declined', { replace: true });
    }
  }

  return (
    <div className="min-h-screen bg-surface pb-[env(safe-area-inset-bottom,0px)]">
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] sm:px-6">
        <Link to="/catalog" className="rounded-lg" aria-label={t('common.appName')}>
          <LogoMark size={32} />
        </Link>
        <div className="flex items-center gap-2">
          <LanguageSwitcher variant="responsive" />
          <ThemeToggle />
        </div>
      </header>

      <main id="main" className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <Card className="!p-5 sm:!p-8">
          <p className="eyebrow">{t('consent.eyebrow')}</p>
          <h1 className="mt-1 font-display text-display-lg">{t('consent.title')}</h1>
          <p className="mt-4 max-w-[62ch] text-body-lg text-fg">{t('consent.intro')}</p>

          <ul className="mt-6 space-y-4">
            {POINTS.map((p) => (
              <li key={p.key} className="flex gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand" aria-hidden>
                  <Icon name={p.icon} size={18} />
                </span>
                <span className="max-w-[62ch] pt-1.5 text-body text-fg">{t(`consent.${p.key}`)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-6 space-y-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-meta">
            <p className="flex flex-wrap gap-x-2">
              <span className="text-fg-2">{t('consent.version')}:</span>
              <span className="num text-fg">{version || '—'}</span>
            </p>
            {RESEARCH_CONTACT && <p className="text-fg">{t('consent.contact', { contact: RESEARCH_CONTACT })}</p>}
            {ETHICS_APPROVAL && <p className="text-fg">{t('consent.ethics', { approval: ETHICS_APPROVAL })}</p>}
            <p>
              {CONSENT_FULL_TEXT_URL ? (
                <a href={CONSENT_FULL_TEXT_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
                  {t('consent.fullText')}
                  <Icon name="external-link" size={14} />
                </a>
              ) : (
                <span className="text-fg-2">{t('consent.fullTextOnRequest')}</span>
              )}
            </p>
          </div>

          <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl border border-border px-4 py-3 text-body font-medium transition-colors has-[:checked]:border-brand has-[:checked]:bg-brand-soft/50 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]"
            />
            <span>{t('consent.accept')}</span>
          </label>

          {error && (
            <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-body text-danger-ink">
              <Icon name="alert" size={18} className="mt-0.5" />
              {error}
            </p>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse sm:items-center sm:justify-start">
            <Button
              size="lg"
              disabled={!checked || !version}
              loading={loading}
              onClick={() => void accept()}
              className="disabled:!bg-border disabled:!text-fg-2 disabled:!opacity-100 disabled:!shadow-none sm:min-w-[16rem]"
            >
              {t('consent.acceptBtn')}
            </Button>
            <Button variant="ghost" size="lg" loading={leaving} onClick={() => void decline()} className="text-fg-2 hover:text-fg">
              {t('consent.decline')}
            </Button>
          </div>
          <p className="mt-3 text-meta text-fg-2 sm:text-right">{t('consent.declineHint')}</p>
        </Card>
      </main>
    </div>
  );
}
