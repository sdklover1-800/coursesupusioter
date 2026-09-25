import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { toast } from '../components/ui';
import { AuthLayout } from '../components/AuthLayout';
import { PasswordChangeForm } from './ProfilePage';

/**
 * Принудительная смена стартового пароля (FR-1.7): экран в AuthLayout — с логотипом
 * и переключателем языка; та же форма, что в профиле (текущий / новый / повтор).
 */
export function ChangePasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useDocumentTitle(t('auth.changePassword'));

  return (
    <AuthLayout>
      <h2 className="font-display text-display-lg">{t('auth.changePassword')}</h2>
      <p className="mb-6 mt-1 text-body text-fg-2">{t('auth.mustChange')}</p>
      <PasswordChangeForm
        submitLabel={t('common.save')}
        onDone={() => {
          toast(t('auth.passwordChanged'), 'teal');
          navigate('/', { replace: true });
        }}
      />
    </AuthLayout>
  );
}
