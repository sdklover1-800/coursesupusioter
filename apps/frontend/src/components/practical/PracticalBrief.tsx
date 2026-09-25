import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { PracticalSessionsView, StartConflict } from '../../lib/practical';
import { attemptNumber, firstParagraph, toBlocks } from '../../lib/practical';
import { useFormat } from '../../lib/format';
import { languageName } from '../course/labels';
import { ReportIssueButton } from '../ReportIssue';
import { Breadcrumb, Button, InquiryMeter, QuestionGlyph, type Crumb } from '../ui';
import { Icon } from '../icons';
import { Inline, RichText } from './RichText';
import { useAgenda } from './TaskPanel';

/** Номер этики из окружения (A28) — строка показывается, только если задана. */
const ETHICS_APPROVAL = (import.meta.env.VITE_ETHICS_APPROVAL as string | undefined)?.trim() || null;

function Rule({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="num mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border-strong text-fg-2" aria-hidden>
        {n}
      </span>
      <div className="min-w-0 flex-1 text-body text-fg">{children}</div>
    </li>
  );
}

/**
 * Бриф практикума (screen_specs «Socratic practical: brief»): открытие страницы сессию НЕ
 * создаёт — только «Начать диалог» (единственное место кнопки spark). Сценарий показан ровно
 * так, как его получает тьютор; правила, бюджет ответов с превью InquiryMeter, время,
 * строки о данных, закреплении языка и этическом одобрении. На мобильных — липкая CTA внизу.
 */
export function PracticalBrief({
  view, crumbs, languageLocked, courseId, enrollmentId, starting, startError, conflict, onStart, onOpenLectures,
}: {
  view: PracticalSessionsView;
  crumbs: Crumb[];
  /** Язык курса уже закреплён — строку о закреплении не показываем */
  languageLocked: boolean;
  courseId: string;
  enrollmentId: string;
  starting: boolean;
  /** Сетевая/серверная ошибка старта — своя кнопка «Повторить» (повторный старт) */
  startError: boolean;
  /** Спокойное сообщение о 409 (данные страницы уже перезапрошены) */
  conflict: StartConflict | null;
  onStart: () => void;
  onOpenLectures: () => void;
}) {
  const { t } = useTranslation();
  const { formatDate } = useFormat();
  const { brief } = view;
  const agenda = useAgenda(brief);
  const k = attemptNumber(view);
  const lead = firstParagraph(brief.scenario);
  const rest = toBlocks(brief.scenario).length > 1;
  const lockText = view.lock
    ? view.lock.code === 'NOT_YET_AVAILABLE'
      ? t('practical.brief.locked.NOT_YET_AVAILABLE', { date: formatDate(view.lock.until, 'long') })
      : t('practical.brief.locked.CLOSED')
    : null;
  const blockedText = lockText ?? (!view.canStart ? t('practical.brief.noAttempts') : null);

  const cta = (className?: string) => (
    <Button variant="spark" size="lg" className={clsx('w-full', className)} onClick={onStart} loading={starting} disabled={!view.canStart}>
      {t('practical.brief.start')}
      {!starting && <Icon name="arrow-right" size={18} />}
    </Button>
  );

  const status = (
    <>
      {blockedText && (
        <p className="flex items-start gap-2 text-body text-fg-2">
          <Icon name="lock" size={18} className="mt-0.5" />
          {blockedText}
        </p>
      )}
      {conflict && (
        <p role="status" className="flex items-start gap-2 text-body text-fg-2">
          <Icon name="info" size={18} className="mt-0.5" />
          {t(`practical.brief.conflict.${conflict}`)}
        </p>
      )}
      {startError && (
        <div role="alert" className="rounded-xl bg-danger/8 px-3.5 py-3 text-body text-danger-ink">
          <p>{t('practical.brief.startError')}</p>
          <button type="button" onClick={onStart} disabled={starting} className="mt-1.5 font-semibold underline underline-offset-2 disabled:opacity-50">
            {t('practical.chat.retry')}
          </button>
        </div>
      )}
    </>
  );

  return (
    <div className="pb-32 lg:pb-0">
      <Breadcrumb items={crumbs} className="mb-5" />

      <header className="max-w-[62rem]">
        <div className="eyebrow">{t('practical.kind')}</div>
        <h1 className="mt-1.5 text-display-lg text-fg">{brief.title}</h1>
        <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-fg-2">
          <Icon name="globe" size={16} />
          <span>{languageName(t, brief.language)}</span>
          <span aria-hidden>·</span>
          <span>{t('practical.attempt', { k, max: view.maxSessions })}</span>
        </p>
      </header>

      <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-6">
          {/* Ситуация — ровно тот текст, что получает тьютор */}
          <section className="card p-5 sm:p-6" aria-labelledby="brief-purpose">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="brief-purpose" className="font-sans text-title text-fg">
                {t('practical.brief.purpose')}
              </h2>
              <ReportIssueButton compact targetType="PRACTICAL_TASK" targetId={brief.id} context="PRACTICAL" enrollmentId={enrollmentId} />
            </div>
            {rest ? (
              <RichText text={brief.scenario} className="max-w-[68ch] text-body-lg text-fg" />
            ) : (
              <p className="max-w-[68ch] text-body-lg text-fg">
                <Inline text={lead} />
              </p>
            )}
          </section>

          {/* Что будет в диалоге */}
          <section className="card p-5 sm:p-6" aria-labelledby="brief-agenda">
            <h2 id="brief-agenda" className="mb-4 font-sans text-title text-fg">
              {t('practical.brief.agendaTitle')}
            </h2>
            <ol className="flex flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-2">
              {agenda.map((step, i) => (
                <li key={i} className="flex min-w-0 flex-1 items-stretch gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-border bg-surface-2/60 px-3.5 py-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-spark/15 font-mono text-sm font-semibold tabular-nums text-spark-ink" aria-hidden>
                      {i + 1}
                    </span>
                    <span className="min-w-0 text-body font-semibold text-fg">{step}</span>
                  </div>
                  {i < agenda.length - 1 && <Icon name="chevron-right" size={18} className="hidden self-center text-fg-2 sm:block" />}
                </li>
              ))}
            </ol>
          </section>

          {/* Правила */}
          <section className="card p-5 sm:p-6" aria-labelledby="brief-rules">
            <h2 id="brief-rules" className="mb-4 font-sans text-title text-fg">
              {t('practical.brief.rulesTitle')}
            </h2>
            <ol className="space-y-4">
              <Rule n={1}>{t('practical.brief.rules.noAnswers')}</Rule>
              <Rule n={2}>
                <p>{t('practical.brief.rules.budget', { count: brief.maxAiMessages })}</p>
                <InquiryMeter used={0} max={brief.maxAiMessages} className="mt-2" />
              </Rule>
              <Rule n={3}>{t('practical.brief.rules.end')}</Rule>
              <Rule n={4}>
                <p>{t('practical.brief.rules.lectures')}</p>
                {brief.lectures.length > 0 && (
                  <button
                    type="button"
                    onClick={onOpenLectures}
                    className="-ml-2 mt-1 inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-brand transition-colors hover:bg-brand-soft"
                  >
                    <Icon name="book-open" size={16} />
                    {t('practical.materials.title')}
                  </button>
                )}
              </Rule>
              <Rule n={5}>{t('practical.brief.rules.techError')}</Rule>
              <Rule n={6}>{t('practical.brief.rules.noRetryAfterPass')}</Rule>
            </ol>
          </section>

          {/* Данные, язык, этика */}
          <div className="space-y-1.5 text-sm text-fg-2">
            <p className="flex items-start gap-2">
              <Icon name="info" size={16} className="mt-0.5" />
              <span>{t('practical.brief.dataNote')}</span>
            </p>
            {!languageLocked && (
              <p className="flex items-start gap-2">
                <Icon name="globe" size={16} className="mt-0.5" />
                <span>{t('practical.brief.languageLock')}</span>
              </p>
            )}
            {ETHICS_APPROVAL && (
              <p className="flex items-start gap-2">
                <Icon name="award" size={16} className="mt-0.5" />
                <span>{t('practical.brief.ethics', { approval: ETHICS_APPROVAL })}</span>
              </p>
            )}
          </div>
        </div>

        {/* Тьютор и старт */}
        <aside className="space-y-4 lg:sticky lg:top-20">
          <section className="card p-5 sm:p-6" aria-labelledby="brief-tutor">
            <div className="flex items-center gap-3.5">
              <QuestionGlyph size={48} />
              <h2 id="brief-tutor" className="font-sans text-title text-fg">
                {t('practical.brief.tutorName')}
              </h2>
            </div>
            <ul className="mt-4 space-y-2">
              {(['ask', 'noAnswer', 'justify'] as const).map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-body text-fg">
                  <Icon name="check" size={18} strokeWidth={2} className="mt-0.5 text-spark-ink" />
                  <span>{t(`practical.brief.tutorPoints.${p}`)}</span>
                </li>
              ))}
            </ul>
            {brief.estimatedMinutes ? (
              <p className="mt-4 flex items-center gap-2 border-t border-border pt-4 text-meta text-fg-2">
                <Icon name="clock" size={18} />
                {t('practical.brief.minutes', { count: brief.estimatedMinutes })}
              </p>
            ) : null}
            <div className="mt-5 hidden space-y-3 lg:block">
              {cta()}
              {status}
            </div>
          </section>
          <div className="space-y-3 lg:hidden">{status}</div>
        </aside>
      </div>

      {/* Мобильные: липкая CTA над нижней панелью вкладок */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] z-20 border-t border-border bg-card/95 px-4 py-3 backdrop-blur lg:hidden">
        {cta()}
      </div>
    </div>
  );
}
