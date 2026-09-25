import { useEffect, useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, buttonClass } from '../ui';
import { Icon } from '../icons';

/**
 * Экран после окончания видео (Skillshare, screen_specs «END OVERLAY»): чип «Лекция 5 из 15»,
 * «Далее — проверьте себя», мини-квиз (тренировка), следующий шаг, «Пересмотреть» и
 * «Отметить пройденной», если ещё не отмечено. НИКАКОГО автоперехода и обратного отсчёта.
 * Esc закрывает; при открытии фокус переходит внутрь.
 */
export function EndOfLectureOverlay({
  open, onClose, lectureNumber, lecturesTotal, miniQuizCount, onMiniQuiz, next, onReplay, completed, onComplete, completing,
}: {
  open: boolean;
  onClose: () => void;
  lectureNumber: number;
  lecturesTotal: number;
  /** null — у лекции нет мини-квиза */
  miniQuizCount: number | null;
  onMiniQuiz: () => void;
  /** Следующий шаг пути: подпись и ссылка */
  next: { label: string; href: string } | null;
  onReplay: () => void;
  completed: boolean;
  onComplete: () => void;
  completing: boolean;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panelRef.current?.querySelector<HTMLElement>('button, a[href]');
    first?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  const hasQuiz = miniQuizCount !== null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="absolute inset-0 z-20 flex animate-fade-in items-center justify-center overflow-y-auto bg-ink/85 p-3 backdrop-blur-sm sm:p-6"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t('lecture.end.close')}
        className="absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
      >
        <Icon name="x" size={20} />
      </button>
      <div className="w-full max-w-md text-center">
        <span className="hidden rounded-full bg-white/10 px-2.5 py-0.5 text-sm font-semibold text-white/90 sm:inline-block">
          {t('lecture.lectureOf', { n: lectureNumber, total: lecturesTotal })}
        </span>
        <h2 id={titleId} className="text-body-lg font-semibold text-white sm:mt-2 sm:font-display sm:text-display-md">
          {hasQuiz ? t('lecture.end.heading') : t('lecture.end.headingNoQuiz')}
        </h2>
        <div className="mt-3 flex flex-col gap-2 sm:mt-5">
          {hasQuiz && (
            <Button size="sm" onClick={onMiniQuiz} data-autofocus className="w-full sm:h-11">
              <Icon name="list-check" size={18} />
              {t('lecture.end.miniQuiz', { questions: t('lecture.questions', { count: miniQuizCount ?? 0 }) })}
            </Button>
          )}
          {next && (
            <Link
              to={next.href}
              data-autofocus={hasQuiz ? undefined : true}
              className={buttonClass(hasQuiz ? 'secondary' : 'primary', 'sm', 'w-full sm:h-11')}
            >
              <span className="truncate">{next.label}</span>
              <Icon name="chevron-right" size={18} />
            </Link>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {!completed && (
              <Button variant="secondary" size="sm" loading={completing} onClick={onComplete}>
                <Icon name="check" size={16} />
                {t('lecture.markDone')}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onReplay} className="text-white hover:bg-white/10">
              <Icon name="refresh" size={16} />
              {t('lecture.end.replay')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
