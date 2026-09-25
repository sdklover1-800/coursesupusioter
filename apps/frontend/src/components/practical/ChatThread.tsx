import { clsx } from 'clsx';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatItem, VerdictCode } from '../../lib/practical';
import { reducedMotion } from '../../lib/practical';
import { QuestionGlyph } from '../ui';
import { Icon } from '../icons';
import { ServiceLine, StudentBubble, TutorBubble } from './Bubble';

/** Порог «читатель ушёл вверх» (px): дальше — не прокручиваем сами, показываем пилюлю. */
const AWAY_PX = 120;

/**
 * Лента диалога (screen_specs «Socratic practical: dialogue»): role=log + aria-live=polite,
 * объявляются только завершённые реплики (пузырь ожидания — ВНЕ журнала). Если читатель
 * поднялся выше 120 px, новые ответы не прокручивают ленту — появляется «↓ Новый ответ».
 * SYSTEM-реплика (закрывающая фраза сервера) — служебная строка «Диалог завершён · …» по verdictCode.
 */
export function ChatThread({
  items, sending, slow, enrollmentId, verdictCode, footer, className,
}: {
  items: ChatItem[];
  /** Итог сессии — подпись служебной строки завершения */
  verdictCode?: VerdictCode | null;
  sending: boolean;
  slow: boolean;
  enrollmentId?: string;
  /** Под лентой внутри прокрутки (например, «Диалог завершён») */
  footer?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const awayRef = useRef(false);
  const [pill, setPill] = useState(false);
  const visible = items;
  const systemText = verdictCode ? `${t('practical.chat.ended')} · ${t(`practical.verdict.headline.${verdictCode}`)}` : t('practical.chat.ended');

  const toBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
  }, []);

  // Первый показ — сразу к последней реплике
  useLayoutEffect(() => {
    toBottom(false);
  }, [toBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const away = el.scrollHeight - el.scrollTop - el.clientHeight > AWAY_PX;
    awayRef.current = away;
    if (!away) setPill(false);
  };

  // Новая реплика: своя — всегда к низу (действие студента); тьютора — только если читатель внизу
  const last = visible[visible.length - 1];
  const lastKey = last ? `${last.id}:${visible.length}` : '';
  useEffect(() => {
    if (!last) return;
    if (last.role === 'STUDENT') {
      toBottom(true);
      setPill(false);
    } else if (awayRef.current) {
      setPill(true);
    } else {
      toBottom(true);
    }
    // lastKey — единственный триггер
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastKey]);

  // Рост содержимого (раскрытие реплики, пузырь ожидания): держим низ, если читатель там
  useEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (!awayRef.current) toBottom(false);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [toBottom]);

  return (
    <div className={clsx('relative min-h-0 flex-1', className)}>
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain">
        <div ref={contentRef} className="mx-auto w-full max-w-[760px] px-1 py-5 sm:px-2">
          <div role="log" aria-live="polite" aria-relevant="additions" aria-label={t('practical.chat.logLabel')} className="space-y-5">
            {visible.map((m, i) => {
              if (m.role === 'STUDENT') return <StudentBubble key={m.id} content={m.content} />;
              if (m.role === 'SYSTEM') return <ServiceLine key={m.id} text={systemText} />;
              const prev = visible[i - 1];
              return (
                <TutorBubble
                  key={m.id}
                  id={m.id}
                  content={m.content}
                  first={!prev || prev.role !== 'AI'}
                  fresh={m.fresh}
                  enrollmentId={enrollmentId}
                />
              );
            })}
          </div>
          {/* Ожидание тьютора — вне журнала: скринридер не объявляет промежуточные состояния */}
          {sending && (
            <div className="mt-5 flex items-center gap-3" data-testid="tutor-waiting">
              <span className="animate-pulse">
                <QuestionGlyph size={28} />
              </span>
              <div className="rounded-2xl rounded-tl-md border border-dashed border-spark/40 bg-card/70 px-4 py-2.5 text-body text-fg-2">
                {slow ? t('practical.chat.slow') : t('practical.chat.thinking')}
              </div>
            </div>
          )}
          {footer}
        </div>
      </div>
      {pill && (
        <button
          type="button"
          onClick={() => {
            setPill(false);
            toBottom(true);
          }}
          className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-body font-semibold text-white shadow-float transition-colors hover:bg-ink/90 dark:bg-fg dark:text-ink"
        >
          <Icon name="chevron-down" size={16} />
          {t('practical.chat.newReply')}
        </button>
      )}
    </div>
  );
}
