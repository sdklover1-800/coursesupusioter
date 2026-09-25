import { clsx } from 'clsx';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { plainText, reducedMotion, splitTutorMessage } from '../../lib/practical';
import { ReportIssueButton } from '../ReportIssue';
import { QuestionGlyph } from '../ui';
import { Icon } from '../icons';
import { Inline, RichText } from './RichText';

/** Длительность раскрытия свежей реплики тьютора (FE4 §3, ~500 мс; без движения — сразу). */
const REVEAL_MS = 500;

/** Сколько символов показать: плавно 0 → length за REVEAL_MS (только у свежей реплики). */
function useReveal(length: number, enabled: boolean): number {
  const [n, setN] = useState(enabled ? 0 : length);
  useEffect(() => {
    if (!enabled) {
      setN(length);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / REVEAL_MS);
      setN(Math.ceil(p * length));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [enabled, length]);
  return n;
}

/**
 * Реплика тьютора: карточка с рамкой spark/25 и аватаром QuestionGlyph; подпись «Сократ · тьютор»
 * у первой реплики группы; последнее предложение с «?» — отдельной строкой (полоса spark-ink, ✦).
 * Скринридер читает полный текст из sr-only (визуальное раскрытие — aria-hidden), поэтому
 * живой журнал объявляет реплику один раз и целиком.
 * ⚑ — жалоба на реплику (CHAT_MESSAGE, context PRACTICAL): на мобильных видна всегда,
 * на десктопе — при наведении/фокусе.
 */
export function TutorBubble({
  id, content, first = true, fresh = false, enrollmentId, report = true, className,
}: {
  id: string;
  content: string;
  /** Первая реплика группы — подпись и аватар */
  first?: boolean;
  /** Пришла только что — раскрытие ~500 мс */
  fresh?: boolean;
  enrollmentId?: string;
  report?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { body, question } = useMemo(() => splitTutorMessage(content), [content]);
  const animate = useMemo(() => fresh && !reducedMotion(), [fresh]);
  const total = body.length + (question?.length ?? 0);
  const n = useReveal(total, animate);
  const shownBody = body.slice(0, n);
  const shownQuestion = question ? question.slice(0, Math.max(0, n - body.length)) : '';

  return (
    <div className={clsx('group flex items-start gap-2.5 sm:gap-3', className)}>
      <div className="w-7 shrink-0 pt-6" aria-hidden>
        {first && <QuestionGlyph size={28} />}
      </div>
      <div className="min-w-0 max-w-[92%] sm:max-w-[85%]">
        {first && (
          <div className="mb-1 text-label text-fg-2" aria-hidden>
            {t('practical.chat.tutorLabel')}
          </div>
        )}
        <div className="flex items-start gap-1">
          <div className="min-w-0 rounded-2xl rounded-tl-md border border-spark/25 bg-card px-4 py-3 text-base leading-relaxed text-fg shadow-soft">
            <span className="sr-only">
              {t('practical.chat.srTutor')} {plainText(content)}
            </span>
            <div aria-hidden>
              {shownBody && <RichText text={shownBody} />}
              {question && shownQuestion && (
                <p className={clsx('border-l-2 border-spark-ink pl-3 font-medium', shownBody && 'mt-2.5')}>
                  <span className="mr-1.5 text-spark-ink">✦</span>
                  <Inline text={shownQuestion.replace(/\s*\n+\s*/g, ' ')} />
                </p>
              )}
            </div>
          </div>
          {report && enrollmentId && !id.startsWith('tmp-') && (
            <ReportIssueButton
              compact
              targetType="CHAT_MESSAGE"
              targetId={id}
              context="PRACTICAL"
              enrollmentId={enrollmentId}
              className="mt-1 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Реплика студента: заливка brand-fill, белый текст, справа, до 80% ширины. */
export function StudentBubble({
  content, className, children, dimmed, highlighted,
}: {
  content: string;
  className?: string;
  /** Под пузырём (метки разбора) */
  children?: ReactNode;
  dimmed?: boolean;
  highlighted?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={clsx('flex flex-col items-end transition-opacity', dimmed && 'opacity-50', className)}>
      <div
        className={clsx(
          'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-fill px-4 py-3 text-base leading-relaxed text-white sm:max-w-[80%]',
          highlighted && 'ring-2 ring-spark-ink ring-offset-2 ring-offset-surface',
        )}
      >
        <span className="sr-only">{t('practical.chat.srYou')} </span>
        {content}
      </div>
      {children}
    </div>
  );
}

/**
 * Служебная строка завершения (SYSTEM-реплика сервера, BE3): не пузырь тьютора. Текст —
 * локализованный по verdictCode в языке интерфейса (старые SYSTEM-реплики были только на русском).
 */
export function ServiceLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="h-px flex-1 bg-border-strong" aria-hidden />
      <span className="flex max-w-[85%] items-center gap-1.5 text-center text-sm font-medium text-fg-2">
        <Icon name="flag" size={15} className="shrink-0" />
        {text}
      </span>
      <span className="h-px flex-1 bg-border-strong" aria-hidden />
    </div>
  );
}
