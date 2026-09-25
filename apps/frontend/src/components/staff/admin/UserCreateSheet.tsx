import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, Role, type Language } from '@edu/shared';
import { apiErrorMessage } from '../../../lib/staff';
import { useCreateUser, type AdminCohort } from '../../../lib/staffAdmin';
import { Button, Field, Input, Select, Sheet, toast } from '../../ui';
import type { Credential } from './CredentialDialog';
import { conditionLabel } from './bits';

const ROLES = Object.values(Role);

/** Лист «Добавить пользователя» (FR-1.2, FR-1.4): после создания — стартовый пароль один раз. */
export function UserCreateSheet({
  open, cohorts, onClose, onCreated,
}: {
  open: boolean;
  cohorts: AdminCohort[];
  onClose: () => void;
  onCreated: (c: Credential) => void;
}) {
  const { t, i18n } = useTranslation();
  const create = useCreateUser();
  const initialLang = ((LANGUAGES as readonly string[]).includes(i18n.language) ? i18n.language : 'ru') as Language;
  const empty = { email: '', name: '', role: Role.STUDENT as Role, interfaceLanguage: initialLang, cohortId: '' };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const valid = form.email.trim().length > 3 && form.name.trim().length > 0;

  const close = () => {
    setForm(empty);
    setError(null);
    onClose();
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!valid) return;
    setError(null);
    create.mutate(
      {
        email: form.email.trim(),
        name: form.name.trim(),
        role: form.role,
        interfaceLanguage: form.interfaceLanguage,
        cohortId: form.cohortId || null,
      },
      {
        onSuccess: (r) => {
          toast(t('common.success'), 'teal');
          close();
          onCreated({ email: r.user.email, password: r.startPassword });
        },
        // Ошибка сервера (email занят и т. п.) — у поля, а не только тостом
        onError: (err) => setError(apiErrorMessage(err, t)),
      },
    );
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      busy={create.isPending}
      title={t('admin.newUser.title')}
      description={t('admin.newUser.description')}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={create.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="admin-create-user" loading={create.isPending} disabled={!valid}>
            {t('admin.newUser.submit')}
          </Button>
        </>
      }
    >
      <form id="admin-create-user" className="space-y-4" onSubmit={submit} noValidate>
        <Field label={t('admin.email')} error={error ?? undefined}>
          <Input type="email" autoComplete="off" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-autofocus />
        </Field>
        <Field label={t('admin.fullName')}>
          <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label={t('admin.role')}>
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.interfaceLanguage')}>
          <Select value={form.interfaceLanguage} onChange={(e) => setForm({ ...form, interfaceLanguage: e.target.value as Language })}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {t(`languages.${l}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.editUser.cohortLabel')} hint={t('admin.newUser.cohortHint')}>
          <Select value={form.cohortId} onChange={(e) => setForm({ ...form, cohortId: e.target.value })}>
            <option value="">{t('admin.noCohort')}</option>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {conditionLabel(t, c.condition)}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Sheet>
  );
}
