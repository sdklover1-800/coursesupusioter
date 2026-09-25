import { clsx } from 'clsx';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Difficulty, QuestionType } from '@edu/shared';
import { Badge, Button, Field, Input, Select } from '../ui';
import { Icon } from '../icons';
import { authorshipTone } from '../../lib/tones';
import { isLowN, isValidTimecode, optionLetter, type EditQuestion, type ItemStatRow, type QuestionPatch } from '../../lib/staff';
import { AutoTextarea, MetaChip, SampleSize } from './primitives';
import { ItemAnalysisPanel, PValue } from './ItemAnalysis';

/* ── Черновик вопроса и патч (только изменённые поля) ── */
export interface QuestionDraft {
  type: string;
  prompt: string;
  options: string[];
  correct: number;
  explanation: string;
  difficulty: string;
  rationales: string[];
  sourceLectureId: string;
  sourceTimecode: string;
}

export function questionDraftOf(q: EditQuestion): QuestionDraft {
  return {
    type: q.type,
    prompt: q.prompt,
    options: [...q.options],
    correct: q.correctOptionIds[0] ?? 0,
    explanation: q.explanation ?? '',
    difficulty: q.difficulty,
    rationales: q.options.map((_, i) => q.optionRationales?.[i] ?? ''),
    sourceLectureId: q.sourceLectureId ?? '',
    sourceTimecode: q.sourceTimecode ?? '',
  };
}

export interface QuestionErrors {
  prompt?: boolean;
  options?: boolean;
  timecode?: boolean;
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function questionPatch(q: EditQuestion, d: QuestionDraft): { patch: QuestionPatch; errors: QuestionErrors } {
  const errors: QuestionErrors = {};
  const patch: QuestionPatch = {};
  const base = questionDraftOf(q);
  const options = d.options.map((o) => o.trim());
  if (!d.prompt.trim()) errors.prompt = true;
  if (options.length < 2 || options.length > 6 || options.some((o) => !o) || (d.type === QuestionType.TRUE_FALSE && options.length !== 2) || d.correct < 0 || d.correct >= options.length) {
    errors.options = true;
  }
  if (!isValidTimecode(d.sourceTimecode)) errors.timecode = true;

  if (d.prompt.trim() !== base.prompt.trim()) patch.prompt = d.prompt.trim();
  const optionsChanged = !same(options, base.options.map((o) => o.trim()));
  if (!q.frozen) {
    if (d.type !== base.type) patch.type = d.type;
    if (optionsChanged) patch.options = options;
    if (d.correct !== base.correct || optionsChanged || d.type !== base.type) patch.correctOptionIds = [d.correct];
  }
  if (d.explanation.trim() !== base.explanation.trim()) patch.explanation = d.explanation.trim() || null;
  if (d.difficulty !== base.difficulty) patch.difficulty = d.difficulty;
  const rationales = d.rationales.slice(0, options.length).map((r) => r.trim());
  while (rationales.length < options.length) rationales.push('');
  // Варианты изменились — отправляем и обоснования (выровненные по вариантам), иначе сервер их обнулит
  if (optionsChanged || !same(rationales, base.rationales.map((r) => r.trim()))) {
    patch.optionRationales = rationales.every((r) => !r) ? null : rationales;
  }
  if (d.sourceLectureId !== base.sourceLectureId) patch.sourceLectureId = d.sourceLectureId || null;
  if (d.sourceTimecode.trim() !== base.sourceTimecode.trim()) patch.sourceTimecode = d.sourceTimecode.trim() || null;
  return { patch, errors };
}

/**
 * Строка вопроса редактора теста (FE5 §2). Свёрнутая: № · тип · формулировка в одну
 * строку · ключ · canonicalKey · жалобы · p-value · «Ждёт экспертной проверки».
 * Развёрнутая: формулировка, варианты с «Верный» и обоснованием, пояснение, источник,
 * анализ задания и действия (проверено экспертом / перегенерировать / удалить).
 */
export function QuestionRow({
  question, index, draft, dirty, expanded, onToggle, onChange, lectures, stat, reviewCount, language, readOnly,
  onReviewed, onRegenerate, onDelete, canDelete,
}: {
  question: EditQuestion;
  index: number;
  draft: QuestionDraft;
  dirty: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChange: (d: QuestionDraft) => void;
  lectures: { id: string; title: string; lectureNumber: number }[];
  stat?: ItemStatRow;
  /** Открытые SYSTEM-отметки экспертной проверки этого вопроса */
  reviewCount: number;
  language?: string;
  /** Архивный вопрос — только чтение */
  readOnly?: boolean;
  onReviewed?: () => void;
  onRegenerate?: () => void;
  onDelete?: () => void;
  /** Удаление разрешено (у теста нет попыток) */
  canDelete: boolean;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const bodyId = `${uid}-body`;
  const isTF = draft.type === QuestionType.TRUE_FALSE;
  const lockOptions = question.frozen || !!readOnly;
  const { errors } = questionPatch(question, draft);
  const set = <K extends keyof QuestionDraft>(k: K, v: QuestionDraft[K]) => onChange({ ...draft, [k]: v });
  const regenBlocked = question.frozen ? t('manager.qe.regenFrozen') : question.canonicalKey ? t('manager.qe.regenCanonical') : null;

  function changeType(next: string) {
    if (next === QuestionType.TRUE_FALSE) {
      const opts = draft.options.length === 2 ? draft.options : [t('manager.qe.trueLabel', { lng: language }), t('manager.qe.falseLabel', { lng: language })];
      onChange({ ...draft, type: next, options: opts, correct: draft.correct > 1 ? 0 : draft.correct, rationales: opts.map((_, i) => draft.rationales[i] ?? '') });
    } else onChange({ ...draft, type: next });
  }
  function setOption(i: number, v: string) {
    set('options', draft.options.map((o, idx) => (idx === i ? v : o)));
  }
  function setRationale(i: number, v: string) {
    const r = draft.options.map((_, idx) => draft.rationales[idx] ?? '');
    r[i] = v;
    set('rationales', r);
  }
  function addOption() {
    onChange({ ...draft, options: [...draft.options, ''], rationales: [...draft.options.map((_, i) => draft.rationales[i] ?? ''), ''] });
  }
  function removeOption(i: number) {
    onChange({
      ...draft,
      options: draft.options.filter((_, idx) => idx !== i),
      rationales: draft.options.map((_, idx) => draft.rationales[idx] ?? '').filter((_, idx) => idx !== i),
      correct: draft.correct === i ? 0 : draft.correct > i ? draft.correct - 1 : draft.correct,
    });
  }

  return (
    <li id={`q-${question.id}`} className={clsx('scroll-mt-24 rounded-xl border bg-card transition-colors', expanded ? 'border-brand/40 shadow-soft' : 'border-border', readOnly && 'bg-surface')}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className="flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left hover:bg-brand-soft/25 focus-visible:outline-offset-[-2px]"
      >
        <span className="num mt-0.5 grid h-7 min-w-[1.75rem] shrink-0 place-items-center rounded-md bg-surface-2 px-1 text-fg">{index}</span>
        <span className="min-w-0 flex-1">
          <span className={clsx('text-body font-medium text-fg', expanded ? 'block' : 'line-clamp-2 sm:line-clamp-1')} lang={language}>
            {draft.prompt || t('manager.qe.emptyPrompt')}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-small text-fg-2">
            <span>{t(`manager.questionType.${draft.type}`, { defaultValue: draft.type })}</span>
            <span aria-hidden>·</span>
            <span>
              {t('manager.qe.key')} <span className="num text-small font-semibold text-fg">{optionLetter(draft.correct)}</span>
            </span>
            {question.canonicalKey && (
              <>
                <span aria-hidden>·</span>
                <span className="num text-small" title={t('manager.qe.canonicalKey')}>{question.canonicalKey}</span>
              </>
            )}
            {stat && stat.n > 0 && (
              <>
                <span aria-hidden>·</span>
                {/* При n < 10 без вердикта «трудный/лёгкий» — рядом «n = … мало данных» (A16) */}
                <PValue p={stat.pValue} n={stat.n} />
                {isLowN(stat.n) && <SampleSize n={stat.n} unit="answers" />}
              </>
            )}
            {question.openIssueCount > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1 font-medium text-danger-ink">
                  <Icon name="flag" size={14} />
                  {t('manager.qe.reports', { count: question.openIssueCount })}
                </span>
              </>
            )}
            {question.frozen && !readOnly && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <Icon name="lock" size={14} />
                  {t('manager.qe.frozenShort')}
                </span>
              </>
            )}
            {dirty && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1 font-semibold text-brand">
                  <Icon name="pencil" size={14} />
                  {t('manager.qe.changed')}
                </span>
              </>
            )}
          </span>
          {(question.reviewPending || readOnly) && (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {question.reviewPending && <MetaChip icon="flag" tone="spark">{t('manager.qe.reviewPending')}</MetaChip>}
              {readOnly && <MetaChip icon="history" tone="muted">{t('manager.qe.archived')}</MetaChip>}
            </span>
          )}
        </span>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={20} className="mt-0.5 shrink-0 text-fg-2" />
      </button>

      {expanded && (
        <div id={bodyId} className="space-y-5 border-t border-border px-4 pb-4 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            {question.isAIGenerated && <Badge tone={authorshipTone.ai}>{t('manager.aiGenerated')}</Badge>}
            {question.isEdited && <Badge tone={authorshipTone.edited}>{t('manager.edited')}</Badge>}
            {question.frozen && !readOnly && (
              <span className="inline-flex items-center gap-1.5 text-small text-fg-2">
                <Icon name="lock" size={14} />
                {t('manager.qe.frozenQuestion')}
              </span>
            )}
          </div>

          <Field label={t('manager.questionText')} error={errors.prompt ? t('manager.qe.errPrompt') : undefined}>
            <AutoTextarea lang={language} value={draft.prompt} onChange={(e) => set('prompt', e.target.value)} disabled={readOnly} minRows={2} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('manager.qe.type')} hint={question.frozen ? t('manager.qe.lockedByAttempts') : undefined}>
              <Select value={draft.type} onChange={(e) => changeType(e.target.value)} disabled={lockOptions}>
                <option value={QuestionType.SINGLE_CHOICE}>{t('manager.questionType.SINGLE_CHOICE')}</option>
                <option value={QuestionType.TRUE_FALSE}>{t('manager.questionType.TRUE_FALSE')}</option>
              </Select>
            </Field>
            <Field label={t('manager.difficulty')}>
              <Select value={draft.difficulty} onChange={(e) => set('difficulty', e.target.value)} disabled={readOnly}>
                {Object.values(Difficulty).map((d) => (
                  <option key={d} value={d}>{t(`difficulty.${d}`)}</option>
                ))}
              </Select>
            </Field>
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-fg">{t('manager.qe.optionsLegend')}</legend>
            {errors.options && <p className="mb-2 text-small font-medium text-danger-ink">{t('manager.qe.errOptions')}</p>}
            <ol className="space-y-2">
              {draft.options.map((opt, i) => {
                const isKey = draft.correct === i;
                return (
                  <li key={i} className={clsx('rounded-lg border p-3', isKey ? 'border-teal-ink/40 bg-teal/8' : 'border-border')}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border-strong bg-card text-fg">{optionLetter(i)}</span>
                      <Input
                        lang={language}
                        value={opt}
                        onChange={(e) => setOption(i, e.target.value)}
                        disabled={lockOptions}
                        aria-label={t('manager.qe.optionLabel', { letter: optionLetter(i) })}
                        className="min-w-0 flex-1 basis-48"
                      />
                      <label className={clsx('inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-small font-semibold', isKey ? 'text-teal-ink' : 'text-fg-2', lockOptions && 'cursor-not-allowed')}>
                        <input
                          type="radio"
                          name={`${uid}-correct`}
                          checked={isKey}
                          disabled={lockOptions}
                          onChange={() => set('correct', i)}
                          className="h-4 w-4 accent-[rgb(var(--teal-ink))]"
                        />
                        {t('manager.qe.correct')}
                      </label>
                      {!lockOptions && !isTF && draft.options.length > 2 && (
                        <Button variant="ghost" size="sm" className="!px-2 text-fg-2" onClick={() => removeOption(i)} aria-label={t('manager.qe.removeOption', { letter: optionLetter(i) })}>
                          <Icon name="x" size={16} />
                        </Button>
                      )}
                    </div>
                    <AutoTextarea
                      lang={language}
                      minRows={1}
                      value={draft.rationales[i] ?? ''}
                      onChange={(e) => setRationale(i, e.target.value)}
                      disabled={readOnly}
                      placeholder={t('manager.qe.rationalePlaceholder')}
                      aria-label={t('manager.qe.rationaleLabel', { letter: optionLetter(i) })}
                      className="mt-2 !py-2 text-body"
                    />
                  </li>
                );
              })}
            </ol>
            {!lockOptions && !isTF && draft.options.length < 6 && (
              <Button variant="secondary" size="sm" onClick={addOption} className="mt-2">
                <Icon name="plus" size={16} />
                {t('manager.qe.addOption')}
              </Button>
            )}
          </fieldset>

          <Field label={t('manager.qe.explanation')} hint={t('manager.qe.explanationHint')}>
            <AutoTextarea lang={language} value={draft.explanation} onChange={(e) => set('explanation', e.target.value)} disabled={readOnly} minRows={2} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <Field label={t('manager.qe.sourceLecture')}>
              <Select value={draft.sourceLectureId} onChange={(e) => set('sourceLectureId', e.target.value)} disabled={readOnly}>
                <option value="">{t('manager.qe.sourceNone')}</option>
                {lectures.map((l) => (
                  <option key={l.id} value={l.id}>{t('manager.qe.sourceOption', { n: l.lectureNumber, title: l.title })}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('manager.qe.timecode')} error={errors.timecode ? t('manager.qe.errTimecode') : undefined}>
              <Input value={draft.sourceTimecode} onChange={(e) => set('sourceTimecode', e.target.value)} placeholder="12:40" inputMode="numeric" disabled={readOnly} className="font-mono tabular-nums" />
            </Field>
          </div>

          <ItemAnalysisPanel stat={stat} options={draft.options} correct={[draft.correct]} />

          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              {reviewCount > 0 && onReviewed && (
                <Button variant="outline" size="sm" onClick={onReviewed}>
                  <Icon name="check" size={16} />
                  {t('manager.qe.markReviewed')}
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={onRegenerate} disabled={!!regenBlocked} title={regenBlocked ?? undefined}>
                <Icon name="refresh" size={16} />
                {t('manager.regenerateQuestion')}
              </Button>
              <Button variant="ghost" size="sm" className="ml-auto text-danger-ink" onClick={onDelete} disabled={!canDelete} title={canDelete ? undefined : t('manager.qe.deleteFrozen')}>
                <Icon name="trash" size={16} />
                {t('common.delete')}
              </Button>
              {regenBlocked && <p className="basis-full text-small text-fg-2">{regenBlocked}</p>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
