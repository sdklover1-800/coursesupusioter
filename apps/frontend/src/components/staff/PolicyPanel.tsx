import { useId } from 'react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { DEFAULT_QUIZ_COOLDOWN_MINUTES, QuizReviewPolicy, QuizScoringRule } from '@edu/shared';
import { Card, Field, Input, SegmentedControl } from '../ui';
import { Icon } from '../icons';
import type { QuizEdit, QuizSettingsPatch } from '../../lib/staff';
import { SectionTitle } from './primitives';

/** Черновик настроек теста: порог — в процентах, пауза — в часах (строки полей ввода). */
export interface SettingsDraft {
  title: string;
  thresholdPct: string;
  maxAttempts: string;
  reviewPolicy: string;
  scoringRule: string;
  /** '' — по умолчанию (env), '0' — без паузы */
  cooldownHours: string;
}

const hoursOf = (minutes: number) => String(+(minutes / 60).toFixed(2));

export function settingsDraftOf(q: QuizEdit): SettingsDraft {
  return {
    title: q.title,
    thresholdPct: String(Math.round(q.passThreshold * 100)),
    maxAttempts: String(q.maxAttempts),
    reviewPolicy: q.reviewPolicy,
    scoringRule: q.scoringRule,
    cooldownHours: q.cooldownMinutes === null ? '' : hoursOf(q.cooldownMinutes),
  };
}

export interface SettingsErrors {
  title?: string;
  thresholdPct?: string;
  maxAttempts?: string;
  cooldownHours?: string;
}

/**
 * Проверка и патч настроек: только изменённые поля (сервер игнорирует неизменённые,
 * но при попытках даёт 409 QUIZ_FROZEN на порог/правило/уменьшение попыток).
 */
export function settingsPatch(q: QuizEdit, d: SettingsDraft, t: TFunction): { patch: QuizSettingsPatch; errors: SettingsErrors } {
  const errors: SettingsErrors = {};
  const patch: QuizSettingsPatch = {};
  const title = d.title.trim();
  if (!title) errors.title = t('manager.policy.errTitle');
  else if (title !== q.title) patch.title = title;

  if (q.isGraded) {
    const pct = Number(d.thresholdPct);
    if (!/^\d{1,3}$/.test(d.thresholdPct.trim()) || pct < 0 || pct > 100) errors.thresholdPct = t('manager.policy.errThreshold');
    else if (Math.round(q.passThreshold * 100) !== pct) patch.passThreshold = pct / 100;

    const att = Number(d.maxAttempts);
    if (!/^\d{1,2}$/.test(d.maxAttempts.trim()) || att < 1 || att > 10) errors.maxAttempts = t('manager.policy.errAttempts');
    else if (q.frozen && att < q.maxAttempts) errors.maxAttempts = t('manager.policy.errAttemptsFrozen', { count: q.maxAttempts });
    else if (att !== q.maxAttempts) patch.maxAttempts = att;

    if (d.reviewPolicy !== q.reviewPolicy) patch.reviewPolicy = d.reviewPolicy;
    if (d.scoringRule !== q.scoringRule) patch.scoringRule = d.scoringRule;

    const raw = d.cooldownHours.trim().replace(',', '.');
    if (!raw) {
      if (q.cooldownMinutes !== null) patch.cooldownMinutes = null;
    } else {
      const h = Number(raw);
      if (!Number.isFinite(h) || h < 0 || h > 168) errors.cooldownHours = t('manager.policy.errCooldown');
      else {
        const minutes = Math.round(h * 60);
        if (minutes !== q.cooldownMinutes) patch.cooldownMinutes = minutes;
      }
    }
  }
  return { patch, errors };
}

const POLICIES = [QuizReviewPolicy.FULL_AFTER_FINAL, QuizReviewPolicy.SCORE_UNTIL_FINAL, QuizReviewPolicy.SCORE_ONLY];

/**
 * «Что видит студент» (FE5 §2, Moodle Review options): столбец «Во время попытки»
 * зафиксирован протоколом исследования; «После отправки» — политика разбора; ниже —
 * порог (%), попытки, правило зачёта и пауза в часах. При попытках студентов порог и
 * правило зачёта заблокированы, попытки можно только увеличить.
 */
export function PolicyPanel({ quiz, draft, errors, onChange }: {
  quiz: QuizEdit;
  draft: SettingsDraft;
  errors: SettingsErrors;
  onChange: (next: SettingsDraft) => void;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const set = <K extends keyof SettingsDraft>(k: K, v: SettingsDraft[K]) => onChange({ ...draft, [k]: v });
  const envDefault = quiz.cooldownMinutes === null ? quiz.effectiveCooldownMinutes : DEFAULT_QUIZ_COOLDOWN_MINUTES;
  const frozenHint = quiz.frozen ? t('manager.policy.frozenField') : undefined;

  return (
    <Card className="mb-6 !p-4 sm:!p-6">
      <SectionTitle hint={t('manager.policy.hint')}>{t('manager.policy.title')}</SectionTitle>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="self-start rounded-xl border border-border bg-surface-2 p-4" title={t('manager.policy.lockedTooltip')}>
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Icon name="lock" size={16} />
            {t('manager.policy.during')}
          </div>
          <p className="mt-1.5 text-body text-fg">{t('manager.policy.duringText')}</p>
          <p className="mt-1 text-small text-fg-2">{t('manager.policy.lockedTooltip')}</p>
        </div>
        <fieldset className="rounded-xl border border-border p-4">
          <legend className="sr-only">{t('manager.policy.after')}</legend>
          <div className="flex items-center gap-2 text-sm font-semibold text-fg" aria-hidden>
            <Icon name="eye" size={16} />
            {t('manager.policy.after')}
          </div>
          <div className="mt-2 space-y-1.5">
            {POLICIES.map((p) => (
              <label
                key={p}
                className={clsx(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-body transition-colors',
                  draft.reviewPolicy === p ? 'border-brand bg-brand-soft/60 text-fg' : 'border-transparent text-fg hover:bg-brand-soft/30',
                )}
              >
                <input
                  type="radio"
                  name={`${uid}-review`}
                  className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]"
                  checked={draft.reviewPolicy === p}
                  onChange={() => set('reviewPolicy', p)}
                />
                <span>{t(`manager.policy.review.${p}`)}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-small text-fg-2">{t(`manager.policy.reviewHint.${draft.reviewPolicy}`, { defaultValue: '' })}</p>
          {draft.reviewPolicy === QuizReviewPolicy.FULL_AFTER_FINAL && (
            <p className="mt-1 flex gap-1.5 text-small text-fg-2">
              <Icon name="info" size={14} className="mt-[3px] shrink-0" />
              {t('manager.policy.tfNote')}
            </p>
          )}
        </fieldset>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label={t('manager.policy.threshold')} hint={errors.thresholdPct ? undefined : frozenHint ?? t('manager.policy.thresholdHint')} error={errors.thresholdPct}>
          <div className="relative">
            <Input
              inputMode="numeric"
              value={draft.thresholdPct}
              onChange={(e) => set('thresholdPct', e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
              disabled={quiz.frozen}
              className="pr-9 font-mono tabular-nums"
              aria-describedby={undefined}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-body text-fg-2" aria-hidden>%</span>
          </div>
        </Field>
        <Field
          label={t('manager.policy.attempts')}
          hint={errors.maxAttempts ? undefined : quiz.frozen ? t('manager.policy.attemptsFrozen') : t('manager.policy.attemptsHint')}
          error={errors.maxAttempts}
        >
          <Input
            type="number"
            min={quiz.frozen ? quiz.maxAttempts : 1}
            max={10}
            value={draft.maxAttempts}
            onChange={(e) => set('maxAttempts', e.target.value)}
            className="font-mono tabular-nums"
          />
        </Field>
        <div className="space-y-1.5">
          <span className="block text-sm font-semibold text-fg">{t('manager.policy.scoring')}</span>
          <SegmentedControl
            ariaLabel={t('manager.policy.scoring')}
            tone="brand"
            fullWidth
            value={draft.scoringRule}
            onChange={(v) => !quiz.frozen && set('scoringRule', v)}
            options={[
              { value: QuizScoringRule.BEST, label: t('manager.policy.scoringBEST') },
              { value: QuizScoringRule.FIRST, label: t('manager.policy.scoringFIRST') },
            ]}
            className={quiz.frozen ? 'pointer-events-none opacity-60' : undefined}
          />
          <span className="block text-small text-fg-2">{frozenHint ?? t('manager.policy.scoringHint')}</span>
        </div>
        <Field
          label={t('manager.policy.cooldown')}
          hint={errors.cooldownHours ? undefined : t('manager.policy.cooldownHint')}
          error={errors.cooldownHours}
        >
          <div className="relative">
            <Input
              inputMode="decimal"
              value={draft.cooldownHours}
              onChange={(e) => set('cooldownHours', e.target.value)}
              placeholder={t('manager.policy.cooldownDefault', { hours: hoursOf(envDefault) })}
              className="pr-10 font-mono tabular-nums placeholder:font-sans"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-body text-fg-2" aria-hidden>
              {t('manager.policy.hoursUnit')}
            </span>
          </div>
        </Field>
      </div>
    </Card>
  );
}
