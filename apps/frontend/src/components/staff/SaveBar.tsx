import { clsx } from 'clsx';
import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog } from '../ui';
import { Icon } from '../icons';

/**
 * Липкая панель сохранения редакторов (FE5 §2–3): «Сохранить все (n)» + «Отменить правки».
 * Нижний край учитывает нижнюю панель вкладок на мобильных (h-16 + safe area) и safe area.
 */
export function SaveBar({
  count, saving, onSave, onDiscard, disabled, hint, className,
}: {
  /** Число изменённых элементов; 0 — панель скрыта */
  count: number;
  saving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  disabled?: boolean;
  hint?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  if (count <= 0 && !saving) return null;
  return (
    <div
      className={clsx(
        'sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-20 mt-6 lg:bottom-4',
        className,
      )}
    >
      <div className="card flex flex-wrap items-center gap-x-3 gap-y-2 border-brand/40 px-4 py-3 shadow-float" role="region" aria-label={t('manager.save.region')}>
        <span className="inline-flex min-w-0 flex-1 basis-48 items-center gap-2 text-body font-medium text-fg">
          <Icon name="pencil" size={18} className="shrink-0 text-brand" />
          <span>{hint ?? t('manager.save.unsaved', { count })}</span>
        </span>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={saving} className="whitespace-nowrap">
            {t('manager.save.discard')}
          </Button>
          <Button size="sm" onClick={onSave} loading={saving} disabled={disabled} className="whitespace-nowrap">
            {t('manager.save.saveAll', { count })}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Защита от ухода с несохранёнными правками: переходы внутри приложения — ConfirmDialog
 * (useBlocker data-роутера), закрытие/перезагрузка вкладки — beforeunload.
 */
export function LeaveGuard({ when }: { when: boolean }) {
  const { t } = useTranslation();
  const blocker = useBlocker(({ currentLocation, nextLocation }) => when && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!when) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [when]);

  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      title={t('manager.save.leaveTitle')}
      body={t('manager.save.leaveBody')}
      confirmLabel={t('manager.save.leaveConfirm')}
      cancelLabel={t('manager.save.leaveCancel')}
      tone="danger"
      onConfirm={() => blocker.proceed?.()}
      onCancel={() => blocker.reset?.()}
    />
  );
}
