import { useTranslation } from 'react-i18next';
import { Dialog, Kbd } from '../ui';

/** Подсказка по горячим клавишам плеера (клавиша «?»): K, J/L, /, N. */
export function KeyboardHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const rows: { keys: string[]; label: string }[] = [
    { keys: ['K'], label: t('lecture.keys.playPause') },
    { keys: ['J'], label: t('lecture.keys.back10') },
    { keys: ['L'], label: t('lecture.keys.fwd10') },
    { keys: ['/'], label: t('lecture.keys.search') },
    { keys: ['N'], label: t('lecture.keys.next') },
    { keys: ['?'], label: t('lecture.keys.help') },
  ];
  return (
    <Dialog open={open} onClose={onClose} title={t('lecture.keys.title')} description={t('lecture.keys.note')} size="sm">
      <dl className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4">
            <dt className="text-body text-fg">{r.label}</dt>
            <dd className="flex shrink-0 gap-1">
              {r.keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
