import { clsx } from 'clsx';
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PracticalSessionsView, SessionDetail, VerdictCode } from '../../lib/practical';
import { attemptNumber, verdictPassed } from '../../lib/practical';
import { routes } from '../../lib/learn';
import { useFormat } from '../../lib/format';
import { Button, buttonClass, RubricBars, SegmentedControl, Skeleton, Spinner } from '../ui';
import { Icon, type IconName } from '../icons';
import { PhaseStepper } from './PhaseStepper';
import { DialogueReview } from './DialogueReview';

/** «Искра» из 12 частиц — только сданный практикум (design_direction §6); без движения — не видна. */
function SparkBurst() {
  const particles = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const r = 58 + (i % 3) * 10;
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

/** Глиф исхода: цвет всегда вместе с формой и текстом заголовка (WCAG 1.4.1). */
const OUTCOME_GLYPH: Record<VerdictCode, { icon: IconName; cls: string }> = {
  PASSED: { icon: 'check', cls: 'bg-teal/12 text-teal-ink' },
  FAILED_LIMIT: { icon: 'x', cls: 'bg-danger/8 text-danger-ink ring-1 ring-inset ring-danger/30' },
  ENDED_BY_STUDENT: { icon: 'x', cls: 'bg-danger/8 text-danger-ink ring-1 ring-inset ring-danger/30' },
  FAILED_CEILING: { icon: 'alert', cls: 'bg-surface-2 text-fg-2 ring-1 ring-inset ring-border-strong' },
  ABANDONED: { icon: 'clock', cls: 'bg-surface-2 text-fg-2 ring-1 ring-inset ring-border-strong' },
};

function ListCard({ title, icon, iconCls, children }: { title: string; icon: IconName; iconCls: string; children: ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      <h3 className="mb-3 flex items-center gap-2 text-title text-fg">
        <Icon name={icon} size={20} strokeWidth={2} className={iconCls} />
        {title}
      </h3>
      {children}
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  const { t } = useTranslation();
  if (!items.length) return <p className="text-body text-fg-2">{t('practical.verdict.none')}</p>;
  return (
    <ul className="space-y-2">
      {items.map((s, i) => (
        <li key={i} className="flex gap-2.5 text-body leading-relaxed text-fg">
          <span className="mt-[0.6rem] h-1.5 w-1.5 shrink-0 rounded-full bg-fg-2" aria-hidden />
          <span className="min-w-0">{s}</span>
        </li>
      ))}
    </ul>
  );
}

function SkeletonLines() {
  return (
    <div className="space-y-2.5" aria-hidden>
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-9/12" />
      <Skeleton className="h-4 w-10/12" />
    </div>
  );
}

/**
 * Итог сессии (screen_specs «verdict and dialogue review»): заголовок и причина — ТОЛЬКО по
 * локализованному verdictCode (сырой verdictReason не показываем никогда); рубрика «x.x / 3»
 * со строками пояснения; «Сильные стороны» и «Что развивать» (последнее — только когда
 * toDevelop ≠ null, иначе строка A6); пока отзыв готовится (PENDING) — скелетоны и опрос
 * страницей раз в 3 с до 60 с. «Новая попытка» — только если canStart, иначе «К курсу».
 */
export function VerdictView({
  view, detail, loading, pollExpired, review, courseId, enrollmentId, onSelectSession, onOpenReview, onCloseReview, onNewAttempt,
}: {
  view: PracticalSessionsView;
  detail: SessionDetail | undefined;
  loading: boolean;
  pollExpired: boolean;
  review: boolean;
  courseId: string;
  enrollmentId: string;
  onSelectSession: (id: string) => void;
  onOpenReview: () => void;
  onCloseReview: () => void;
  onNewAttempt: () => void;
}) {
  const { t } = useTranslation();
  const { formatDate } = useFormat();
  const finished = view.items.filter((s) => s.status !== 'IN_PROGRESS');
  const session = detail?.session;
  const evaluation = detail?.evaluation ?? null;
  const code: VerdictCode = session?.verdictCode ?? (session?.status === 'PASSED' ? 'PASSED' : session?.status === 'ABANDONED' ? 'ABANDONED' : 'FAILED_LIMIT');
  const passed = session ? verdictPassed(session.verdictCode, session.status) : false;
  const glyph = OUTCOME_GLYPH[code];
  const pending = session?.summaryStatus === 'PENDING' && !pollExpired;
  const summaryFailed = session?.summaryStatus === 'FAILED' || (session?.summaryStatus === 'PENDING' && pollExpired);
  const ready = session?.summaryStatus === 'READY';
  const k = session ? attemptNumber(view, session.id) : 1;
  const attemptsLeft = Math.max(0, view.maxSessions - view.sessionsUsed);

  if (loading || !detail || !session) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (review && evaluation?.highlights) {
    return (
      <div className="space-y-6">
        <PhaseStepper current={3} />
        <DialogueReview detail={detail} highlights={evaluation.highlights} enrollmentId={enrollmentId} onBack={onCloseReview} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PhaseStepper current={2} />
        {finished.length > 1 && (
          <SegmentedControl
            ariaLabel={t('practical.verdict.sessionsLabel')}
            size="sm"
            tone="brand"
            value={session.id}
            onChange={onSelectSession}
            options={finished.map((s, i) => ({ value: s.id, label: t('practical.verdict.attemptN', { n: i + 1 }) }))}
          />
        )}
      </div>

      {/* Исход */}
      <section className="card relative overflow-hidden p-5 sm:p-7" aria-labelledby="verdict-headline">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
          <div className="relative grid h-16 w-16 shrink-0 place-items-center">
            {passed && <SparkBurst />}
            <span className={clsx('grid h-16 w-16 place-items-center rounded-full', glyph.cls)}>
              <Icon name={glyph.icon} size={30} strokeWidth={2.25} />
            </span>
          </div>
          <div className="min-w-0">
            <div className="text-label text-fg-2">
              {t('practical.attempt', { k, max: view.maxSessions })}
              {session.endedAt && <> · {formatDate(session.endedAt)}</>}
            </div>
            <h1 id="verdict-headline" className={clsx('mt-1 text-display-lg', passed ? 'text-teal-ink' : 'text-fg')}>
              {t(`practical.verdict.headline.${code}`)}
            </h1>
            <p className="mt-2 max-w-[62ch] text-body-lg text-fg-2">{t(`practical.verdict.reason.${code}`)}</p>
          </div>
        </div>
      </section>

      {/* Рубрика */}
      {evaluation && (
        <section className="card p-5 sm:p-6" aria-labelledby="verdict-rubric">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="verdict-rubric" className="font-sans text-title text-fg">
              {t('practical.verdict.rubricTitle')}
            </h2>
            <span className="inline-flex items-center gap-1.5 text-small text-fg-2" title={t('practical.verdict.scaleLabel')}>
              <Icon name="info" size={16} />
              <span className="sr-only">{t('practical.verdict.scaleLabel')}: </span>
              {t('practical.verdict.scale')}
            </span>
          </div>
          <RubricBars scores={evaluation.criteria} />
          {pending && (
            <p role="status" className="mt-4 flex items-center gap-2 text-small text-fg-2">
              <Spinner className="h-4 w-4" />
              {t('practical.verdict.pending')}
            </p>
          )}
          {summaryFailed && <p className="mt-4 text-small text-fg-2">{t('practical.verdict.failedSummary')}</p>}
        </section>
      )}

      {/* Сильные стороны / Что развивать */}
      {evaluation && (pending || ready) && (
        <div className="grid gap-4 md:grid-cols-2">
          <ListCard title={t('practical.verdict.strengths')} icon="check" iconCls="text-teal-ink">
            {pending ? <SkeletonLines /> : <Bullets items={evaluation.strengths} />}
          </ListCard>
          {evaluation.toDevelop !== null ? (
            <ListCard title={t('practical.verdict.toDevelop')} icon="arrow-right" iconCls="-rotate-45 text-fg-2">
              {pending ? <SkeletonLines /> : <Bullets items={evaluation.toDevelop} />}
            </ListCard>
          ) : (
            <section className="flex items-start gap-3 rounded-2xl border border-dashed border-border-strong bg-surface-2/60 p-5 sm:p-6">
              <Icon name="lock" size={20} className="mt-0.5 text-fg-2" />
              <p className="text-body text-fg-2">{t('practical.verdict.detailsLater')}</p>
            </section>
          )}
        </div>
      )}

      {/* Действия */}
      <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {evaluation?.highlights && detail.messages.length > 0 && (
            <Button variant="secondary" onClick={onOpenReview}>
              <Icon name="message" size={18} />
              {t('practical.verdict.review')}
            </Button>
          )}
          {view.canStart && <span className="text-body text-fg-2 sm:ml-2">{t('practical.verdict.attemptsLeft', { count: attemptsLeft })}</span>}
        </div>
        {view.canStart ? (
          <Button onClick={onNewAttempt}>
            <Icon name="refresh" size={18} />
            {t('practical.verdict.newAttempt')}
          </Button>
        ) : (
          <Link to={routes.course(courseId, enrollmentId, { hash: `item-${view.brief.id}` })} className={buttonClass('primary', 'md')}>
            {t('practical.verdict.toCourse')}
            <Icon name="arrow-right" size={18} />
          </Link>
        )}
      </div>
    </div>
  );
}
