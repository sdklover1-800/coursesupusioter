import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { api, ApiError } from '../lib/api';
import { Badge, Button, Card, toast } from '../components/ui';

/**
 * Мини-квиз — тренировочное закрепление материала (retrieval practice).
 * НЕ оценивается: не создаёт попыток, не влияет на прогресс и не попадает в
 * оценочную телеметрию (валидность исследования). Обратная связь мгновенная.
 */

interface Question { id: string; type: string; prompt: string; options: string[]; difficulty: string }
interface MiniQuizData { id: string; title: string; kind: string; isGraded: boolean; questions: Question[] }
interface CheckResult { isCorrect: boolean; correctOptionIds: number[]; explanation: string | null }

export function MiniQuiz({ url, enrollmentId }: { url: string; enrollmentId: string }) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['mini-quiz', url, enrollmentId],
    queryFn: () => api.get<{ quiz: MiniQuizData | null }>(`${url}?enrollmentId=${enrollmentId}`),
  });

  const quiz = data?.quiz ?? null;
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [feedback, setFeedback] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);

  if (isLoading || !quiz || quiz.questions.length === 0) return null;

  const q = quiz.questions[idx]!;
  const isLast = idx + 1 === quiz.questions.length;

  async function check() {
    setChecking(true);
    try {
      const res = await api.post<CheckResult>(`/quizzes/${quiz!.id}/practice`, {
        enrollmentId,
        questionId: q.id,
        selectedOptionIds: selected,
      });
      setFeedback(res);
      if (res.isCorrect) setCorrectCount((c) => c + 1);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger');
    } finally {
      setChecking(false);
    }
  }

  function next() {
    setFeedback(null);
    setSelected([]);
    if (isLast) setFinished(true);
    else setIdx(idx + 1);
  }

  function restart() {
    setIdx(0); setSelected([]); setFeedback(null); setCorrectCount(0); setFinished(false);
  }

  if (finished) {
    return (
      <Card className="border-spark/40">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-spark/15 text-lg text-spark">✦</span>
          <div className="flex-1">
            <div className="font-semibold">{t('quiz.miniDone')}</div>
            <div className="font-mono text-sm tabular-nums text-muted">
              {t('quiz.correctCount', { correct: correctCount, total: quiz.questions.length })}
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={restart}>{t('quiz.tryAgain')}</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-spark/30">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone="spark">{t('quiz.miniQuiz')}</Badge>
        <span className="text-xs text-muted">{t('quiz.notGradedHint')}</span>
        <span className="ml-auto font-mono text-xs tabular-nums text-muted">
          {idx + 1} {t('common.of')} {quiz.questions.length}
        </span>
      </div>

      <h4 className="text-base font-semibold leading-snug">{q.prompt}</h4>

      <div className="mt-3 space-y-2">
        {q.options.map((opt, oi) => {
          const isSelected = selected.includes(oi);
          const isCorrect = feedback?.correctOptionIds.includes(oi);
          const showWrong = feedback && isSelected && !isCorrect;
          return (
            <button
              key={oi}
              disabled={!!feedback}
              onClick={() => setSelected([oi])}
              className={clsx(
                'flex w-full items-center gap-3 rounded-xl border px-4 py-2.5 text-left text-sm transition-all disabled:cursor-default',
                feedback && isCorrect
                  ? 'border-teal bg-teal/10'
                  : showWrong
                    ? 'border-danger bg-danger/8'
                    : isSelected
                      ? 'border-brand bg-brand-soft'
                      : 'border-border bg-card hover:border-brand/40',
              )}
            >
              <span
                className={clsx(
                  'grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-bold',
                  isSelected ? 'border-brand bg-brand text-white' : 'border-border text-muted',
                )}
              >
                {String.fromCharCode(65 + oi)}
              </span>
              <span className="flex-1">{opt}</span>
              {feedback && isCorrect && <span className="text-teal">✓</span>}
              {showWrong && <span className="text-danger">✗</span>}
            </button>
          );
        })}
      </div>

      {feedback && (
        <div
          className={clsx(
            'mt-3 animate-fade-up rounded-xl px-4 py-3 text-sm',
            feedback.isCorrect ? 'bg-teal/12 text-teal' : 'bg-danger/10 text-danger',
          )}
        >
          <div className="font-semibold">{feedback.isCorrect ? `✓ ${t('quiz.correct')}` : `✗ ${t('quiz.incorrect')}`}</div>
          {feedback.explanation && <div className="mt-1 text-fg/80">{t('quiz.explanation')}: {feedback.explanation}</div>}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        {!feedback ? (
          <Button variant="spark" size="sm" disabled={!selected.length} loading={checking} onClick={check}>
            {t('quiz.check')}
          </Button>
        ) : (
          <Button size="sm" onClick={next}>{isLast ? t('common.close') : t('quiz.nextQuestion')}</Button>
        )}
      </div>
    </Card>
  );
}
