import { clsx } from 'clsx';
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PracticeCheck } from '@edu/shared';
import { checkPractice, errorCode, QuizErrorCode, type PracticeItem } from '../../lib/quiz';
import { ApiError } from '../../lib/api';
import { Button, buttonClass, ModeBadge, toast } from '../ui';
import { Icon } from '../icons';
import { ReportIssueButton } from '../ReportIssue';
import { FeedbackBand } from './FeedbackBand';
import { OptionGroup, type GroupOption } from './OptionGroup';
import type { OptionMark } from './OptionTile';
import { FOOTER_CTA, QuestionShell, ShellFooter } from './QuestionShell';
import { useQuizHotkeys } from './hotkeys';

/**
 * Тренировка (FE3 §3, design_direction §8): мгновенная обратная связь РАЗРЕШЕНА только здесь.
 * Поток: «Проверить» → 1-й неверный: «Не совсем. Попробуйте ещё раз» (ключ НЕ раскрыт) →
 * 2-й неверный или «Показать разбор»: ключ + обоснования вариантов; «Не знаю» — раскрыть и
 * вернуть вопрос в конец; верно — полоса teal с меняющейся похвалой. В конце — «Повтор»
 * пропущенных и итог «Тренировка завершена · k из n». Ничего не пишет, кроме вызовов проверки.
 *
 * variant 'focus' — модульная тренировка в режиме фокуса (QuestionShell mode="practice");
 * variant 'inline' — мини-квиз в карточке на странице лекции / курса (MiniQuiz).
 */
export interface PracticeRunnerProps {
  items: PracticeItem[];
  enrollmentId: string;
  variant: 'focus' | 'inline';
  /** Заголовок FocusBar (focus) */
  title?: string;
  /** Шапка карточки (inline): «Мини-квиз · 3 вопроса» + ModeBadge */
  header?: ReactNode;
  /** ✕ / «К тесту» (focus) */
  onExit?: () => void;
  /** Подпись кнопки выхода в итоге (focus), по умолчанию «К тесту» */
  exitLabel?: string;
  /** Номер лекции по id — тег источника «Лекция 3» */
  lectureNumbers?: Record<string, number>;
  /** Ссылка «Тренироваться на мини-квизах модуля» для 403 PRACTICE_LOCKED */
  lockedHref?: string;
  /** Сразу показать «Вопросы теста пока закрыты» (набор без оцениваемых вопросов до финала) */
  initialLocked?: boolean;
}

type Phase = 'answering' | 'wrong' | 'correct' | 'revealed';
interface Visit {
  idx: number;
  repeat: boolean;
}
type Stage = 'question' | 'interstitial' | 'done' | 'locked';

const PRAISE_KEYS = ['a', 'b', 'c', 'd', 'e'] as const;

export function PracticeRunner(props: PracticeRunnerProps) {
  const { items, enrollmentId, variant, title, header, onExit, exitLabel, lectureNumbers, lockedHref, initialLocked } = props;
  const { t } = useTranslation();
  const promptId = useId();
  const instrId = useId();
  const cardRef = useRef<HTMLDivElement>(null);

  const initialQueue = useMemo<Visit[]>(() => items.map((_, idx) => ({ idx, repeat: false })), [items]);
  const [queue, setQueue] = useState<Visit[]>(initialQueue);
  const [pos, setPos] = useState(0);
  const [stage, setStage] = useState<Stage>(initialLocked ? 'locked' : items.length ? 'question' : 'done');
  const [phase, setPhase] = useState<Phase>('answering');
  const [selected, setSelected] = useState<number[]>([]);
  const [check, setCheck] = useState<PracticeCheck | null>(null);
  const [wrongPicks, setWrongPicks] = useState<number[]>([]);
  const [firstTry, setFirstTry] = useState<Record<number, 'correct' | 'missed'>>({});
  const [repeats, setRepeats] = useState<number[]>([]);
  const [repeatsQueued, setRepeatsQueued] = useState(false);
  const [praise, setPraise] = useState(0);
  const [busy, setBusy] = useState(false);

  const visit = queue[pos];
  const item = visit ? items[visit.idx] : undefined;
  const options: GroupOption[] = useMemo(() => (item ? item.question.options.map((text, id) => ({ id, text })) : []), [item]);
  const correctIds = check?.correctOptionIds ?? [];
  const settled = phase === 'correct' || phase === 'revealed';

  function restart() {
    setQueue(initialQueue);
    setPos(0);
    setStage(items.length ? 'question' : 'done');
    setPhase('answering');
    setSelected([]);
    setCheck(null);
    setWrongPicks([]);
    setFirstTry({});
    setRepeats([]);
    setRepeatsQueued(false);
  }

  async function runCheck(ids: number[]): Promise<PracticeCheck | null> {
    if (!item) return null;
    setBusy(true);
    try {
      return await checkPractice(item.quizId, { enrollmentId, questionId: item.question.id, selectedOptionIds: ids });
    } catch (err) {
      if (errorCode(err) === QuizErrorCode.PRACTICE_LOCKED) setStage('locked');
      else toast(err instanceof ApiError && err.status === 429 ? err.message : t('quiz.practice.checkFailed'), 'danger');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onCheck() {
    if (!visit || !selected.length || busy || settled) return;
    const res = await runCheck(selected);
    if (!res) return;
    setCheck(res);
    if (res.isCorrect) {
      setPhase('correct');
      setPraise((p) => p + 1);
      setFirstTry((f) => (f[visit.idx] ? f : { ...f, [visit.idx]: 'correct' }));
      return;
    }
    setFirstTry((f) => (f[visit.idx] ? f : { ...f, [visit.idx]: 'missed' }));
    if (wrongPicks.length === 0) {
      // Первый неверный: ключ НЕ раскрываем (правильные id пришли, но не показываются)
      setWrongPicks(selected);
      setPhase('wrong');
    } else {
      setWrongPicks((w) => [...w, ...selected]);
      setPhase('revealed');
    }
  }

  function onTryAgain() {
    setSelected([]);
    setPhase('answering');
  }

  async function onReveal() {
    if (!visit || busy) return;
    let res = check;
    if (!res) {
      // «Не знаю» до проверки: API требует выбор — берём первый вариант лишь ради ключа.
      // Тренировочная проверка не пишет попыток и телеметрии, результат не засчитывается.
      res = await runCheck([options[0]?.id ?? 0]);
      if (!res) return;
      setCheck(res);
    }
    setFirstTry((f) => (f[visit.idx] ? f : { ...f, [visit.idx]: 'missed' }));
    setSelected([]);
    setPhase('revealed');
  }

  function onNext() {
    if (!visit) return;
    let nextRepeats = repeats;
    if (!visit.repeat && firstTry[visit.idx] === 'missed' && !repeats.includes(visit.idx)) {
      nextRepeats = [...repeats, visit.idx];
      setRepeats(nextRepeats);
    }
    setSelected([]);
    setCheck(null);
    setWrongPicks([]);
    setPhase('answering');
    if (pos + 1 < queue.length) {
      setPos(pos + 1);
      return;
    }
    if (!repeatsQueued && nextRepeats.length) setStage('interstitial');
    else setStage('done');
  }

  function startRepeats() {
    setQueue((q) => [...q, ...repeats.map((idx) => ({ idx, repeat: true }))]);
    setRepeatsQueued(true);
    setPos(queue.length);
    setStage('question');
  }

  // Основное действие (Enter): проверить → дальше; после первого неверного — попробовать ещё
  function primaryAction() {
    if (stage === 'interstitial') return startRepeats();
    if (stage !== 'question') return;
    if (phase === 'answering') void onCheck();
    else if (phase === 'wrong') onTryAgain();
    else onNext();
  }

  useQuizHotkeys({
    enabled: stage === 'question' || stage === 'interstitial',
    scopeRef: variant === 'inline' ? cardRef : undefined,
    optionCount: stage === 'question' && phase === 'answering' ? options.length : 0,
    onDigit: (i) => {
      const opt = options[i];
      if (opt && phase === 'answering' && !wrongPicks.includes(opt.id)) setSelected([opt.id]);
    },
    onEnter: primaryAction,
  });

  /* ── Отметки вариантов (только тренировка) ── */
  const marks: Partial<Record<number, OptionMark>> = {};
  for (const id of wrongPicks) marks[id] = 'wrong';
  if (phase === 'correct') for (const id of selected) marks[id] = 'correct';
  if (phase === 'revealed') for (const id of correctIds) marks[id] = 'key';
  const rationales: Partial<Record<number, string | null>> = {};
  if (phase === 'revealed' && check?.optionRationales) {
    check.optionRationales.forEach((r, id) => {
      if (r) rationales[id] = r;
    });
  }

  /* ── Полоса обратной связи ── */
  const chosenRationale = phase === 'correct' ? selected.map((id) => check?.optionRationales?.[id]).find(Boolean) ?? null : null;
  let band: ReactNode = null;
  if (stage === 'question' && phase === 'correct') {
    band = (
      <FeedbackBand mode="practice" kind="correct" variant={variant === 'focus' ? 'footer' : 'inline'} title={t(`quiz.practice.praise.${PRAISE_KEYS[(praise - 1 + PRAISE_KEYS.length) % PRAISE_KEYS.length]!}`)}>
        {check?.explanation && <p>{check.explanation}</p>}
        {chosenRationale && chosenRationale !== check?.explanation && <p className="text-fg-2">{chosenRationale}</p>}
      </FeedbackBand>
    );
  } else if (stage === 'question' && phase === 'wrong') {
    band = (
      <FeedbackBand mode="practice" kind="wrong" variant={variant === 'focus' ? 'footer' : 'inline'} title={t('quiz.practice.wrongFirst')}>
        <p className="text-fg-2">{t('quiz.practice.wrongFirstHint')}</p>
      </FeedbackBand>
    );
  } else if (stage === 'question' && phase === 'revealed') {
    band = (
      <FeedbackBand mode="practice" kind="revealed" variant={variant === 'focus' ? 'footer' : 'inline'} title={t('quiz.practice.revealed')}>
        {check?.explanation && <p>{check.explanation}</p>}
        {!visit?.repeat && <p className="text-fg-2">{t('quiz.practice.revealedHint')}</p>}
      </FeedbackBand>
    );
  }

  /* ── Кнопки ── */
  const ctaCls = variant === 'focus' ? FOOTER_CTA : undefined;
  const size = variant === 'focus' ? 'md' : 'sm';
  const primary =
    phase === 'answering' ? (
      <Button className={ctaCls} size={size} disabled={!selected.length} loading={busy} onClick={() => void onCheck()}>
        {t('quiz.practice.check')}
      </Button>
    ) : phase === 'wrong' ? (
      <>
        <Button variant="secondary" size={size} className={variant === 'focus' ? 'h-13 flex-1 sm:h-11 sm:flex-none' : undefined} loading={busy} onClick={() => void onReveal()}>
          {t('quiz.practice.showReview')}
        </Button>
        <Button size={size} className={variant === 'focus' ? 'h-13 flex-1 sm:h-11 sm:min-w-[160px] sm:flex-none' : undefined} onClick={onTryAgain}>
          {t('quiz.practice.tryAgain')}
        </Button>
      </>
    ) : (
      <Button className={ctaCls} size={size} onClick={onNext}>
        {pos + 1 < queue.length || (!repeatsQueued && (repeats.length > 0 || (!visit?.repeat && firstTry[visit?.idx ?? -1] === 'missed')))
          ? t('quiz.practice.next')
          : t('quiz.practice.finish')}
      </Button>
    );
  const dontKnow =
    phase === 'answering' ? (
      <Button variant="ghost" size={size} disabled={busy} onClick={() => void onReveal()}>
        {t('quiz.practice.dontKnow')}
      </Button>
    ) : null;

  /* ── Строка точек: ● текущий, ✓ верно с первого раза, • с ошибкой, ○ впереди ── */
  const dots = (
    <ol aria-label={t('quiz.practice.progressLabel')} className="flex flex-wrap items-center gap-1.5">
      {items.map((it, i) => {
        const state = stage === 'question' && visit?.idx === i ? 'current' : firstTry[i] === 'correct' ? 'correct' : firstTry[i] === 'missed' ? 'missed' : 'pending';
        const label = `${t('quiz.practice.progressLabel')} · ${i + 1}: ${t(`quiz.practice.dot${state === 'current' ? 'Current' : state === 'correct' ? 'Correct' : state === 'missed' ? 'Missed' : 'Pending'}`)}`;
        return (
          <li key={`${it.question.id}-${i}`} className="grid h-4 w-4 place-items-center" aria-current={state === 'current' ? 'step' : undefined}>
            <span className="sr-only">{label}</span>
            {state === 'correct' ? (
              <Icon name="check" size={14} strokeWidth={2.75} className="text-teal-ink" />
            ) : (
              <span
                aria-hidden
                className={clsx(
                  'block rounded-full',
                  state === 'current' && 'h-2.5 w-2.5 bg-brand ring-2 ring-brand/25',
                  state === 'missed' && 'h-1.5 w-1.5 bg-muted',
                  state === 'pending' && 'h-2 w-2 border border-border-strong',
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );

  const counterText = visit ? `${Math.min(pos + 1, queue.length)} / ${queue.length}` : '';

  /* ── Тело вопроса ── */
  const tags: ReactNode[] = [];
  if (visit?.repeat) tags.push(<span key="r" className="inline-flex items-center gap-1 rounded-full bg-spark/15 px-2 py-px text-small font-semibold text-spark-ink"><Icon name="refresh" size={12} strokeWidth={2} />{t('quiz.practice.repeatTag')}</span>);
  if (item?.source === 'GRADED') tags.push(<span key="g" className="text-label text-fg-2">{t('quiz.practice.fromTest')}</span>);
  else if (item?.lectureId && lectureNumbers?.[item.lectureId]) tags.push(<span key="l" className="text-label text-fg-2">{t('quiz.practice.fromLecture', { n: lectureNumbers[item.lectureId] })}</span>);

  const questionBody = item ? (
    <div>
      {(tags.length > 0 || variant === 'focus') && (
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          {[
            ...(variant === 'focus'
              ? [<span key="q" className="text-label text-fg-2">{t('quiz.questionOf', { n: Math.min(pos + 1, queue.length), total: queue.length })}</span>]
              : []),
            ...tags,
          ].flatMap((node, i) => (i === 0 ? [node] : [<span key={`sep-${i}`} aria-hidden className="text-fg-2">·</span>, node]))}
        </div>
      )}
      <h2 id={promptId} className={clsx('font-sans tracking-normal text-fg', variant === 'focus' ? 'text-title' : 'text-body-lg font-semibold')}>
        {item.question.prompt}
      </h2>
      <p id={instrId} className="mb-4 mt-1.5 text-body text-fg-2">
        {t(`quiz.instruction.${item.question.type === 'TRUE_FALSE' ? 'TRUE_FALSE' : 'SINGLE_CHOICE'}`)}
      </p>
      <OptionGroup
        mode="practice"
        options={options}
        selected={phase === 'revealed' ? [] : selected}
        onChange={(ids) => phase === 'answering' && setSelected(ids)}
        labelledBy={promptId}
        describedBy={instrId}
        disabled={settled || busy}
        disabledIds={phase === 'answering' ? wrongPicks : undefined}
        marks={marks}
        rationales={rationales}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="hidden text-small text-fg-2 sm:inline">{t('quiz.kbdHintPractice')}</span>
        <ReportIssueButton targetType="QUIZ_QUESTION" targetId={item.question.id} context="PRACTICE" enrollmentId={enrollmentId} className="-ml-2.5 sm:ml-auto" />
      </div>
    </div>
  ) : null;

  /* ── Экраны без вопроса: закрыто / перерыв / итог ── */
  const firstCorrect = Object.values(firstTry).filter((v) => v === 'correct').length;
  const locked = (
    <div className="flex flex-col items-start gap-3">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-border/60 text-fg-2" aria-hidden>
        <Icon name="lock" size={20} />
      </span>
      <h2 className="font-sans text-title tracking-normal">{t('quiz.practice.lockedTitle')}</h2>
      <p className="max-w-[62ch] text-body text-fg-2">{t('quiz.practice.locked')}</p>
      {lockedHref && (
        <Link to={lockedHref} className={buttonClass('secondary', 'md')}>
          {t('quiz.practice.lockedLink')}
        </Link>
      )}
    </div>
  );
  const interstitial = (
    <div className="flex flex-col items-start gap-3">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-spark/15 text-spark-ink" aria-hidden>
        <Icon name="refresh" size={20} />
      </span>
      <h2 className="font-sans text-title tracking-normal">{t('quiz.practice.repeatIntro', { count: repeats.length })}</h2>
    </div>
  );
  const done = (
    <div className="flex flex-col items-start gap-2" role="status">
      <h2 className="font-sans text-title tracking-normal">{t('quiz.practice.done', { correct: firstCorrect, total: items.length })}</h2>
      <p className="max-w-[62ch] text-body text-fg-2">{t('quiz.practice.doneHint')}</p>
    </div>
  );

  /* ── Режим фокуса ── */
  if (variant === 'focus') {
    const progress = stage === 'done' ? 1 : queue.length ? (pos + (settled ? 1 : 0)) / queue.length : 0;
    let footer: ReactNode;
    if (stage === 'question') footer = <ShellFooter start={dontKnow} primary={primary} />;
    else if (stage === 'interstitial') footer = <ShellFooter primary={<Button className={FOOTER_CTA} onClick={startRepeats}>{t('quiz.practice.next')}</Button>} />;
    else
      footer = (
        <ShellFooter
          start={stage === 'done' && items.length ? <Button variant="ghost" onClick={restart}>{t('quiz.practice.restart')}</Button> : null}
          primary={<Button className={FOOTER_CTA} onClick={() => onExit?.()}>{exitLabel ?? t('quiz.practice.back')}</Button>}
        />
      );
    return (
      <QuestionShell
        mode="practice"
        title={title ?? t('quiz.practice.title')}
        onExit={() => onExit?.()}
        right={stage === 'question' ? <span className="num text-white">{counterText}</span> : undefined}
        progress={progress}
        progressLabel={t('quiz.practice.progressLabel')}
        footer={footer}
        band={band}
        surfaceClassName="surface-practice p-5 sm:p-8"
        testId="practice-runner"
      >
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <ModeBadge mode="practice" long />
          {items.length > 1 && stage !== 'locked' && dots}
        </div>
        {stage === 'question' && questionBody}
        {stage === 'interstitial' && interstitial}
        {stage === 'done' && (items.length ? done : <p className="text-body text-fg-2">{t('quiz.practice.empty')}</p>)}
        {stage === 'locked' && locked}
      </QuestionShell>
    );
  }

  /* ── Встроенная карточка (мини-квиз) ── */
  return (
    <div ref={cardRef} className="surface-practice p-5 sm:p-6" data-testid="practice-inline">
      {header}
      <div className={clsx('flex flex-wrap items-center justify-between gap-3', header ? 'mb-4 mt-3' : 'mb-4')}>
        {items.length > 1 && dots}
        {stage === 'question' && <span className="num ml-auto text-fg-2">{counterText}</span>}
      </div>
      {stage === 'question' && (
        <>
          {questionBody}
          {band}
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            {dontKnow && <span className="mr-auto">{dontKnow}</span>}
            {primary}
          </div>
        </>
      )}
      {stage === 'interstitial' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {interstitial}
          <Button size="sm" onClick={startRepeats}>{t('quiz.practice.next')}</Button>
        </div>
      )}
      {stage === 'done' && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          {done}
          <Button variant="secondary" size="sm" onClick={restart}>{t('quiz.practice.restart')}</Button>
        </div>
      )}
      {stage === 'locked' && locked}
    </div>
  );
}
