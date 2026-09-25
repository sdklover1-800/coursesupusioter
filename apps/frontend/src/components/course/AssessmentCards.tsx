import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import type { LearnModuleQuiz, LearnPractical } from '../../lib/learn';
import { routes } from '../../lib/learn';
import { useFormat, formatPercent } from '../../lib/format';
import { Button, Icon, KindIcon, ModeBadge, QuestionGlyph, StatusIcon, buttonClass } from '../ui';
import { humanLeft, practicalMapState, practicalStatus, quizInCooldown, quizStatus } from './labels';
import { useNow } from './useNow';

/** Видимая метка «Далее» рядом с рекомендуемым шагом (цвет + текст, A24). */
export function NextTag({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={clsx('inline-flex items-center gap-1 text-small font-semibold text-spark-ink', className)}>
      <StatusIcon state="NEXT" size={14} />
      {t('course.next')}
    </span>
  );
}

/**
 * Карточка модульного теста (оценивание, USER_DECISIONS §1): ink-контур, ◆ и плашка
 * «Оценивание»; мета «N вопросов · порог 70% (5 из 6) · осталось 2 попытки · засчитывается
 * лучшая»; статус с глифом; во время паузы — «Следующая попытка через …» и неактивная кнопка.
 * После сдачи новой попытки нет — только результаты. «Тренировка по модулю» — пунктиром.
 */
export function ModuleQuizCard({
  quiz, roman, courseId, enrollmentId, isNext, headingLevel = 4,
}: {
  quiz: LearnModuleQuiz;
  roman: string;
  courseId: string;
  enrollmentId: string;
  isNext?: boolean;
  headingLevel?: 3 | 4;
}) {
  const { t } = useTranslation();
  const { lng } = useFormat();
  const now = useNow(!!quiz.cooldownUntil && !quiz.passed, 15_000);
  const cooldown = quizInCooldown(quiz, now);
  const status = quizStatus(t, quiz);
  const H = headingLevel === 3 ? 'h3' : 'h4';
  const closed = quiz.passed || quiz.finalReached;
  const meta = [
    t('course.count.questions', { count: quiz.questionCount }),
    t('course.quiz.threshold', { percent: formatPercent(quiz.passThreshold), pass: quiz.passCount, total: quiz.questionCount }),
    closed ? null : t('course.quiz.attemptsLeft', { count: quiz.attemptsLeft }),
    t(quiz.scoringRule === 'FIRST' ? 'course.quiz.countsFirst' : 'course.quiz.countsBest'),
  ]
    .filter(Boolean)
    .join(' · ');
  const left = cooldown && quiz.cooldownUntil ? humanLeft(new Date(quiz.cooldownUntil).getTime() - now, lng) : null;
  const lobby = routes.quiz(courseId, enrollmentId, quiz.id);
  const cooldownId = `cooldown-${quiz.id}`;

  return (
    <div
      id={`item-${quiz.id}`}
      className={clsx(
        'scroll-mt-24 rounded-xl border-2 border-ink/80 bg-card p-4 sm:p-5 dark:border-border-strong',
        isNext && 'ring-2 ring-spark-ink/70 ring-offset-2 ring-offset-card',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <KindIcon kind="MODULE_QUIZ" size={28} done={quiz.passed} />
        <H className="text-title">
          {t('course.quiz.title')} {roman}
        </H>
        <ModeBadge mode="graded" />
        {isNext && <NextTag />}
      </div>
      <p className="mt-2 text-meta text-fg-2">{meta}</p>
      <StatusIcon state={status.state} size={18} withLabel label={status.text} className="mt-2" />
      {cooldown && (
        <p id={cooldownId} role="timer" className="mt-2 flex items-center gap-2 text-meta font-medium text-fg">
          <Icon name="clock" size={16} className="text-fg-2" />
          {left ? t('course.quiz.cooldown', { time: left }) : t('course.quiz.cooldownSoon')}
        </p>
      )}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {closed ? (
          <Link to={lobby} className={buttonClass('secondary', 'md')}>
            {t('course.quiz.ctaResults')}
          </Link>
        ) : quiz.inProgressAttemptId ? (
          <Link to={lobby} className={buttonClass('primary', 'md')}>
            {t('course.quiz.ctaResume')}
          </Link>
        ) : cooldown ? (
          <Button
            disabled
            aria-describedby={cooldownId}
            className="disabled:!bg-border disabled:!text-fg-2 disabled:!opacity-100 disabled:!shadow-none"
          >
            {t('course.quiz.cta')}
          </Button>
        ) : (
          <Link to={lobby} className={buttonClass('primary', 'md')}>
            {t('course.quiz.cta')}
          </Link>
        )}
        <Link
          to={routes.quiz(courseId, enrollmentId, quiz.id, { mode: 'practice' })}
          className={buttonClass('ghost', 'md', 'border border-dashed border-brand/50 text-brand hover:bg-brand-soft/60')}
        >
          <Icon name="refresh" size={16} />
          {t('course.quiz.practice')}
        </Link>
      </div>
    </div>
  );
}

/**
 * Карточка итогового практикума (USER_DECISIONS §4): амбер-кромка, «?», мета
 * «≈ 25 мин · до 24 ответов тьютора · охватывает модули I–IV», статус
 * «Попытка k из 2 · осталось N ответов» / «Сдан» / «Не сдан · …»; после сдачи — только разбор.
 * Единственная блокировка — окно доступности (lock): «Откроется {дата}» / «Закрыто {дата}».
 */
export function PracticalCard({
  task, courseId, enrollmentId, isNext, coversRange, coversCourse, headingLevel = 4,
}: {
  task: LearnPractical;
  courseId: string;
  enrollmentId: string;
  isNext?: boolean;
  coversRange?: string;
  coversCourse?: boolean;
  headingLevel?: 3 | 4;
}) {
  const { t } = useTranslation();
  const { formatDate } = useFormat();
  const st = practicalMapState(task);
  const status = practicalStatus(t, task);
  const H = headingLevel === 3 ? 'h3' : 'h4';
  const locked = st === 'LOCKED';
  const href = routes.practical(courseId, enrollmentId, task.id);
  const meta = [
    t('course.practical.subtitle'),
    task.estimatedMinutes ? t('course.practical.minutes', { count: task.estimatedMinutes }) : null,
    t('course.practical.answers', { count: task.maxAiMessages }),
    coversCourse ? (coversRange ? t('course.practical.covers', { range: coversRange }) : t('course.practical.coversCourse')) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const lockText = !task.lock
    ? null
    : task.lock.code === 'NOT_YET_AVAILABLE'
      ? t('course.practical.opensOn', { date: formatDate(task.lock.until ?? task.availableFrom) })
      : task.availableUntil
        ? t('course.practical.closedOn', { date: formatDate(task.availableUntil) })
        : t('course.practical.closed');

  const cta =
    st === 'IN_PROGRESS'
      ? { label: t('course.practical.cta.continue'), variant: 'spark' as const }
      : st === 'PASSED' || st === 'FAILED'
        ? { label: t('course.practical.cta.review'), variant: 'secondary' as const }
        : st === 'ATTEMPTED'
          ? { label: t('course.practical.cta.startN', { n: Math.min(task.maxSessions || 2, (task.sessionsUsed ?? 0) + 1) }), variant: 'spark' as const }
          : { label: t('course.practical.cta.start'), variant: 'spark' as const };

  return (
    <div
      id={`item-${task.id}`}
      className={clsx(
        'scroll-mt-24 rounded-xl border border-l-[3px] p-4 sm:p-5',
        locked ? 'border-border border-l-border-strong bg-surface-2' : 'border-border border-l-spark bg-card',
        isNext && 'ring-2 ring-spark-ink/70 ring-offset-2 ring-offset-card',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {locked ? (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-dashed border-border-strong text-fg-2" aria-hidden>
            <Icon name="lock" size={16} />
          </span>
        ) : (
          <QuestionGlyph size={32} />
        )}
        <H className={clsx('text-title', locked && 'text-fg-2')}>{t('course.practical.title')}</H>
        <ModeBadge mode="graded" />
        {isNext && <NextTag />}
      </div>
      <p className="mt-2 text-meta text-fg-2">{meta}</p>
      {task.scenarioTeaser && !locked && <p className="mt-2 line-clamp-2 max-w-[62ch] text-meta text-fg">{task.scenarioTeaser}</p>}
      {locked ? (
        <StatusIcon state="LOCKED" size={18} withLabel label={lockText ?? ''} className="mt-2" />
      ) : (
        <StatusIcon state={status.state} size={18} withLabel label={status.text} className="mt-2" />
      )}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {locked ? (
          <Button disabled className="disabled:!bg-border disabled:!text-fg-2 disabled:!opacity-100 disabled:!shadow-none">
            {t('course.practical.cta.start')}
          </Button>
        ) : (
          <Link to={href} className={buttonClass(cta.variant, 'md')}>
            {cta.label}
          </Link>
        )}
      </div>
    </div>
  );
}
