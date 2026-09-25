import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { ApiErrorCode, LANGUAGES } from '@edu/shared';
import type { LanguageLockReason, LanguageSwitchPreview, LearnView } from '../../lib/learn';
import { invalidateLearning } from '../../lib/learn';
import { api, ApiError } from '../../lib/api';
import { Button, Dialog, Icon, Spinner, toast } from '../ui';
import { languageName } from './labels';

/** Причина закрепления языка → фраза (USER_DECISIONS §3). */
export function lockReasonText(t: (k: string) => string, reason: LanguageLockReason | null | undefined): string {
  if (reason === 'GRADED_QUIZ') return t('course.language.lockedGraded');
  if (reason === 'PRACTICAL_REPLY') return t('course.language.lockedPractical');
  return t('course.language.lockedGeneric');
}

/**
 * Смена языка курса (screen_specs «Course home»): подтверждение с предпросмотром сервера —
 * сколько пройденных лекций перенесётся. Смена фиксируется в исследовании (LANGUAGE_SWITCHED);
 * после первого оценивания язык закреплён — показываем замок и причину, без кнопки смены.
 * 409 LANGUAGE_LOCKED (гонка с первой попыткой) → то же закреплённое состояние.
 */
export function CourseLanguageDialog({ open, onClose, view }: { open: boolean; onClose: () => void; view: LearnView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const enrollmentId = view.enrollment.id;
  const currentId = view.enrollment.languageVersionId ?? view.version.id;
  const order = (lng: string) => (LANGUAGES as readonly string[]).indexOf(lng);
  const options = view.availableLanguages.filter((l) => l.id !== currentId).sort((a, b) => order(a.language) - order(b.language));
  const [target, setTarget] = useState<string | null>(options[0]?.id ?? null);
  const [lockedReason, setLockedReason] = useState<LanguageLockReason | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  // Открытие заново — сбрасываем выбор и «гоночное» закрепление
  useEffect(() => {
    if (open) {
      setTarget(options[0]?.id ?? null);
      setLockedReason(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const lockedFromView = view.enrollment.languageLocked;
  const preview = useQuery({
    queryKey: ['language-preview', enrollmentId, target],
    queryFn: () =>
      api.get<LanguageSwitchPreview>(`/enrollments/${enrollmentId}/language-switch-preview?languageVersionId=${encodeURIComponent(target!)}`),
    enabled: open && !lockedFromView && lockedReason === undefined && !!target,
    staleTime: 0,
  });
  const p = preview.data;
  const lockedByPreview = p?.reason === 'LOCKED_AFTER_GRADED';
  const locked = lockedFromView || lockedByPreview || lockedReason !== undefined;
  const reason: LanguageLockReason | null =
    lockedReason !== undefined ? lockedReason : lockedByPreview ? p?.lockReason ?? null : view.enrollment.languageLockReason;
  const currentLang = languageName(t, view.version.language);

  async function confirm() {
    if (!target) return;
    setBusy(true);
    try {
      await api.post(`/enrollments/${enrollmentId}/language`, { languageVersionId: target });
      await invalidateLearning(qc);
      void qc.invalidateQueries({ queryKey: ['course-langs'] });
      toast(t('course.language.switched'), 'teal');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.code === ApiErrorCode.LANGUAGE_LOCKED) {
        const d = err.details as { reason?: LanguageLockReason } | undefined;
        setLockedReason(d?.reason ?? null);
        void invalidateLearning(qc);
      } else {
        toast(err instanceof ApiError ? err.message : t('course.language.failed'), 'danger');
      }
    } finally {
      setBusy(false);
    }
  }

  const footer = locked || !options.length ? (
    <Button variant="secondary" onClick={onClose}>
      {t('common.close')}
    </Button>
  ) : (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        {t('common.cancel')}
      </Button>
      <Button onClick={() => void confirm()} loading={busy} disabled={!p?.allowed || preview.isFetching}>
        {t('course.language.confirm')}
      </Button>
    </>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={t('course.language.dialogTitle')}
      description={locked ? undefined : t('course.language.dialogDesc')}
      footer={footer}
    >
      <p className="flex flex-wrap items-center gap-x-2 text-meta text-fg-2">
        <span>{t('course.language.current')}:</span>
        <span className="font-semibold text-fg" lang={view.version.language}>
          {currentLang}
        </span>
      </p>

      {locked ? (
        <div className="mt-4 rounded-xl border border-border bg-surface-2 p-4" role="status">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-white dark:bg-fg dark:text-card" aria-hidden>
              <Icon name="lock" size={18} />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-fg">{lockReasonText(t, reason)}</p>
              <p className="mt-1 text-meta text-fg-2">{t('course.language.lockedWhy')}</p>
            </div>
          </div>
        </div>
      ) : !options.length ? (
        <p className="mt-4 text-meta text-fg-2">{t('course.language.onlyOne')}</p>
      ) : (
        <>
          <fieldset className="mt-4">
            <legend className="text-label text-fg-2">{t('course.language.choose')}</legend>
            <div className="mt-2 grid gap-2">
              {options.map((o) => {
                const checked = target === o.id;
                return (
                  <label
                    key={o.id}
                    className={clsx(
                      'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand',
                      checked ? 'border-brand bg-brand-soft/60' : 'border-border bg-card hover:border-brand/50',
                    )}
                  >
                    <input
                      type="radio"
                      name="course-language"
                      value={o.id}
                      checked={checked}
                      onChange={() => setTarget(o.id)}
                      className="h-4 w-4 accent-[rgb(var(--brand))]"
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold text-fg" lang={o.language}>
                        {languageName(t, o.language)}
                      </span>
                      <span className="block truncate text-meta text-fg-2" lang={o.language}>
                        {o.title}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-4 min-h-[3.5rem] rounded-xl border border-border bg-surface-2 px-4 py-3" aria-live="polite">
            {preview.isFetching || !p ? (
              <p className="flex items-center gap-2 text-meta text-fg-2">
                <Spinner className="h-4 w-4" />
                {t('course.language.checking')}
              </p>
            ) : p.allowed ? (
              <>
                <p className="flex items-start gap-2 text-meta font-medium text-fg">
                  <Icon name="check" size={18} className="mt-0.5 text-teal-ink" strokeWidth={2.25} />
                  <span>
                    {p.carriedLectures > 0 ? t('course.language.carried', { count: p.carriedLectures }) : t('course.language.carriedNone')}
                  </span>
                </p>
                <p className="mt-1 pl-[26px] text-meta text-fg-2">{t('course.language.carriedHint')}</p>
              </>
            ) : (
              <p className="text-meta text-fg">
                {p.reason === 'COMPLETED' ? t('course.language.completed') : t('course.language.notAvailable')}
              </p>
            )}
          </div>

          <p className="mt-3 flex items-start gap-2 rounded-xl bg-spark/15 px-4 py-3 text-meta text-fg">
            <Icon name="info" size={18} className="mt-0.5 shrink-0 text-spark-ink" />
            <span>{t('course.language.warning')}</span>
          </p>
        </>
      )}
    </Dialog>
  );
}

/**
 * Строка «Язык курса: Русский · Изменить» (правый рельс). Закреплён — замок и причина,
 * а «Подробнее» открывает тот же диалог в закреплённом состоянии (без кнопки смены).
 */
export function CourseLanguageRow({ view, className }: { view: LearnView; className?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const locked = view.enrollment.languageLocked;
  const single = view.availableLanguages.length <= 1;
  return (
    <div className={clsx('card !p-5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="text-label text-fg-2">{t('course.language.label')}</p>
          <p className="font-semibold text-fg" lang={view.version.language}>
            {languageName(t, view.version.language)}
          </p>
        </div>
        {!single && (
          <Button variant={locked ? 'ghost' : 'secondary'} size="sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
            {locked ? t('course.language.details') : t('course.language.change')}
          </Button>
        )}
      </div>
      {locked && (
        <p className="mt-2 flex items-start gap-2 text-meta text-fg-2">
          <Icon name="lock" size={16} className="mt-0.5 shrink-0" />
          <span>{lockReasonText(t, view.enrollment.languageLockReason)}</span>
        </p>
      )}
      <CourseLanguageDialog open={open} onClose={() => setOpen(false)} view={view} />
    </div>
  );
}
