import { clsx } from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RubricCriterion, SessionDetail, SessionEvaluation } from '../../lib/practical';
import { RUBRIC_ORDER } from '../../lib/tones';
import { reducedMotion } from '../../lib/practical';
import { Icon } from '../icons';
import { ServiceLine, StudentBubble, TutorBubble } from './Bubble';

type Highlight = NonNullable<SessionEvaluation['highlights']>[number];

/**
 * «Разбор диалога» (screen_specs «verdict and dialogue review»): транскрипт только для чтения,
 * метки на репликах студента, отмеченных в итоговой оценке («✓ Самокоррекция», «↗ Качество
 * вопросов» + строка пояснения), и фильтр по 4 критериям: выбор прокручивает к первой
 * отмеченной реплике и подсвечивает подходящие. Показывается только когда highlights ≠ null (A6).
 */
export function DialogueReview({
  detail, highlights, enrollmentId, onBack,
}: {
  detail: SessionDetail;
  highlights: Highlight[];
  enrollmentId?: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<RubricCriterion | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const byMessage = useMemo(() => {
    const map = new Map<string, Highlight[]>();
    for (const h of highlights) map.set(h.messageId, [...(map.get(h.messageId) ?? []), h]);
    return map;
  }, [highlights]);
  const counts = useMemo(() => {
    const c: Partial<Record<RubricCriterion, number>> = {};
    for (const h of highlights) c[h.criterion] = (c[h.criterion] ?? 0) + 1;
    return c;
  }, [highlights]);
  const messages = detail.messages;
  const code = detail.session.verdictCode;
  const systemText = code ? `${t('practical.chat.ended')} · ${t(`practical.verdict.headline.${code}`)}` : t('practical.chat.ended');
  const matches = (id: string) => !!filter && (byMessage.get(id) ?? []).some((h) => h.criterion === filter);

  // Фокус на заголовок при открытии разбора (смена экрана для скринридера)
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Выбор критерия — к первой подходящей реплике
  useEffect(() => {
    if (!filter) return;
    const first = messages.find((m) => matches(m.id));
    if (!first) return;
    listRef.current?.querySelector(`[data-mid="${CSS.escape(first.id)}"]`)?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    // messages/matches зависят от filter и detail
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const pill = (active: boolean) =>
    clsx(
      'inline-flex min-h-[2.5rem] items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
      active ? 'border-brand bg-brand-soft text-brand' : 'border-border bg-card text-fg hover:border-brand/50',
    );

  return (
    <section aria-labelledby="dialogue-review-title" className="space-y-5">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="-ml-2 mb-2 inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-brand transition-colors hover:bg-brand-soft"
        >
          <Icon name="chevron-left" size={16} />
          {t('practical.review.back')}
        </button>
        <h2 id="dialogue-review-title" ref={headingRef} tabIndex={-1} className="text-display-lg text-fg focus:outline-none">
          {t('practical.verdict.review')}
        </h2>
        <p className="mt-1 text-body text-fg-2">{t('practical.review.hint')}</p>
      </div>

      {/* Фильтр по критерию */}
      <div role="group" aria-label={t('practical.review.filterLabel')} className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={filter === null} onClick={() => setFilter(null)} className={pill(filter === null)}>
          {t('practical.review.all')}
          <span className="num text-fg-2">{highlights.length}</span>
        </button>
        {RUBRIC_ORDER.map((c) => (
          <button key={c} type="button" aria-pressed={filter === c} disabled={!counts[c]} onClick={() => setFilter(c)} className={pill(filter === c)}>
            {t(`ui.rubric.${c}`)}
            <span className="num text-fg-2">{counts[c] ?? 0}</span>
          </button>
        ))}
      </div>

      <div ref={listRef} className="card space-y-5 px-3 py-4 sm:p-6">
        {messages.map((m, i) => {
          const dim = !!filter && !matches(m.id);
          if (m.role === 'SYSTEM') return <ServiceLine key={m.id} text={systemText} />;
          if (m.role === 'AI') {
            const prev = messages[i - 1];
            return (
              <div key={m.id} data-mid={m.id} className={clsx('transition-opacity', dim && 'opacity-50')}>
                <TutorBubble id={m.id} content={m.content} first={!prev || prev.role !== 'AI'} enrollmentId={enrollmentId} />
              </div>
            );
          }
          const tags = byMessage.get(m.id) ?? [];
          return (
            <div key={m.id} data-mid={m.id}>
              <StudentBubble content={m.content} dimmed={dim} highlighted={matches(m.id)}>
                {tags.length > 0 && (
                  <ul className={clsx('mt-2 flex w-full max-w-[85%] flex-col items-end gap-1.5 sm:max-w-[80%]', dim && 'opacity-50')}>
                    {tags.map((h, j) => (
                      <li key={j} className="rounded-xl border border-border bg-card px-3 py-2 text-left shadow-soft">
                        <div className={clsx('flex flex-wrap items-center gap-x-1.5 text-sm font-semibold', h.polarity === 'plus' ? 'text-teal-ink' : 'text-fg')}>
                          {h.polarity === 'plus' ? (
                            <Icon name="check" size={16} strokeWidth={2} />
                          ) : (
                            <Icon name="arrow-right" size={16} strokeWidth={2} className="-rotate-45" />
                          )}
                          <span>{t(`ui.rubric.${h.criterion}`)}</span>
                          <span className="whitespace-nowrap font-normal text-fg-2">· {h.polarity === 'plus' ? t('practical.review.plus') : t('practical.review.minus')}</span>
                        </div>
                        <p className="mt-0.5 text-sm text-fg-2">{h.note}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </StudentBubble>
            </div>
          );
        })}
        {filter && !messages.some((m) => matches(m.id)) && <p className="text-body text-fg-2">{t('practical.review.empty')}</p>}
      </div>
    </section>
  );
}
