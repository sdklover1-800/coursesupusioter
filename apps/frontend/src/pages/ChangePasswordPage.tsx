import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../lib/api';
import { Button, Card, Field, Input, toast } from '../components/ui';

export function ChangePasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/password/change', { currentPassword, newPassword });
      toast(t('auth.passwordChanged'), 'teal');
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-surface px-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-xl font-semibold">{t('auth.changePassword')}</h1>
        <p className="mt-1 mb-6 text-sm text-muted">{t('auth.mustChange')}</p>
        <form onSubmit={submit} className="space-y-4">
          <Field label={t('auth.currentPassword')}>
            <Input type="password" required value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label={t('auth.newPassword')} hint="≥ 8 символов" error={error}>
            <Input type="password" required minLength={8} value={newPassword} onChange={(e) => setNew(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" loading={loading}>{t('common.save')}</Button>
        </form>
      </Card>
    </div>
  );
}
