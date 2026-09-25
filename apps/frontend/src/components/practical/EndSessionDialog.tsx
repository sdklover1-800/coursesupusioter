import { clsx } from 'clsx';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionEndInputReason } from '../../lib/practical';
import { Button, Dialog, Spinner } from '../ui';
import { Icon } from '../icons';

const REASONS: SessionEndInputReason[] = ['DONE', 'TECH_ISSUE', 'OTHER'];

/**
 * «Завершить диалог сейчас? Оценка будет выставлена по уже сказанному.» с причиной:
 * «Я закончил рассуждение» / «Техническая проблема» / «Другое». Техническая проблема —
 * пауза (сессия остаётся IN_PROGRESS, оценки нет). Пока идёт итоговая оценка (до ~10 с, A23) —
 * «Подводим итог…», окно не закрывается.
 */
export function EndSessionDialog({
  open, busy, failed, onCancel, onConfirm,
}: {
  open: boolean;
  busy: boolean;
  /** Прошлая попытка завершения не удалась */
  failed?: boolean;
  onCancel: () => void;
  onConfirm: (reason: SessionEndInputReason) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<SessionEndInputReason>('DONE');
  const groupId = useId();
  useEffect(() => {
    if (open) setReason('DONE');
  }, [open]);
  const pause = reason === 'TECH_ISSUE';

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      busy={busy}
      title={t('practical.end.title')}
      description={busy ? undefined : pause ? t('practical.end.techHint') : t('practical.end.body')}
      footer={
        busy ? undefined : (
          <>
            <Button variant="secondary" onClick={onCancel}>
              {t('ui.dialog.cancel')}
            </Button>
            <Button variant={pause ? 'secondary' : 'primary'} onClick={() => onConfirm(reason)} data-autofocus>
              {pause ? t('practical.end.pause') : t('practical.end.confirm')}
            </Button>
          </>
        )
      }
    >
      {busy ? (
        <div role="status" className="flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-4">
          <Spinner className="h-5 w-5 text-brand" />
          <div>
            <div className="text-body font-semibold text-fg">{t('practical.end.busy')}</div>
            <div className="text-small text-fg-2">{t('practical.end.busyHint')}</div>
          </div>
        </div>
      ) : (
        <>
          <div role="radiogroup" aria-labelledby={groupId}>
            <div id={groupId} className="mb-2 text-sm font-semibold text-fg">
              {t('practical.end.reasonLabel')}
            </div>
            <div className="space-y-2">
              {REASONS.map((r) => {
                const active = reason === r;
                return (
                  <label
                    key={r}
                    className={clsx(
                      'flex min-h-[2.75rem] cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2 text-body transition-colors',
                      active ? 'border-brand bg-brand-soft/60 text-fg' : 'border-border bg-card text-fg hover:border-brand/50',
                    )}
                  >
                    <input
                      type="radio"
                      name={groupId}
                      value={r}
                      checked={active}
                      onChange={() => setReason(r)}
                      className="h-4 w-4 shrink-0 accent-[rgb(var(--brand-fill))]"
                    />
                    <span className="font-medium">{t(`practical.end.reasons.${r}`)}</span>
                  </label>
                );
              })}
            </div>
          </div>
          {failed && (
            <p role="alert" className="mt-3 flex items-center gap-2 text-small font-medium text-danger-ink">
              <Icon name="alert" size={16} />
              {t('practical.end.failed')}
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
