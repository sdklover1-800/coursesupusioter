import { useTranslation } from 'react-i18next';
import { Icon } from '../icons';

export interface SubmitReviewQuestion {
  id: string;
  prompt: string;
  answered: boolean;
  flagged: boolean;
}

/**
 * «Проверьте перед отправкой» (Moodle «Summary of attempt», FE3 §6): сводка «Отвечено 7 из 8 ·
 * отмечено 1» и чипы вопросов без ответа и отмеченных — переход к вопросу. Никаких
 * отметок правильности: только отвечен / без ответа / отмечен. Кнопки и подтверждение —
 * в подвале раннера (ConfirmDialog, без native confirm()).
 */
export function SubmitReview({ questions, onJump }: { questions: SubmitReviewQuestion[]; onJump: (index: number) => void }) {
  const { t } = useTranslation();
  const answered = questions.filter((q) => q.answered).length;
  const flaggedCount = questions.filter((q) => q.flagged).length;
  const unanswered = questions.map((q, i) => ({ q, i })).filter((x) => !x.q.answered);
  const flagged = questions.map((q, i) => ({ q, i })).filter((x) => x.q.flagged);

  const chip = (i: number, withFlag: boolean) => (
    <li key={`${withFlag ? 'f' : 'u'}-${i}`}>
      <button
        type="button"
        onClick={() => onJump(i)}
        aria-label={t('quiz.runner.navItem', { n: i + 1 })}
        className="relative inline-flex h-10 min-w-[2.5rem] items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-card px-3 font-mono text-sm font-semibold tabular-nums text-fg transition-colors hover:border-brand/60 hover:bg-brand-soft/40"
      >
        {withFlag && <Icon name="flag" size={14} className="text-brand" />}
        {i + 1}
      </button>
    </li>
  );

  return (
    <div data-quiz-submit-review>
      <h2 className="font-display text-display-lg text-fg">{t('quiz.submit.title')}</h2>
      <p className="mt-2 text-body-lg text-fg">{t('quiz.submit.summary', { answered, total: questions.length, flagged: flaggedCount })}</p>

      {unanswered.length === 0 ? (
        <p className="mt-5 text-body text-fg-2">{t('quiz.submit.allAnswered')}</p>
      ) : (
        <section className="mt-6">
          <h3 className="text-label text-fg-2">{t('quiz.submit.unanswered')}</h3>
          <ul className="mt-2 flex flex-wrap gap-2">{unanswered.map((x) => chip(x.i, false))}</ul>
        </section>
      )}
      {flagged.length > 0 && (
        <section className="mt-6">
          <h3 className="text-label text-fg-2">{t('quiz.submit.flagged')}</h3>
          <ul className="mt-2 flex flex-wrap gap-2">{flagged.map((x) => chip(x.i, true))}</ul>
        </section>
      )}

      {/* Все вопросы попытки — нейтральный список (отвечен / без ответа) */}
      <ol className="mt-8 divide-y divide-border rounded-xl border border-border bg-card">
        {questions.map((q, i) => (
          <li key={q.id}>
            <button type="button" onClick={() => onJump(i)} className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-brand-soft/30">
              <span className="num mt-0.5 w-6 shrink-0 text-fg-2">{i + 1}</span>
              <span className="line-clamp-2 min-w-0 flex-1 text-body text-fg">{q.prompt}</span>
              <span className="mt-0.5 flex shrink-0 items-center gap-2 text-sm text-fg-2">
                {q.flagged && <Icon name="flag" size={14} className="text-brand" label={t('quiz.runner.navFlagged')} />}
                <span className="inline-block first-letter:uppercase">{q.answered ? t('quiz.runner.navAnswered') : t('quiz.runner.navUnanswered')}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
