import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PublicUser } from '@edu/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Card } from '../components/ui';
import { LanguageSwitcher } from '../components/AppShell';

/** Экран информированного согласия — блокирует доступ к контенту (FR-R.6, DP-3). */
export function ConsentPage() {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [version, setVersion] = useState('');
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user?.researchConsentAt) navigate('/', { replace: true });
    api.get<{ version: string }>('/admin/consent-info').then((r) => setVersion(r.version)).catch(() => setVersion(''));
  }, [user, navigate]);

  async function accept() {
    setLoading(true);
    try {
      const { user: updated } = await api.post<{ user: PublicUser }>('/me/consent', { version });
      setUser(updated);
      navigate('/', { replace: true });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface px-4 py-10">
      <div className="absolute right-4 top-4"><LanguageSwitcher /></div>
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-spark font-display font-bold text-ink">?</span>
          <span className="font-display text-lg font-semibold">{t('common.appName')}</span>
        </div>
        <Card>
          <div className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-brand">Research · Consent</div>
          <h1 className="text-2xl font-semibold">{t('consent.title')}</h1>
          <p className="mt-4 text-sm leading-relaxed text-fg">{t('consent.intro')}</p>
          <ul className="mt-4 space-y-3">
            {['point1', 'point2', 'point3'].map((p) => (
              <li key={p} className="flex gap-3 text-sm text-fg">
                <span className="mt-0.5 text-spark">✦</span>
                <span>{t(`consent.${p}`)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 rounded-xl bg-brand-soft px-4 py-2.5 font-mono text-xs text-brand">
            {t('consent.version')}: {version || '—'}
          </div>
          <label className="mt-6 flex cursor-pointer items-start gap-3 text-sm font-medium">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" />
            <span>{t('consent.accept')}</span>
          </label>
          <Button size="lg" className="mt-6 w-full" disabled={!checked || !version} loading={loading} onClick={accept}>
            {t('consent.acceptBtn')}
          </Button>
        </Card>
      </div>
    </div>
  );
}
