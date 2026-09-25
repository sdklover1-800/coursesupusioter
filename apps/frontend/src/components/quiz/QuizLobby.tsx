import { clsx } from 'clsx';
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { QuizLobby as QuizLobbyData } from '@edu/shared';
import { formatPercent, useFormat } from '../../lib/format';
import { countedAttempt, estimatedMinutes, quizRoutes } from '../../lib/quiz';
import { Button, buttonClass, StatusIcon } from '../ui';
import { Icon } from '../icons';
import { CooldownCountdown } from './CooldownCountdown';
import { useDurationLabel } from './ResultView';

/** Длительность паузы «24 ч» / «90 мин» / «1 ч 30 мин» — из cooldownMinutes. */
function useCooldownLabel() {
  const { t } = useTranslation();
  return (minutes: number) => {
    if (minutes < 60) return t('quiz.unit.minutes', { count: minutes });
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? t('quiz.unit.hoursMinutes', { h, m }) : t('quiz.unit.hours', { count: h });
  };
}

function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={clsx('min-w-0', wide && 'col-span-2 sm:col-span-1')}>
      <dt className="text-label text-fg-2">{label}</dt>
      <dd className="mt-0.5 text-body-lg font-semibold text-white">{children}</dd>
    </div>
  );
}

/**
 * Лобби модульного теста (FE3 §5, screen_specs «Module quiz lobby»): ink-панель с фактами
 * (вопросы, ≈ время, порог, попытка k из max, что засчитывается, живой отсчёт паузы),
 * правила показа разбора, флажок честной сдачи (integrityAck) и кнопка старта; ниже —
 * история попыток и пунктирная ссылка на тренировку. Финальное состояние — засчитанный
 * результат, полный разбор и тренировка на вопросах теста. Никаких туров, модалок и ИИ.
 */
export function QuizLobby({
  lobby, courseId, enrollmentId, moduleNumeral, moduleTitle, starting, ackError, onStart, onResume, onCooldownElapsed,
}: {
  lobby: QuizLobbyData;
  courseId: string;
  enrollmentId: string;
  moduleNumeral: string | null;
  moduleTitle?: string | null;
  starting: boolean;
  /** 422 INTEGRITY_ACK_REQUIRED — подсказка под флажком */
  ackError?: boolean;
  onStart: (integrityAck: boolean) => void;
  onResume: (attemptId: string) => void;
  onCooldownElapsed: () => void;
}) {
  const { t } = useTranslation();
  const f = useFormat();
  const durationLabel = useDurationLabel();
  const cooldownLabel = useCooldownLabel();
  const ackId = useId();
  const [ack, setAck] = useState(false);

  const final = lobby.finalReached;
  const inProgress = lobby.inProgressAttempt;
  const cooldownUntil = lobby.cooldownUntil && new Date(lobby.cooldownUntil).getTime() > Date.now() ? lobby.cooldownUntil : null;
  const attemptN = final || inProgress ? lobby.attemptsUsed : Math.min(lobby.maxAttempts, lobby.attemptsUsed + 1);
  const counted = countedAttempt(lobby.history);
  const countedScore = lobby.countedScore ?? counted?.score ?? null;
  const history = [...lobby.history].sort((a, b) => a.attemptNumber - b.attemptNumber);
  const eyebrow = moduleNumeral ? t('quiz.moduleEyebrow', { n: moduleNumeral }) : t('ui.mode.graded');

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-8">
      {/* ── Панель (ink): факты, правила, старт ── */}
      <section aria-labelledby="lobby-title" className="relative overflow-hidden rounded-2xl bg-ink text-white shadow-soft">
        <div className="bg-inquiry-grid pointer-events-none absolute inset-0 opacity-[0.12]" aria-hidden />
        <div data-theme="dark" className="relative p-5 text-fg sm:p-8">
          <div className="eyebrow inline-flex items-center gap-2">
            <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden className="shrink-0 text-white">
              <path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" fill="currentColor" />
            </svg>
            {eyebrow}
          </div>
          <h1 id="lobby-title" className="mt-2 font-display text-display-lg text-white">
            {t('quiz.moduleTest')}
          </h1>
          <p className="mt-1.5 max-w-[62ch] text-body-lg text-fg-2">{moduleTitle || t('quiz.lobby.purpose')}</p>
          {moduleTitle && <p className="mt-1 max-w-[62ch] text-body text-fg-2">{t('quiz.lobby.purpose')}</p>}

          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Fact label={t('quiz.lobby.facts.questions')}>{lobby.questionCount}</Fact>
            <Fact label={t('quiz.lobby.facts.time')}>{t('quiz.lobby.facts.timeValue', { count: estimatedMinutes(lobby.questionCount) })}</Fact>
            <Fact label={t('quiz.lobby.facts.threshold')}>
              {t('quiz.lobby.facts.thresholdValue', { percent: formatPercent(lobby.passThreshold), count: lobby.passCount, total: lobby.questionCount })}
            </Fact>
            <Fact label={t('quiz.lobby.facts.attempt')}>{t('quiz.lobby.facts.attemptValue', { n: attemptN, max: lobby.maxAttempts })}</Fact>
            <Fact label={t('quiz.lobby.facts.scoring')} wide>
              {lobby.scoringRule === 'FIRST' ? t('quiz.lobby.facts.scoringFIRST') : t('quiz.lobby.facts.scoringBEST')}
            </Fact>
            {cooldownUntil && !final && (
              <Fact label={t('quiz.lobby.facts.nextAttempt')} wide>
                <CooldownCountdown until={cooldownUntil} onElapsed={onCooldownElapsed} className="text-body-lg font-semibold text-white" />
              </Fact>
            )}
          </dl>

          {final ? (
            <div className="mt-6 rounded-xl bg-white/10 p-4 sm:p-5" data-lobby-final>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <StatusIcon state={lobby.passed ? 'PASSED' : 'FAILED'} size={22} />
                <span className="text-title text-white">{lobby.passed ? t('quiz.lobby.finalPassed') : t('quiz.lobby.finalFailed')}</span>
              </div>
              {countedScore !== null && (
                <p className="mt-1.5 text-body text-fg-2">
                  {t('quiz.lobby.countedResult')}: <span className="num text-body font-semibold text-white">{formatPercent(countedScore)}</span>
                  {counted && <span> · {t('quiz.lobby.historyNumber', { n: counted.attemptNumber })}</span>}
                </p>
              )}
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {counted && (
                  <Link to={quizRoutes.result(courseId, enrollmentId, lobby.id, counted.id)} className={buttonClass('primary', 'md', '!h-auto min-h-[2.75rem] w-full py-2 text-center sm:w-auto')}>
                    {t('quiz.lobby.fullReview')}
                  </Link>
                )}
                {lobby.practiceAllowed && (
                  <Link
                    to={quizRoutes.practice(courseId, enrollmentId, lobby.id, { graded: true })}
                    className={buttonClass('secondary', 'md', '!h-auto min-h-[2.75rem] w-full border-white/25 bg-transparent py-2 text-center text-white hover:bg-white/10 sm:w-auto')}
                  >
                    <Icon name="refresh" size={16} />
                    {t('quiz.lobby.practiceGraded')}
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Правила: без обратной связи во время попытки; что откроется после */}
              <div className="mt-6 space-y-1.5 rounded-xl bg-white/10 p-4 text-body text-fg sm:p-5">
                <p className="flex items-start gap-2 font-medium">
                  <Icon name="info" size={18} className="mt-0.5 shrink-0 text-fg-2" />
                  <span>{t('quiz.lobby.noFeedback')}</span>
                </p>
                <p className="pl-[26px] text-fg-2">{t(`quiz.lobby.policy.${lobby.reviewPolicy}`)}</p>
                {lobby.maxAttempts > 1 && (
                  <p className="pl-[26px] text-fg-2">
                    {lobby.cooldownMinutes > 0
                      ? t('quiz.lobby.retakeNotice', { time: cooldownLabel(lobby.cooldownMinutes) })
                      : t('quiz.lobby.retakeNoticeNoCooldown')}
                  </p>
                )}
              </div>

              {lobby.questionCount === 0 ? (
                <p className="mt-6 text-body text-fg-2">{t('quiz.lobby.noQuestions')}</p>
              ) : inProgress ? (
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-body text-fg-2">
                    {t('quiz.lobby.inProgress', { n: lobby.attemptsUsed, answered: inProgress.answeredCount, total: lobby.questionCount })}
                  </p>
                  <Button size="lg" className="!h-auto min-h-[3.25rem] w-full py-2.5 sm:w-auto sm:min-w-[200px]" onClick={() => onResume(inProgress.id)}>
                    {t('quiz.lobby.resume')}
                    <Icon name="arrow-right" size={18} />
                  </Button>
                </div>
              ) : cooldownUntil ? (
                <div className="mt-6">
                  <Button size="lg" disabled className="!h-auto min-h-[3.25rem] w-full py-2.5 text-center sm:w-auto" title={f.formatDate(cooldownUntil, 'datetime')}>
                    <Icon name="clock" size={18} />
                    <span>
                      {t('quiz.lobby.facts.nextAttempt')} <CooldownCountdown until={cooldownUntil} onElapsed={onCooldownElapsed} />
                    </span>
                  </Button>
                  <p className="mt-2 text-sm text-fg-2">{t('quiz.lobby.cooldownUntil', { date: f.formatDate(cooldownUntil, 'datetime') })}</p>
                </div>
              ) : (
                <div className="mt-6">
                  <label htmlFor={ackId} className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/15 p-3.5 transition-colors hover:border-white/30">
                    <input
                      id={ackId}
                      type="checkbox"
                      checked={ack}
                      onChange={(e) => setAck(e.target.checked)}
                      aria-describedby={ackError ? `${ackId}-err` : undefined}
                      className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[rgb(var(--brand-fill))]"
                    />
                    <span className="text-body font-medium text-white">{t('quiz.lobby.integrity')}</span>
                  </label>
                  {ackError && !ack && (
                    <p id={`${ackId}-err`} role="alert" className="mt-2 text-sm font-medium text-spark">
                      {t('quiz.lobby.integrityRequired')}
                    </p>
                  )}
                  <Button
                    size="lg"
                    className="mt-4 !h-auto min-h-[3.25rem] w-full py-2.5 sm:w-auto sm:min-w-[200px]"
                    disabled={!ack || !lobby.canStart}
                    loading={starting}
                    onClick={() => onStart(ack)}
                  >
                    {t('quiz.lobby.start')}
                    <Icon name="arrow-right" size={18} />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* ── История попыток ── */}
      {history.length > 0 && (
        <section aria-labelledby="lobby-history">
          <h2 id="lobby-history" className="mb-3 font-sans text-title tracking-normal text-fg">
            {t('quiz.lobby.historyTitle')}
          </h2>
          <ol className="card divide-y divide-border overflow-hidden">
            {history.map((h) => (
              <li key={h.id}>
                <Link
                  to={quizRoutes.result(courseId, enrollmentId, lobby.id, h.id)}
                  className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-brand-soft/30 sm:px-5"
                >
                  <StatusIcon state={h.passed ? 'PASSED' : 'FAILED'} size={20} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-semibold text-fg">
                      {t('quiz.lobby.historyNumber', { n: h.attemptNumber })} · {formatPercent(h.score)}
                    </span>
                    <span className="block text-meta text-fg-2">
                      {durationLabel(h.durationSec)} · {f.formatDate(h.submittedAt ?? h.startedAt)}
                      {h.counted && ` · ${t('quiz.lobby.counted')}`}
                      {h.autoSubmitted && ` · ${t('quiz.lobby.autoSubmitted')}`}
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-body font-semibold text-brand">
                    {t('quiz.lobby.reviewLink')}
                    <Icon name="chevron-right" size={16} />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ── Тренировка по модулю: не влияет на результат ── */}
      {lobby.moduleId && (
        <Link
          to={quizRoutes.practice(courseId, enrollmentId, lobby.id)}
          className="flex min-h-[3.25rem] w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand/40 bg-brand-soft/40 px-4 py-3 text-center text-body font-semibold text-brand transition-colors hover:border-brand/70 hover:bg-brand-soft"
        >
          <Icon name="refresh" size={18} className="shrink-0" />
          {t('quiz.lobby.practiceLink')}
        </Link>
      )}
    </div>
  );
}
