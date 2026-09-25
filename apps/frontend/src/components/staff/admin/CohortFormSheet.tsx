import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CohortCondition } from '@edu/shared';
import { ApiError } from '../../../lib/api';
import { useCreateCohort, useUpdateCohort, type AdminCohort } from '../../../lib/staffAdmin';
import { Button, ConfirmDialog, Field, Input, Select, Sheet, Textarea, toast } from '../../ui';
import { conditionLabel } from './bits';

const CONDITIONS = Object.values(CohortCondition);

/**
 * Создание / правка когорты (FR-R.1). Условия — только из CohortCondition, подписи —
 * t('conditions.*'). Смена условия у существующей когорты — ConfirmDialog с последствиями
 * (меняется интерпретация данных всех студентов когорты). Монтируется с key.
 */
export function CohortFormSheet({
  cohort, onClose, onSaved,
}: {
  /** null — создание новой когорты */
  cohort: AdminCohort | null;
  onClose: () => void;
  onSaved?: (c: AdminCohort) => void;
}) {
  const { t } = useTranslation();
  const create = useCreateCohort();
  const update = useUpdateCohort();
  const busy = create.isPending || update.isPending;

  const [name, setName] = useState(cohort?.name ?? '');
  const [condition, setCondition] = useState<string>(cohort?.condition ?? CohortCondition.AI_ASSISTED);
  const [description, setDescription] = useState(cohort?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const conditionChanged = !!cohort && condition !== cohort.condition;
  const dirty = !cohort || name.trim() !== cohort.name || conditionChanged || description.trim() !== (cohort.description ?? '');
  const valid = name.trim().length > 0;

  const fail = (err: unknown) => {
    setConfirmOpen(false);
    setError(err instanceof ApiError ? err.message : t('errors.generic'));
  };

  const save = () => {
    setError(null);
    if (!cohort) {
      create.mutate(
        { name: name.trim(), condition, description: description.trim() },
        {
          onSuccess: (r) => {
            toast(t('admin.cohortsPage.created'), 'teal');
            onSaved?.(r.cohort);
            onClose();
          },
          onError: fail,
        },
      );
      return;
    }
    const patch: { name?: string; condition?: string; description?: string } = {};
    if (name.trim() !== cohort.name) patch.name = name.trim();
    if (conditionChanged) patch.condition = condition;
    if (description.trim() !== (cohort.description ?? '')) patch.description = description.trim();
    update.mutate(
      { id: cohort.id, patch },
      {
        onSuccess: (r) => {
          setConfirmOpen(false);
          toast(t('admin.cohortsPage.saved'), 'teal');
          onSaved?.(r.cohort);
          onClose();
        },
        onError: fail,
      },
    );
  };

  const onSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!valid || !dirty) return;
    if (conditionChanged) setConfirmOpen(true);
    else save();
  };

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        busy={busy}
        title={cohort ? t('admin.cohortsPage.editTitle') : t('admin.cohortsPage.createTitle')}
        description={cohort ? cohort.name : t('admin.cohortsPage.createHint')}
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="admin-cohort-form" loading={busy && !confirmOpen} disabled={!valid || !dirty}>
              {cohort ? t('common.save') : t('common.create')}
            </Button>
          </>
        }
      >
        <form id="admin-cohort-form" className="space-y-4" onSubmit={onSubmit} noValidate>
          <Field label={t('admin.name')} error={error ?? undefined}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('admin.cohortsPage.namePlaceholder')} required data-autofocus />
          </Field>
          <Field label={t('admin.condition')} hint={cohort ? undefined : t('admin.cohortsPage.createHint')}>
            <Select value={condition} onChange={(e) => setCondition(e.target.value)}>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {conditionLabel(t, c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('admin.description')}>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('admin.cohortsPage.descriptionPlaceholder')} rows={4} />
          </Field>
        </form>
      </Sheet>

      <ConfirmDialog
        open={confirmOpen}
        title={t('admin.cohortsPage.conditionTitle')}
        tone="danger"
        busy={busy}
        confirmLabel={t('admin.cohortsPage.conditionConfirm')}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={save}
        body={
          cohort
            ? t('admin.cohortsPage.conditionBody', {
                name: cohort.name,
                students: t('admin.cohortsPage.students', { count: cohort._count.users }),
                from: conditionLabel(t, cohort.condition),
                to: conditionLabel(t, condition),
              })
            : undefined
        }
      />
    </>
  );
}
