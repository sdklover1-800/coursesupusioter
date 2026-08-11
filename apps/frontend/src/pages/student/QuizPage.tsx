import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { api, ApiError } from '../../lib/api';
import { Badge, Button, Card, toast } from '../../components/ui';
import { LoadingRows, MeterBar } from '../../components/page';

interface Question { id: string; type: 'SINGLE_CHOICE' | 'TRUE_FALSE'; prompt: string; options: string[]; difficulty: string }
interface Quiz { id: string; title: string; passThreshold: number; maxAttempts: number; attemptsUsed: number; questions: Question[] }
interface PracticeResult { isCorrect: boolean; correctOptionIds: number[]; explanation: string | null }
interface ReviewItem { questionId: string; isCorrect: boolean; correctOptionIds: number[]; explanation: string | null }
interface AttemptResult { attempt: { score: number; passed: boolean; correctCount: number; total: number }; review: ReviewItem[] }

type Mode = 'select' | 'practice' | 'official' | 'result';

/**
 * Интерактивный тест (FR-5.3–5.5).
 * Два режима: «Тренировка» (мгновенная обратная связь, не оценивается) и
 * «Официальная попытка» (строго, серверная проверка). После официальной —
 * богатый разбор всех вопросов с пояснениями.
 */
export function QuizPage() {
  const { t } = useTranslation();
  const { quizId, enrollmentId, courseId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('select');

  const { data, isLoading } = useQuery({
    queryKey: ['quiz', quizId, enrollmentId],
    queryFn: () => api.get<{ quiz: Quiz }>(`/quizzes/${quizId}?enrollmentId=${enrollmentId}`),
  });

  if (isLoading || !data) return <LoadingRows rows={4} />;
  const quiz = data.quiz;
  const attemptsLeft = quiz.maxAttempts - quiz.attemptsUsed;

  return (
    <div className="mx-auto max-w-2xl">
      <button onClick={() => navigate(`/learn/${courseId}/${enrollmentId}`)} className="mb-4 text-sm text-muted hover:text-fg">← {t('common.back')}</button>
      <h1 className="mb-1 text-2xl font-semibold">{quiz.title}</h1>
      <div className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Badge tone="muted">{quiz.questions.length} {t('quiz.question').toLowerCase()}</Badge>
        <Badge tone="muted">{t('quiz.passThreshold')} {Math.round(quiz.passThreshold * 100)}%</Badge>
      </div>

      {mode === 'select' && <ModeSelect quiz={quiz} attemptsLeft={attemptsLeft} onPractice={() => setMode('practice')} onOfficial={() => setMode('official')} />}
      {mode === 'practice' && <PracticeRunner quiz={quiz} enrollmentId={enrollmentId!} onExit={() => setMode('select')} />}
      {mode === 'official' && (
        <OfficialRunner
          quiz={quiz}
          enrollmentId={enrollmentId!}
          onResult={() => {
            // M7: обновляем attemptsUsed и прогресс курса после официальной попытки
            qc.invalidateQueries({ queryKey: ['quiz', quizId, enrollmentId] });
            qc.invalidateQueries({ queryKey: ['learn', courseId, enrollmentId] });
            setMode('result');
          }}
          storeKey={`result-${quizId}`}
        />
      )}
      {mode === 'result' && <ResultView quiz={quiz} storeKey={`result-${quizId}`} onRetry={() => setMode('select')} onDone={() => navigate(`/learn/${courseId}/${enrollmentId}`)} />}
    </div>
  );
}

/* ── Выбор режима ── */
function ModeSelect({ quiz, attemptsLeft, onPractice, onOfficial }: { quiz: Quiz; attemptsLeft: number; onPractice: () => void; onOfficial: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card className="flex flex-col">
        <Badge tone="spark" className="w-fit">{t('quiz.practiceBadge')}</Badge>
        <h3 className="mt-3 text-lg font-semibold">{t('quiz.practiceMode')}</h3>
        <p className="mt-1 flex-1 text-sm text-muted">{t('quiz.practiceDesc')}</p>
        <Button variant="secondary" className="mt-4" onClick={onPractice}>{t('quiz.startPractice')}</Button>
      </Card>
      <Card className="flex flex-col border-brand/30">
        <Badge tone="brand" className="w-fit">{t('quiz.officialBadge')}</Badge>
        <h3 className="mt-3 text-lg font-semibold">{t('quiz.officialMode')}</h3>
        <p className="mt-1 flex-1 text-sm text-muted">{t('quiz.officialDesc')}</p>
        <div className="mt-3 font-mono text-xs text-muted">{t('quiz.attemptsLeft', { n: attemptsLeft })}</div>
        <Button className="mt-2" disabled={attemptsLeft <= 0} onClick={onOfficial}>
          {attemptsLeft > 0 ? t('quiz.startOfficial') : t('quiz.noAttempts')}
        </Button>
      </Card>
    </div>
  );
}

/* ── Тренировка: мгновенная обратная связь ── */
function PracticeRunner({ quiz, enrollmentId, onExit }: { quiz: Quiz; enrollmentId: string; onExit: () => void }) {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [feedback, setFeedback] = useState<PracticeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const q = quiz.questions[idx]!;

  async function check() {
    setLoading(true);
    try {
      const res = await api.post<PracticeResult>(`/quizzes/${quiz.id}/practice`, { enrollmentId, questionId: q.id, selectedOptionIds: selected });
      setFeedback(res);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger'); // M7
    } finally {
      setLoading(false);
    }
  }
  function next() {
    setFeedback(null);
    setSelected([]);
    if (idx + 1 < quiz.questions.length) setIdx(idx + 1);
    else onExit();
  }

  return (
    <Card>
      <div className="mb-4"><MeterBar value={(idx + 1) / quiz.questions.length} tone="spark" /></div>
      <div className="mb-1 font-mono text-xs text-muted">{t('quiz.practiceBadge')} · {idx + 1} {t('common.of')} {quiz.questions.length}</div>
      <QuestionBody q={q} selected={selected} onSelect={setSelected} feedback={feedback} disabled={!!feedback} />

      {feedback && (
        <div className={clsx('mt-4 animate-fade-up rounded-xl px-4 py-3 text-sm', feedback.isCorrect ? 'bg-teal/12 text-teal' : 'bg-danger/10 text-danger')}>
          <div className="font-semibold">{feedback.isCorrect ? `✓ ${t('quiz.correct')}` : `✗ ${t('quiz.incorrect')}`}</div>
          {feedback.explanation && <div className="mt-1 text-fg/80">{t('quiz.explanation')}: {feedback.explanation}</div>}
        </div>
      )}

      <div className="mt-5 flex justify-between">
        <Button variant="ghost" onClick={onExit}>{t('common.back')}</Button>
        {!feedback ? (
          <Button variant="spark" disabled={!selected.length} loading={loading} onClick={check}>{t('quiz.check')}</Button>
        ) : (
          <Button onClick={next}>{idx + 1 < quiz.questions.length ? t('quiz.nextQuestion') : t('common.close')}</Button>
        )}
      </div>
    </Card>
  );
}

/* ── Официальная попытка: без подсказок ── */
function OfficialRunner({ quiz, enrollmentId, onResult, storeKey }: { quiz: Quiz; enrollmentId: string; onResult: () => void; storeKey: string }) {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(false);
  const q = quiz.questions[idx]!;
  const answeredCount = Object.values(answers).filter((a) => a.length).length;
  const isLast = idx + 1 === quiz.questions.length;

  async function submit() {
    if (!confirm(t('quiz.confirmSubmit'))) return;
    setLoading(true);
    try {
      const res = await api.post<AttemptResult>(`/quizzes/${quiz.id}/attempts`, { enrollmentId, answers });
      sessionStorage.setItem(storeKey, JSON.stringify(res));
      onResult();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger'); // M7
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <div className="mb-4"><MeterBar value={(idx + 1) / quiz.questions.length} /></div>
      <div className="mb-1 flex items-center justify-between font-mono text-xs text-muted">
        <span>{t('quiz.officialBadge')} · {idx + 1} {t('common.of')} {quiz.questions.length}</span>
        <span>{t('quiz.answeredOf', { answered: answeredCount, total: quiz.questions.length })}</span>
      </div>
      <QuestionBody q={q} selected={answers[q.id] ?? []} onSelect={(s) => setAnswers({ ...answers, [q.id]: s })} />

      <div className="mt-5 flex items-center justify-between">
        <Button variant="ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>← {t('common.prev')}</Button>
        {!isLast ? (
          <Button onClick={() => setIdx(idx + 1)}>{t('common.next')} →</Button>
        ) : (
          <Button variant="primary" loading={loading} onClick={submit}>{t('quiz.submitOfficial')}</Button>
        )}
      </div>
    </Card>
  );
}

/* ── Разбор после официальной попытки ── */
function ResultView({ quiz, storeKey, onRetry, onDone }: { quiz: Quiz; storeKey: string; onRetry: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const result = useMemo<AttemptResult | null>(() => {
    const raw = sessionStorage.getItem(storeKey);
    return raw ? (JSON.parse(raw) as AttemptResult) : null;
  }, [storeKey]);
  if (!result) return null;
  const byId = new Map(result.review.map((r) => [r.questionId, r]));
  const { attempt } = result;

  return (
    <div className="space-y-5">
      <Card className={clsx('text-center', attempt.passed ? 'border-teal/40' : 'border-danger/30')}>
        <div className={clsx('mx-auto grid h-16 w-16 place-items-center rounded-full text-3xl', attempt.passed ? 'bg-teal/15 text-teal' : 'bg-danger/10 text-danger')}>
          {attempt.passed ? '✓' : '✗'}
        </div>
        <h2 className="mt-3 text-2xl font-semibold">{attempt.passed ? t('quiz.passed') : t('quiz.failed')}</h2>
        <div className="mt-2 font-mono text-3xl font-bold tabular-nums">{Math.round(attempt.score * 100)}%</div>
        <div className="mt-1 text-sm text-muted">{t('quiz.correctCount', { correct: attempt.correctCount, total: attempt.total })}</div>
      </Card>

      <div>
        <div className="mb-3 font-mono text-xs font-semibold uppercase tracking-wider text-brand">{t('quiz.reviewTitle')}</div>
        <div className="space-y-3">
          {quiz.questions.map((q, i) => {
            const r = byId.get(q.id);
            return (
              <Card key={q.id} className={clsx('!p-4', r?.isCorrect ? 'border-teal/30' : 'border-danger/25')}>
                <div className="flex gap-2">
                  <span className={clsx('font-mono text-sm font-bold', r?.isCorrect ? 'text-teal' : 'text-danger')}>{r?.isCorrect ? '✓' : '✗'}</span>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{i + 1}. {q.prompt}</div>
                    <div className="mt-2 space-y-1">
                      {q.options.map((opt, oi) => (
                        <div key={oi} className={clsx('rounded-lg px-3 py-1.5 text-sm', r?.correctOptionIds.includes(oi) ? 'bg-teal/12 text-teal font-medium' : 'text-muted')}>
                          {r?.correctOptionIds.includes(oi) && '✓ '}{opt}
                        </div>
                      ))}
                    </div>
                    {r?.explanation && <div className="mt-2 text-xs text-muted">{t('quiz.explanation')}: {r.explanation}</div>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      <div className="flex justify-between">
        <Button variant="secondary" onClick={onRetry}>{t('quiz.tryAgain')}</Button>
        <Button onClick={onDone}>{t('quiz.finishReview')}</Button>
      </div>
    </div>
  );
}

/* ── Тело вопроса с вариантами ── */
function QuestionBody({ q, selected, onSelect, feedback, disabled }: { q: Question; selected: number[]; onSelect: (s: number[]) => void; feedback?: PracticeResult | null; disabled?: boolean }) {
  return (
    <div>
      <h3 className="text-lg font-semibold leading-snug">{q.prompt}</h3>
      <div className="mt-4 space-y-2">
        {q.options.map((opt, oi) => {
          const isSelected = selected.includes(oi);
          const isCorrect = feedback?.correctOptionIds.includes(oi);
          const showWrong = feedback && isSelected && !isCorrect;
          return (
            <button
              key={oi}
              disabled={disabled}
              onClick={() => onSelect([oi])}
              className={clsx(
                'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-all',
                'disabled:cursor-default',
                feedback && isCorrect ? 'border-teal bg-teal/10' :
                showWrong ? 'border-danger bg-danger/8' :
                isSelected ? 'border-brand bg-brand-soft' : 'border-border bg-card hover:border-brand/40',
              )}
            >
              <span className={clsx('grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-bold',
                isSelected ? 'border-brand bg-brand text-white' : 'border-border text-muted')}>
                {String.fromCharCode(65 + oi)}
              </span>
              <span className="flex-1">{opt}</span>
              {feedback && isCorrect && <span className="text-teal">✓</span>}
              {showWrong && <span className="text-danger">✗</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
