import { clsx } from 'clsx';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AttemptResult, AttemptStart } from '@edu/shared';
import { ApiError } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { errorCode, QuizErrorCode, saveAttemptAnswers, submitAttempt } from '../../lib/quiz';
import { Button, ConfirmDialog, Dialog, toast } from '../ui';
import { Icon } from '../icons';
import { ReportIssueButton } from '../ReportIssue';
import { OptionGroup } from './OptionGroup';
import { QuestionNavigator } from './QuestionNavigator';
import { FOOTER_CTA, QuestionShell, ShellFooter } from './QuestionShell';
import { SubmitReview } from './SubmitReview';
import { useQuizHotkeys } from './hotkeys';

/**
 * Официальная попытка (FE3 §6, USER_DECISIONS §1). НИКАКОЙ обратной связи о правильности:
 * ни цвета teal/danger, ни ✓/✗, ни «Проверить», ни подсказок, ни глифа тьютора. Раннер
 * рендерит оболочку и варианты только с mode="official" — ветки типов, в которых полоса
 * обратной связи (band) и отметки (marks) имеют тип never; FeedbackBand и PracticeRunner
 * сюда не импортируются.
 *
 * Вопросы и варианты — в порядке сервера (вторая попытка перемешана сервером), буквы A–D —
 * по позиции показа, ответы — по каноническим id. Автосохранение PATCH через 600 мс после
 * изменения, при сбое — повтор с нарастающей паузой; beforeunload — только пока сохранение
 * не завершено. ✕ — «Ответы сохранены…», попытка остаётся незавершённой.
 */
export interface OfficialRunnerProps {
  start: AttemptStart;
  /** Заголовок FocusBar («Модульный тест II») */
  title: string;
  maxAttempts: number;
  enrollmentId: string;
  /** Выход в лобби (после подтверждения); попытка остаётся незавершённой */
  onExit: () => void;
  onSubmitted: (result: AttemptResult) => void;
  /** Попытку уже отправили (другая вкладка / система) — открыть результат */
  onAlreadySubmitted: () => void;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** ◆ — знак оценивания (как в ModeBadge graded). */
function Diamond() {
  return (
    <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden className="shrink-0">
      <path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" fill="currentColor" />
    </svg>
  );
}

/** Индикатор автосохранения: облако (НЕ галочка — A25), приглушённый текст «Сохранено · 12:41». */
function AutosaveIndicator({ status, at }: { status: SaveStatus; at: string | null }) {
  const { t } = useTranslation();
  const f = useFormat();
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 text-small font-medium text-fg" role="status">
        <Icon name="alert" size={16} className="shrink-0" />
        <span>{t('quiz.runner.saveFailed')}</span>
      </span>
    );
  }
  const text =
    status === 'saving' ? t('quiz.runner.saving') : status === 'saved' && at ? t('quiz.runner.saved', { time: f.formatDate(at, 'time') }) : t('quiz.runner.autosaveOn');
  return (
    <span className={clsx('inline-flex min-w-0 items-center gap-1.5 text-small text-fg-2', status === 'idle' && 'hidden sm:inline-flex')} data-autosave={status}>
      <Icon name="cloud-check" size={16} className="shrink-0" />
      <span className="truncate">{text}</span>
    </span>
  );
}

export function OfficialRunner({ start, title, maxAttempts, enrollmentId, onExit, onSubmitted, onAlreadySubmitted }: OfficialRunnerProps) {
  const { t } = useTranslation();
  const promptId = useId();
  const instrId = useId();
  const attemptId = start.attemptId;

  // Порядок показа — как прислал сервер (position); буквы — по позиции показа
  const questions = useMemo(() => [...start.questions].sort((a, b) => a.position - b.position), [start.questions]);
  const ids = useMemo(() => questions.map((q) => q.id), [questions]);

  const [answers, setAnswers] = useState<Record<string, number[]>>(() => {
    const out: Record<string, number[]> = {};
    for (const id of ids) if (start.answers[id]?.length) out[id] = [...start.answers[id]!];
    return out;
  });
  const [flagged, setFlagged] = useState<string[]>(() => start.flagged.filter((id) => ids.includes(id)));
  // Продолжение: к первому вопросу без ответа
  const [idx, setIdx] = useState(() => {
    if (!start.resumed) return 0;
    const i = ids.findIndex((id) => !start.answers[id]?.length);
    return i >= 0 ? i : 0;
  });
  const [view, setView] = useState<'question' | 'review'>('question');
  const [save, setSave] = useState<{ status: SaveStatus; at: string | null }>({ status: start.lastSavedAt ? 'saved' : 'idle', at: start.lastSavedAt });
  const [exitOpen, setExitOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /* ── Автосохранение ──────────────────────────────────────────────── */
  const latest = useRef({ answers, flagged });
  const version = useRef(0);
  const savedVersion = useRef(0);
  const inFlight = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const retryDelay = useRef(1000);
  const stopped = useRef(false);
  const submittingRef = useRef(false);
  const alreadyRef = useRef(onAlreadySubmitted);
  alreadyRef.current = onAlreadySubmitted;

  const pending = () => version.current !== savedVersion.current || inFlight.current;

  const flush = useCallback(async () => {
    if (stopped.current || inFlight.current || version.current === savedVersion.current) return;
    const v = version.current;
    inFlight.current = true;
    setSave((s) => ({ ...s, status: 'saving' }));
    let retry = false;
    try {
      const res = await saveAttemptAnswers(attemptId, latest.current);
      savedVersion.current = Math.max(savedVersion.current, v);
      retryDelay.current = 1000;
      setSave({ status: 'saved', at: res.savedAt });
    } catch (err) {
      if (errorCode(err) === QuizErrorCode.ATTEMPT_SUBMITTED) {
        stopped.current = true;
        if (!submittingRef.current) alreadyRef.current();
        return;
      }
      setSave((s) => ({ ...s, status: 'error' }));
      // Сеть / 5xx / 429 — повтор с нарастающей паузой; прочие 4xx повтор не исправит
      const status = err instanceof ApiError ? err.status : 0;
      retry = status === 0 || status >= 500 || status === 408 || status === 429 || !(err instanceof ApiError);
      if (!retry) toast(err instanceof ApiError ? err.message : t('quiz.runner.saveFailed'), 'muted');
    } finally {
      inFlight.current = false;
    }
    if (retry) {
      const d = retryDelay.current;
      retryDelay.current = Math.min(d * 2, 15000);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), d);
    } else if (version.current !== savedVersion.current) {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 0);
    }
  }, [attemptId, t]);

  const markDirty = useCallback(
    (next: { answers: Record<string, number[]>; flagged: string[] }) => {
      latest.current = next;
      version.current += 1;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 600);
    },
    [flush],
  );

  // Сохранение «на выходе» (keepalive переживает уход со страницы)
  const flushKeepalive = useCallback(() => {
    if (stopped.current || version.current === savedVersion.current) return;
    window.clearTimeout(timer.current);
    savedVersion.current = version.current;
    void saveAttemptAnswers(attemptId, latest.current, { keepalive: true }).catch(() => undefined);
  }, [attemptId]);

  useEffect(() => {
    // Предупреждение браузера только пока есть несохранённые изменения или идёт сохранение
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (stopped.current || !pending()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushKeepalive();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onHide);
      window.clearTimeout(timer.current);
      flushKeepalive();
    };
  }, [flushKeepalive]);

  /* ── Действия ────────────────────────────────────────────────────── */
  const q = questions[idx]!;
  const answeredCount = ids.filter((id) => (answers[id]?.length ?? 0) > 0).length;
  const isLast = idx === questions.length - 1;
  const isFlagged = flagged.includes(q.id);

  function choose(questionId: string, optionIds: number[]) {
    const next = { ...answers, [questionId]: optionIds };
    setAnswers(next);
    markDirty({ answers: next, flagged });
  }
  function toggleFlag() {
    const next = isFlagged ? flagged.filter((id) => id !== q.id) : [...flagged, q.id];
    setFlagged(next);
    markDirty({ answers, flagged: next });
  }
  function go(i: number) {
    setIdx(Math.max(0, Math.min(questions.length - 1, i)));
    setView('question');
    window.scrollTo({ top: 0 });
  }

  async function doSubmit() {
    setSubmitting(true);
    submittingRef.current = true;
    stopped.current = true;
    window.clearTimeout(timer.current);
    try {
      const res = await submitAttempt(attemptId, latest.current.answers);
      savedVersion.current = version.current;
      setConfirmOpen(false);
      onSubmitted(res);
    } catch (err) {
      if (errorCode(err) === QuizErrorCode.ATTEMPT_SUBMITTED) {
        setConfirmOpen(false);
        onAlreadySubmitted();
        return;
      }
      stopped.current = false;
      submittingRef.current = false;
      toast(t('quiz.submit.failed'), 'muted');
      if (version.current !== savedVersion.current) timer.current = window.setTimeout(() => void flush(), 0);
    } finally {
      setSubmitting(false);
    }
  }

  function confirmExit() {
    setExitOpen(false);
    flushKeepalive();
    onExit();
  }

  useQuizHotkeys({
    enabled: view === 'question' && !submitting,
    optionCount: q.options.length,
    onDigit: (i) => {
      const opt = q.options[i];
      if (opt) choose(q.id, [opt.id]);
    },
  });

  const attemptsLeftAfter = Math.max(0, maxAttempts - start.attemptNumber);
  const total = questions.length;

  const right = (
    <>
      <span className="hidden items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-small font-semibold text-white sm:inline-flex">
        <Diamond />
        {t('quiz.runner.officialChip')}
      </span>
      <span className="num text-white" aria-label={t('quiz.questionOf', { n: idx + 1, total })}>
        {view === 'review' ? `${answeredCount} / ${total}` : `${idx + 1} / ${total}`}
      </span>
    </>
  );

  const navItems = questions.map((qq) => ({ id: qq.id, answered: (answers[qq.id]?.length ?? 0) > 0, flagged: flagged.includes(qq.id) }));
  const status = <AutosaveIndicator status={save.status} at={save.at} />;

  const footer =
    view === 'question' ? (
      <ShellFooter
        start={
          <Button variant="ghost" onClick={() => go(idx - 1)} disabled={idx === 0} className="shrink-0 px-3">
            <Icon name="arrow-left" size={16} />
            <span className="hidden sm:inline">{t('quiz.runner.prev')}</span>
            <span className="sr-only sm:hidden">{t('quiz.runner.prev')}</span>
          </Button>
        }
        status={status}
        primary={
          isLast ? (
            <Button className={FOOTER_CTA} onClick={() => setView('review')}>
              {t('quiz.runner.toReview')}
              <Icon name="arrow-right" size={16} />
            </Button>
          ) : (
            <Button className={FOOTER_CTA} onClick={() => go(idx + 1)}>
              {t('quiz.runner.next')}
              <Icon name="arrow-right" size={16} />
            </Button>
          )
        }
      />
    ) : (
      <ShellFooter
        start={
          <Button variant="ghost" onClick={() => go(idx)} className="shrink-0 px-3">
            <Icon name="arrow-left" size={16} />
            <span className="hidden sm:inline">{t('quiz.submit.back')}</span>
            <span className="sr-only sm:hidden">{t('quiz.submit.back')}</span>
          </Button>
        }
        status={status}
        primary={
          <Button className={FOOTER_CTA} onClick={() => setConfirmOpen(true)} loading={submitting}>
            {t('quiz.submit.send')}
          </Button>
        }
      />
    );

  return (
    <>
      <QuestionShell
        mode="official"
        title={title}
        onExit={() => setExitOpen(true)}
        exitLabel={t('quiz.runner.exitLabel')}
        right={right}
        progress={view === 'review' ? 1 : (idx + 1) / total}
        progressLabel={t('quiz.questionOf', { n: idx + 1, total })}
        above={<QuestionNavigator variant="strip" items={navItems} current={view === 'review' ? -1 : idx} onJump={go} />}
        rail={<QuestionNavigator variant="rail" items={navItems} current={view === 'review' ? -1 : idx} onJump={go} />}
        footer={footer}
        testId="official-runner"
      >
        <h1 className="sr-only">{title}</h1>
        {/* На мобильных чип режима не помещается в FocusBar — показываем над вопросом */}
        <div className="mb-3 sm:hidden">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-0.5 text-small font-semibold text-white dark:ring-1 dark:ring-inset dark:ring-border-strong">
            <Diamond />
            {t('quiz.runner.officialChip')}
          </span>
        </div>

        {view === 'review' ? (
          <SubmitReview
            questions={questions.map((qq, i) => ({ id: qq.id, prompt: qq.prompt, answered: navItems[i]!.answered, flagged: navItems[i]!.flagged }))}
            onJump={go}
          />
        ) : (
          <div key={q.id}>
            <div className="text-label text-fg-2">{t('quiz.questionOf', { n: idx + 1, total })}</div>
            <h2 id={promptId} className="mt-1.5 font-sans text-title tracking-normal text-fg">
              {q.prompt}
            </h2>
            <p id={instrId} className="mb-4 mt-1.5 text-body text-fg-2">
              {t(`quiz.instruction.${q.type === 'TRUE_FALSE' ? 'TRUE_FALSE' : 'SINGLE_CHOICE'}`)}
            </p>
            <OptionGroup
              mode="official"
              options={q.options}
              selected={answers[q.id] ?? []}
              onChange={(ids2) => choose(q.id, ids2)}
              labelledBy={promptId}
              describedBy={instrId}
              disabled={submitting}
            />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                aria-pressed={isFlagged}
                onClick={toggleFlag}
                className={clsx(
                  'inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors',
                  isFlagged ? 'border-brand bg-brand-soft text-brand' : 'border-border bg-card text-fg-2 hover:border-brand/50 hover:text-fg',
                )}
              >
                <Icon name="flag" size={16} fill={isFlagged ? 'currentColor' : 'none'} />
                {t('quiz.runner.flag')}
              </button>
              <ReportIssueButton targetType="QUIZ_QUESTION" targetId={q.id} context="OFFICIAL" enrollmentId={enrollmentId} />
            </div>
            <p className="mt-4 hidden text-small text-fg-2 sm:block">{t('quiz.kbdHint')}</p>
          </div>
        )}
      </QuestionShell>

      <ConfirmDialog
        open={exitOpen}
        title={t('quiz.runner.exitTitle')}
        body={t('quiz.runner.exitBody')}
        confirmLabel={t('quiz.runner.exit')}
        cancelLabel={t('quiz.runner.stay')}
        onConfirm={confirmExit}
        onCancel={() => setExitOpen(false)}
      />
      {/* Подтверждение отправки: длинные подписи кнопок (особенно kk) — кнопки столбиком */}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        busy={submitting}
        size="sm"
        title={t('quiz.submit.confirmTitle')}
        description={
          <>
            <span className="block">
              {attemptsLeftAfter > 0 ? t('quiz.submit.confirmBody', { left: attemptsLeftAfter }) : t('quiz.submit.confirmBodyLast')}
            </span>
            {answeredCount < total && <span className="mt-1.5 block">{t('quiz.submit.confirmUnanswered')}</span>}
          </>
        }
        footer={
          <div className="flex w-full flex-col gap-2">
            <Button className="w-full" onClick={() => void doSubmit()} loading={submitting} data-autofocus>
              {t('quiz.submit.confirm')}
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              {t('quiz.submit.cancel')}
            </Button>
          </div>
        }
      />
    </>
  );
}
