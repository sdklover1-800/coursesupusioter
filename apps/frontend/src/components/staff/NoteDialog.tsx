import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Field } from '../ui';
import type { ButtonVariant } from '../primitives/Button';
import { AutoTextarea } from './primitives';

const NOTE_MAX = 2000;

/**
 * Подтверждение с необязательной заметкой сотрудника (закрытие/отклонение жалоб,
 * «Проверено экспертом», пакетное закрытие): последствия — в body, заметка уходит в note.
 */
export function NoteDialog({
  open, title, body, confirmLabel, tone = 'primary', busy, noteLabel, onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  tone?: Extract<ButtonVariant, 'primary' | 'danger'>;
  busy?: boolean;
  noteLabel?: string;
  onConfirm: (note: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) setNote('');
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      busy={busy}
      title={title}
      description={body}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant={tone} onClick={() => onConfirm(note)} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label={noteLabel ?? t('issues.noteLabel')} hint={t('issues.noteHint')}>
        <AutoTextarea data-autofocus minRows={3} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Dialog>
  );
}
