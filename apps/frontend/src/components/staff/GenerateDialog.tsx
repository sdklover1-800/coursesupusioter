import { clsx } from 'clsx';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog } from '../ui';
import { Icon } from '../icons';
import type { GenerationKind, GenerationStrategy } from '../../lib/staff';
import { Notice } from './primitives';

const KINDS: GenerationKind[] = ['ALL', 'QUIZ', 'MINI', 'PRACTICAL', 'LECTURE_SUMMARY'];
const STRATEGIES: GenerationStrategy[] = ['KEEP', 'OVERWRITE', 'APPEND'];
const STRATEGY_KEY: Record<GenerationStrategy, string> = {
  KEEP: 'manager.strategyKeep',
  OVERWRITE: 'manager.strategyOverwrite',
  APPEND: 'manager.strategyAppend',
};

/**
 * Подтверждение ИИ-генерации (FE5 §1): что генерировать (включая краткие содержания
 * лекций), стратегия повторной генерации, стоимость и гарантия «тесты с попытками не
 * перезаписываются». Вызов API — только по кнопке подтверждения.
 */
export function GenerateDialog({
  open, versionTitle, published, busy, onConfirm, onCancel,
}: {
  open: boolean;
  versionTitle: string;
  published: boolean;
  busy?: boolean;
  onConfirm: (p: { type: GenerationKind; regenStrategy: GenerationStrategy }) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [type, setType] = useState<GenerationKind>('ALL');
  const [strategy, setStrategy] = useState<GenerationStrategy>('KEEP');
  const name = useId();
  useEffect(() => {
    if (open) {
      setType('ALL');
      setStrategy('KEEP');
    }
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      busy={busy}
      size="lg"
      title={t('manager.gen.title')}
      description={versionTitle}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onConfirm({ type, regenStrategy: strategy })} loading={busy}>
            {t('manager.gen.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {published && (
          <Notice tone="spark" icon="alert">
            {t('manager.gen.publishedNote')}
          </Notice>
        )}
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-fg">{t('manager.gen.what')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {KINDS.map((k) => (
              <label
                key={k}
                className={clsx(
                  'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                  type === k ? 'border-brand bg-brand-soft/60' : 'border-border hover:border-brand/40',
                  k === 'ALL' && 'sm:col-span-2',
                )}
              >
                <input
                  type="radio"
                  name={`${name}-type`}
                  className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]"
                  checked={type === k}
                  onChange={() => setType(k)}
                  data-autofocus={k === 'ALL' ? true : undefined}
                />
                <span className="min-w-0">
                  <span className="block text-body font-medium text-fg">{t(`manager.gen.type.${k}`)}</span>
                  <span className="block text-small text-fg-2">{t(`manager.gen.typeHint.${k}`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-fg">{t('manager.regenStrategy')}</legend>
          <div className="space-y-2">
            {STRATEGIES.map((s) => (
              <label
                key={s}
                className={clsx(
                  'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                  strategy === s ? 'border-brand bg-brand-soft/60' : 'border-border hover:border-brand/40',
                )}
              >
                <input type="radio" name={`${name}-strategy`} className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]" checked={strategy === s} onChange={() => setStrategy(s)} />
                <span className="min-w-0">
                  <span className="block text-body font-medium text-fg">{t(STRATEGY_KEY[s])}</span>
                  <span className="block text-small text-fg-2">{t(`manager.gen.strategyHint.${s}`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <ul className="space-y-2 text-body text-fg-2">
          <li className="flex gap-2">
            <Icon name="lock" size={18} className="mt-0.5 shrink-0 text-fg" />
            <span>
              <span className="font-medium text-fg">{t('manager.gen.frozenNote')}</span> {t('manager.gen.canonicalNote')}
            </span>
          </li>
          <li className="flex gap-2">
            <Icon name="clock" size={18} className="mt-0.5 shrink-0 text-fg" />
            <span>{t('manager.gen.costNote')}</span>
          </li>
        </ul>
      </div>
    </Dialog>
  );
}
