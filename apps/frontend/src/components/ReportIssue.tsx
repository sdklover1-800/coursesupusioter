import { clsx } from 'clsx';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CONTENT_ISSUE_REASONS, type ContentIssueContext, type ContentIssueInput, type ContentIssueTarget } from '@edu/shared';
import { api, ApiError } from '../lib/api';
import { Button, Sheet, Textarea, toast } from './ui';
import { Icon } from './icons';

const COMMENT_MAX = 1000;

/**
 * «Сообщить об ошибке» в контенте (вопрос теста, реплика тьютора, лекция, практикум).
 * Открывает Sheet с причинами из CONTENT_ISSUE_REASONS[targetType] и необязательным
 * комментарием → POST /api/content-issues (ContentIssueInput).
 *
 * Валидность исследования: ЕДИНСТВЕННЫЙ ответ интерфейса после отправки —
 * «Спасибо, сообщение отправлено». Никакой реакции по существу (верно/неверно,
 * исправлено ли) — особенно во время официальной попытки.
 */
export function ReportIssueButton({
  targetType, targetId, context, enrollmentId, compact, className,
}: {
  targetType: ContentIssueTarget;
  targetId: string;
  /** Где возникла жалоба: PRACTICE / REVIEW / OFFICIAL / PRACTICAL / LECTURE */
  context: ContentIssueContext | string;
  enrollmentId?: string;
  /** Только значок ⚑ (подпись — для скринридера и во всплывающей подсказке) */
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const groupId = useId();
  const commentId = useId();
  const reasons: readonly string[] = CONTENT_ISSUE_REASONS[targetType] ?? ['OTHER'];

  function reset() {
    setReason(null);
    setComment('');
  }
  function close() {
    if (busy) return;
    setOpen(false);
    reset();
  }

  async function send() {
    if (!reason) return;
    setBusy(true);
    const body: ContentIssueInput = {
      targetType,
      targetId,
      reason,
      context,
      ...(comment.trim() ? { comment: comment.trim().slice(0, COMMENT_MAX) } : {}),
      ...(enrollmentId ? { enrollmentId } : {}),
    };
    try {
      await api.post('/content-issues', body);
      // Нейтральный тон: без «галочки» teal — в официальной попытке нет цветов правильности (A25)
      toast(t('ui.issue.sent'), 'brand');
      setOpen(false);
      reset();
    } catch (err) {
      // До появления BE2 маршрут отвечает 404 — просто тост об ошибке
      const tooMany = err instanceof ApiError && err.status === 429;
      toast(tooMany ? t('ui.issue.tooMany') : t('ui.issue.failed'), 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={compact ? t('ui.issue.report') : undefined}
        aria-label={compact ? t('ui.issue.report') : undefined}
        aria-haspopup="dialog"
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-lg text-fg-2 transition-colors hover:bg-brand-soft hover:text-fg',
          compact ? 'h-8 w-8 justify-center' : 'h-9 px-2.5 text-sm font-medium',
          className,
        )}
      >
        <Icon name="flag" size={16} />
        {!compact && <span>{t('ui.issue.report')}</span>}
      </button>

      <Sheet
        open={open}
        onClose={close}
        busy={busy}
        title={t('ui.issue.report')}
        description={t('ui.issue.hint')}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              {t('ui.dialog.cancel')}
            </Button>
            <Button onClick={send} loading={busy} disabled={!reason}>
              {t('ui.issue.send')}
            </Button>
          </>
        }
      >
        <div role="radiogroup" aria-labelledby={groupId}>
          <div id={groupId} className="mb-2.5 text-sm font-semibold text-fg">
            {t('ui.issue.reasonLabel')}
          </div>
          <div className="flex flex-wrap gap-2">
            {reasons.map((r) => {
              const active = reason === r;
              return (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setReason(r)}
                  className={clsx(
                    'inline-flex min-h-[2.5rem] items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors',
                    active ? 'border-brand bg-brand-soft text-brand' : 'border-border bg-card text-fg hover:border-brand/50',
                  )}
                >
                  {active && <Icon name="check" size={14} strokeWidth={2} />}
                  {t(`ui.issue.reasons.${r}`, { defaultValue: r })}
                </button>
              );
            })}
          </div>
        </div>
        <label htmlFor={commentId} className="mt-5 block text-sm font-semibold text-fg">
          {t('ui.issue.comment')}
        </label>
        <Textarea
          id={commentId}
          className="mt-1.5"
          value={comment}
          maxLength={COMMENT_MAX}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t('ui.issue.commentPlaceholder')}
          rows={4}
        />
        <div className="mt-1 text-right font-mono text-xs tabular-nums text-fg-2">
          {comment.length}/{COMMENT_MAX}
        </div>
      </Sheet>
    </>
  );
}
