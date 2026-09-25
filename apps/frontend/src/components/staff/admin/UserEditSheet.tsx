import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiErrorCode, LANGUAGES, Role, type Language } from '@edu/shared';
import { ApiError } from '../../../lib/api';
import { useFormat } from '../../../lib/format';
import { consentState, relativeTime, useUpdateUser, type AdminCohort, type AdminUser, type UserPatch } from '../../../lib/staffAdmin';
import { Button, ConfirmDialog, Field, Select, Sheet, toast } from '../../ui';
import { SelfRegisteredChip } from '../../enrollment';
import { ConsentMark, InfoRow, Notice, SectionTitle, conditionLabel } from './bits';

const ROLES = Object.values(Role);

/**
 * Лист «Изменить пользователя» (FE5 §6): роль, когорта, язык интерфейса, сброс пароля.
 * Роль и когорта меняются только через ConfirmDialog с последствиями; при 409 COHORTS_LOCKED —
 * причина и явная галочка «Изменить несмотря на блокировку» (force) со вторым подтверждением.
 * Монтируется с key={user.id}: состав полей берётся из пользователя при открытии.
 */
export function UserEditSheet({
  user, cohorts, consentVersion, onClose, onResetPassword,
}: {
  user: AdminUser;
  cohorts: AdminCohort[];
  consentVersion?: string;
  onClose: () => void;
  onResetPassword: (u: AdminUser) => void;
}) {
  const { t } = useTranslation();
  const { formatDate, lng } = useFormat();
  const update = useUpdateUser();

  const [role, setRole] = useState<Role>(user.role);
  const [cohortId, setCohortId] = useState<string>(user.cohortId ?? '');
  const [lang, setLang] = useState<Language>(user.interfaceLanguage);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [force, setForce] = useState(false);
  const [forceOpen, setForceOpen] = useState(false);
  const lockedRef = useRef<HTMLDivElement>(null);
  // 409 COHORTS_LOCKED: причина и галочка force могут оказаться ниже края листа — показываем их
  useEffect(() => {
    if (locked) lockedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [locked]);

  const roleChanged = role !== user.role;
  const cohortChanged = (cohortId || null) !== (user.cohortId ?? null);
  const langChanged = lang !== user.interfaceLanguage;
  const dirty = roleChanged || cohortChanged || langChanged;
  // При зафиксированном составе смена группы уходит только с явной галочкой force
  const blockedByLock = locked && cohortChanged && !force;

  const cohortById = (id: string | null) => (id ? cohorts.find((c) => c.id === id) : undefined);
  const cohortCondition = (id: string | null) => {
    const c = cohortById(id);
    return c ? conditionLabel(t, c.condition) : t('admin.noCohort');
  };
  const selectedCohort = cohortById(cohortId || null);
  const consent = consentState(user, consentVersion);

  const send = (withForce: boolean) => {
    const patch: UserPatch = {};
    if (roleChanged) patch.role = role;
    if (cohortChanged) patch.cohortId = cohortId || null;
    if (langChanged) patch.interfaceLanguage = lang;
    if (withForce && cohortChanged) patch.force = true;
    update.mutate(
      { id: user.id, patch },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          setForceOpen(false);
          toast(t('admin.editUser.saved'), 'teal');
          onClose();
        },
        onError: (err) => {
          setConfirmOpen(false);
          setForceOpen(false);
          if (err instanceof ApiError && err.code === ApiErrorCode.COHORTS_LOCKED) {
            setLocked(true);
            return;
          }
          toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger');
        },
      },
    );
  };

  const onSave = () => {
    if (!dirty || blockedByLock) return;
    // Язык интерфейса — без последствий для исследования: сохраняем сразу
    if (!roleChanged && !cohortChanged) return send(false);
    setConfirmOpen(true);
  };

  const onConfirmChanges = () => {
    if (locked && force && cohortChanged) {
      setConfirmOpen(false);
      setForceOpen(true);
      return;
    }
    send(false);
  };

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        busy={update.isPending}
        title={user.name}
        description={user.email}
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={update.isPending}>
              {t('common.cancel')}
            </Button>
            <Button onClick={onSave} disabled={!dirty || blockedByLock} loading={update.isPending && !confirmOpen && !forceOpen}>
              {dirty ? t('admin.editUser.save') : t('admin.editUser.noChanges')}
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          {(!user.isActive || user.selfRegisteredAt) && (
            <div className="space-y-2">
              {!user.isActive && <Notice tone="danger" icon="lock" title={t('admin.editUser.inactiveNote')} />}
              {user.selfRegisteredAt && <SelfRegisteredChip />}
            </div>
          )}

          <section>
            <SectionTitle>{t('admin.editUser.info')}</SectionTitle>
            <dl className="divide-y divide-border border-y border-border">
              <InfoRow label={t('admin.editUser.consent')}>
                <ConsentMark state={consent} version={user.researchConsentVersion} />
                {user.researchConsentAt && <div className="text-meta text-fg-2">{formatDate(user.researchConsentAt, 'datetime')}</div>}
              </InfoRow>
              <InfoRow label={t('admin.editUser.lastActivity')}>
                <span title={user.lastActivityAt ? formatDate(user.lastActivityAt, 'datetime') : undefined}>
                  {relativeTime(t, user.lastActivityAt, lng)}
                </span>
              </InfoRow>
            </dl>
          </section>

          <section className="space-y-4">
            <SectionTitle>{t('admin.editUser.access')}</SectionTitle>
            <Field label={t('admin.role')}>
              <Select value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={update.isPending}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`roles.${r}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('admin.editUser.cohortLabel')}
              hint={t('admin.editUser.cohortCondition', { condition: selectedCohort ? conditionLabel(t, selectedCohort.condition) : t('admin.noCohort') })}
            >
              <Select
                value={cohortId}
                onChange={(e) => {
                  setCohortId(e.target.value);
                  setForce(false);
                }}
                disabled={update.isPending}
              >
                <option value="">{t('admin.noCohort')}</option>
                {cohorts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>

            {locked && (
              <div ref={lockedRef}>
              <Notice tone="danger" icon="lock" title={t('admin.editUser.lockedTitle')}>
                <p>{t('admin.editUser.lockedText')}</p>
                {cohortChanged && (
                  <label className="mt-3 flex cursor-pointer items-start gap-3 text-fg">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--danger-ink))]"
                      checked={force}
                      onChange={(e) => setForce(e.target.checked)}
                    />
                    <span>
                      <span className="block font-semibold">{t('admin.editUser.force')}</span>
                      <span className="block text-fg-2">{t('admin.editUser.forceHint')}</span>
                    </span>
                  </label>
                )}
              </Notice>
              </div>
            )}

            <Field label={t('admin.editUser.language')}>
              <Select value={lang} onChange={(e) => setLang(e.target.value as Language)} disabled={update.isPending}>
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {t(`languages.${l}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </section>

          <section>
            <SectionTitle>{t('admin.editUser.passwordTitle')}</SectionTitle>
            <p className="mb-3 text-body text-fg-2">{t('admin.editUser.passwordHint')}</p>
            <Button variant="secondary" onClick={() => onResetPassword(user)} disabled={update.isPending}>
              {t('admin.resetPassword')}
            </Button>
          </section>
        </div>
      </Sheet>

      {/* Роль/когорта: последствия прописаны явно (FE5 §6) */}
      <ConfirmDialog
        open={confirmOpen}
        title={t('admin.confirm.changeTitle')}
        tone={cohortChanged ? 'danger' : 'primary'}
        busy={update.isPending}
        confirmLabel={t('admin.confirm.apply')}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={onConfirmChanges}
        body={
          <div className="space-y-3">
            <p className="font-medium text-fg">{t('admin.confirm.changeIntro', { name: user.name })}</p>
            <ul className="list-disc space-y-2 pl-5">
              {roleChanged && (
                <li>
                  {t('admin.confirm.role', { from: t(`roles.${user.role}`), to: t(`roles.${role}`) })} {t(`admin.confirm.roleTo.${role}`)}
                </li>
              )}
              {cohortChanged && (
                <li>{t('admin.confirm.cohort', { from: cohortCondition(user.cohortId), to: cohortCondition(cohortId || null) })}</li>
              )}
            </ul>
            <p>{t('admin.confirm.audit')}</p>
          </div>
        }
      />

      {/* Второе подтверждение: смена группы вопреки блокировке состава */}
      <ConfirmDialog
        open={forceOpen}
        title={t('admin.confirm.forceTitle')}
        tone="danger"
        busy={update.isPending}
        confirmLabel={t('admin.confirm.forceConfirm')}
        onCancel={() => setForceOpen(false)}
        onConfirm={() => send(true)}
        body={t('admin.confirm.forceBody', { from: cohortCondition(user.cohortId), to: cohortCondition(cohortId || null) })}
      />
    </>
  );
}
