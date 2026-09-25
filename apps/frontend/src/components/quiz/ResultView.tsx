import { clsx } from 'clsx';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { AttemptResult, QuizLobby } from '@edu/shared';
import { routes } from '../../lib/learn';
import { formatPercent } from '../../lib/format';
import { quizRoutes } from '../../lib/quiz';
import { buttonClass, ProgressRing, Tabs } from '../ui';
import { Icon } from '../icons';
import { CooldownCountdown } from './CooldownCountdown';
import { CorrectnessList } from './CorrectnessList';
import { ReviewItem } from './ReviewItem';

/** «11 мин» / «1 ч 5 мин» / «< 1 мин» (точная длительность попытки, без «≈»). */
export function useDurationLabel() {
  const { t } = useTranslation();
  return (sec: number | null | undefined): string => {
    if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
    if (sec < 60) return t('quiz.unit.lessMinute');
    const min = Math.round(sec / 60);
    if (min < 60) return t('quiz.unit.minutes', { count: min });
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? t('quiz.unit.hoursMinutes', { h, m }) : t('quiz.unit.hours', { count: h });
  };
}

/** «Искра» из 12 частиц — только сданный модуль (design_direction §6); без движения — невидима. */
function SparkBurst() {
  const particles = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const r = 78 + (i % 3) * 10;
        return { dx: `${Math.round(Math.cos(a) * r)}px`, dy: `${Math.round(Math.sin(a) * r)}px`, delay: `${(i % 4) * 30}ms` };
      }),
    [],
  );
  return (
    <span className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
      {particles.map((p, i) => (
        <span
          key={i}
          className={clsx('absolute h-2 w-2 animate-spark-burst rounded-full opacity-0', i % 2 ? 'bg-spark' : 'bg-teal')}
          style={{ '--dx': p.dx, '--dy': p.dy, animationDelay: p.delay } as CSSProperties}
        />
      ))}
    </span>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-fg-2">{label}</dt>
      <dd className="mt-0.5 text-body font-medium text-fg">{children}</dd>
    </div>
  );
}

/**
 * Результат попытки (FE3 §7): сначала сводка (кольцо, сдано/не сдано к порогу, верно/неверно,
 * таблица, пересдача или пауза), затем разбор уровня, который отдал СЕРВЕР:
 * CORRECTNESS — только ✓/✗ по формулировкам; FULL — варианты, ключ, обоснования, источник;
 * SCORE — только балл и пояснение политики.
 */
export function ResultView({
  result, lobby, courseId, enrollmentId, quizId, moduleNumeral, lectureTitles, onCooldownElapsed,
}: {
  result: AttemptResult;
  lobby?: QuizLobby;
  courseId: string;
  enrollmentId: string;
  quizId: string;
  /** Римский номер модуля для заголовка «Модуль II пройден» */
  moduleNumeral?: string | null;
  /** Названия лекций по id (карточка «Следующий шаг», если в источнике нет названия) */
  lectureTitles?: Record<string, string>;
  onCooldownElapsed?: () => void;
}) {
  const { t } = useTranslation();
  const durationLabel = useDurationLabel();
  const [filter, setFilter] = useState<'all' | 'mistakes'>('all');
  const { attempt, reviewLevel } = result;
  const wrong = Math.max(0, attempt.total - attempt.correctCount);
  const threshold = lobby?.passThreshold ?? null;
  const maxAttempts = lobby?.maxAttempts ?? null;
  const cooldownActive = !!result.cooldownUntil && new Date(result.cooldownUntil).getTime() > Date.now();
  const canRetake = !result.passed && result.attemptsLeft > 0;

  const headline = attempt.passed
    ? moduleNumeral
      ? t('quiz.outcome.headlinePassed', { n: moduleNumeral })
      : t('quiz.outcome.headlinePassedPlain')
    : result.finalReached && !result.passed
      ? t('quiz.outcome.headlineExhausted')
      : reviewLevel === 'FULL'
        ? t('quiz.outcome.headlineFailed')
        : t('quiz.outcome.headlineFailedCorrectness');

  const review = useMemo(() => [...result.review].sort((a, b) => a.position - b.position), [result.review]);
  const mistakes = review.filter((r) => !r.isCorrect);

  // «Следующий шаг» (только FULL): лекция, к которой относится больше всего ошибок
  const nextStep = useMemo(() => {
    if (reviewLevel !== 'FULL') return null;
    const counts = new Map<string, { n: number; lectureNumber: number | null; title: string }>();
    for (const r of review) {
      if (r.isCorrect || !r.source) continue;
      const cur = counts.get(r.source.lectureId) ?? { n: 0, lectureNumber: r.source.lectureNumber, title: (r.source.title || lectureTitles?.[r.source.lectureId] || '').replace(/^\d+\.\s*/, '') };
      cur.n += 1;
      counts.set(r.source.lectureId, cur);
    }
    let best: { id: string; n: number; lectureNumber: number | null; title: string } | null = null;
    for (const [id, v] of counts) if (!best || v.n > best.n) best = { id, ...v };
    return best;
  }, [review, reviewLevel, lectureTitles]);

  const visible = filter === 'mistakes' ? mistakes : review;
  const jumpTo = (n: number) => {
    const el = document.getElementById(`q-${n}`);
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  };

  return (
    <div className="space-y-8" data-result-level={reviewLevel}>
      {/* ── Сводка ── */}
      <section aria-labelledby="result-headline" className="card relative overflow-hidden p-5 sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-8">
          <div className="relative mx-auto shrink-0 sm:mx-0">
            <ProgressRing
              value={attempt.score}
              size={136}
              stroke={10}
              tone={attempt.passed ? 'teal' : 'brand'}
              label={t('quiz.outcome.scoreLabel', { percent: formatPercent(attempt.score) })}
            >
              <span className="font-display text-[2.5rem] font-bold leading-none tracking-tight tabular-nums text-fg">{formatPercent(attempt.score)}</span>
            </ProgressRing>
            {attempt.passed && <SparkBurst />}
          </div>
          <div className="min-w-0 flex-1">
            <h1 id="result-headline" className="font-display text-display-lg text-fg">
              {headline}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-label font-semibold',
                  attempt.passed ? 'bg-teal/12 text-teal-ink' : 'bg-danger/12 text-danger-ink',
                )}
              >
                <Icon name={attempt.passed ? 'check' : 'x'} size={15} strokeWidth={2.5} />
                {attempt.passed ? t('quiz.outcome.passedBadge') : t('quiz.outcome.failedBadge')}
              </span>
              {threshold !== null && <span className="text-label text-fg-2">{t('quiz.outcome.threshold', { percent: formatPercent(threshold) })}</span>}
            </div>
            <p className="mt-3 text-body font-medium text-fg">{t('quiz.outcome.correctWrong', { correct: attempt.correctCount, wrong })}</p>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-5 sm:grid-cols-4">
          <Fact label={t('quiz.outcome.table.status')}>
            {attempt.passed ? t('quiz.outcome.passedBadge') : t('quiz.outcome.failedBadge')}
            {attempt.counted && <span className="block text-sm font-normal text-fg-2">{t('quiz.outcome.counted')}</span>}
          </Fact>
          <Fact label={t('quiz.outcome.table.duration')}>
            <span>{durationLabel(attempt.durationSec)}</span>
            {attempt.autoSubmitted && <span className="block text-sm font-normal text-fg-2">{t('quiz.outcome.autoSubmitted')}</span>}
          </Fact>
          <Fact label={t('quiz.outcome.table.result')}>
            <span className="num text-body">
              {attempt.correctCount}/{attempt.total} · {formatPercent(attempt.score)}
            </span>
          </Fact>
          <Fact label={t('quiz.outcome.table.attempt')}>
            <span>
              {maxAttempts ? t('quiz.outcome.table.attemptValue', { n: attempt.attemptNumber, max: maxAttempts }) : attempt.attemptNumber}
            </span>
          </Fact>
        </dl>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {canRetake && cooldownActive && result.cooldownUntil && (
            <p className="text-body text-fg-2 sm:mr-auto">
              {t('quiz.outcome.nextAttemptIn')} <CooldownCountdown until={result.cooldownUntil} onElapsed={onCooldownElapsed} className="text-fg" />
              <span className="block text-sm">{t('quiz.outcome.attemptsLeft', { n: result.attemptsLeft })}</span>
            </p>
          )}
          {canRetake && !cooldownActive && <p className="text-body text-fg-2 sm:mr-auto">{t('quiz.outcome.attemptsLeft', { n: result.attemptsLeft })}</p>}
          {!canRetake && <span className="hidden sm:mr-auto sm:block" />}
          <Link to={routes.course(courseId, enrollmentId)} className={buttonClass('ghost', 'md', 'w-full sm:w-auto')}>
            {t('quiz.outcome.toCourse')}
          </Link>
          {canRetake && !cooldownActive ? (
            <Link to={quizRoutes.lobby(courseId, enrollmentId, quizId)} className={buttonClass('primary', 'md', 'w-full sm:w-auto sm:min-w-[160px]')}>
              {t('quiz.outcome.retake')}
            </Link>
          ) : (
            <Link to={quizRoutes.lobby(courseId, enrollmentId, quizId)} className={buttonClass('secondary', 'md', 'w-full sm:w-auto')}>
              {t('quiz.outcome.toLobby')}
            </Link>
          )}
        </div>
      </section>

      {/* ── Разбор по уровню ── */}
      <section aria-labelledby="review-heading">
        <h2 id="review-heading" className="mb-3 font-display text-display-md">
          {t('quiz.review.title')}
        </h2>

        {reviewLevel === 'CORRECTNESS' && <CorrectnessList items={review} />}

        {reviewLevel === 'SCORE' && (
          <p className="flex items-start gap-2.5 rounded-xl bg-surface-2 px-4 py-3 text-body text-fg-2">
            <Icon name="lock" size={18} className="mt-0.5 shrink-0" />
            {result.reviewPolicy === 'SCORE_ONLY' ? t('quiz.review.scoreOnlyNotice') : t('quiz.review.scoreNotice')}
          </p>
        )}

        {reviewLevel === 'FULL' && (
          <div data-review-level="FULL">
            {/* Липкая панель: фильтр + быстрые переходы */}
            <div className="sticky top-[calc(52px+env(safe-area-inset-top,0px))] z-20 -mx-4 bg-surface/95 px-4 pb-2 backdrop-blur sm:-mx-6 sm:px-6 lg:top-14 lg:-mx-8 lg:px-8">
              <Tabs<'all' | 'mistakes'>
                ariaLabel={t('quiz.review.filterLabel')}
                value={filter}
                onChange={setFilter}
                idPrefix="review-filter"
                tabs={[
                  { id: 'all', label: t('quiz.review.all'), badge: review.length },
                  { id: 'mistakes', label: t('quiz.review.mistakes'), badge: mistakes.length },
                ]}
              />
              <nav aria-label={t('quiz.review.jumpLabel')} className="mt-2">
                <ol className="flex gap-1.5 overflow-x-auto py-1">
                  {review.map((r, i) => (
                    <li key={r.questionId} className="shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          if (filter === 'mistakes' && r.isCorrect) setFilter('all');
                          window.setTimeout(() => jumpTo(i + 1), 0);
                        }}
                        aria-label={t('quiz.review.jumpItem', { n: i + 1, state: r.isCorrect ? t('quiz.review.itemCorrect') : t('quiz.review.itemWrong') })}
                        className={clsx(
                          'inline-flex h-8 items-center gap-1 rounded-lg px-2 font-mono text-sm font-semibold tabular-nums transition-colors',
                          r.isCorrect ? 'bg-teal/12 text-teal-ink' : 'bg-danger/12 text-danger-ink',
                        )}
                      >
                        <Icon name={r.isCorrect ? 'check' : 'x'} size={13} strokeWidth={2.75} />
                        {i + 1}
                      </button>
                    </li>
                  ))}
                </ol>
              </nav>
            </div>

            <div role="tabpanel" id={`review-filter-panel-${filter}`} aria-labelledby={`review-filter-tab-${filter}`} className="mt-4 space-y-4">
              {visible.length === 0 && <p className="card p-5 text-body text-fg-2">{t('quiz.review.noMistakes')}</p>}
              {visible.map((r) => (
                <ReviewItem key={r.questionId} item={r} index={review.indexOf(r) + 1} courseId={courseId} enrollmentId={enrollmentId} />
              ))}
            </div>

            {nextStep && (
              <aside className="card mt-6 flex flex-col gap-3 border-l-4 border-l-spark-ink p-5 sm:flex-row sm:items-center sm:p-6">
                <div className="min-w-0 flex-1">
                  <div className="text-label text-fg-2">{t('quiz.review.nextStep')}</div>
                  <p className="mt-1 text-body text-fg">
                    {t('quiz.review.nextStepBody', { n: nextStep.lectureNumber ?? '', title: nextStep.title })}
                  </p>
                </div>
                <Link to={routes.lecture(courseId, enrollmentId, nextStep.id)} className={buttonClass('secondary', 'md', 'w-full shrink-0 sm:w-auto')}>
                  <Icon name="play" size={14} fill="currentColor" />
                  {t('quiz.review.openLecture')}
                </Link>
              </aside>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
