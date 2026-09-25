import { useTranslation } from 'react-i18next';
import { Button, Dialog, Icon, toast } from '../../ui';

export interface Credential {
  email: string;
  password: string;
}

/**
 * Стартовый пароль (FR-1.4): показывается один раз — после создания пользователя или
 * сброса пароля. Копирование в буфер; закрытие — явной кнопкой «Готово».
 */
export function CredentialDialog({ credential, onClose }: { credential: Credential | null; onClose: () => void }) {
  const { t } = useTranslation();
  const copy = async () => {
    if (!credential) return;
    try {
      await navigator.clipboard.writeText(credential.password);
      toast(t('admin.credential.copied'), 'teal');
    } catch {
      toast(t('admin.credential.copyFailed'), 'danger');
    }
  };
  return (
    <Dialog
      open={!!credential}
      onClose={onClose}
      title={t('admin.credential.title')}
      description={credential ? t('admin.credential.body', { email: credential.email }) : undefined}
      footer={
        <Button onClick={onClose} data-autofocus>
          {t('admin.credential.done')}
        </Button>
      }
    >
      {credential && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3">
          <code className="min-w-0 flex-1 select-all break-all font-mono text-xl font-semibold tabular-nums text-fg">{credential.password}</code>
          <Button variant="secondary" size="sm" onClick={copy}>
            <Icon name="copy" size={16} />
            {t('admin.credential.copy')}
          </Button>
        </div>
      )}
    </Dialog>
  );
}
