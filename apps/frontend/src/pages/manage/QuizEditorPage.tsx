import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Difficulty, QuestionType } from '@edu/shared';
import { api } from '../../lib/api';
import { Badge, Button, Card, Field, Input, Select, Textarea, toast } from '../../components/ui';
import { PageHeader, LoadingRows, EmptyState, ErrorState } from '../../components/page';

interface EditQuestion {
  id: string;
  type: string;
  prompt: string;
  options: string[];
  correctOptionIds: number[];
  explanation: string;
  difficulty: string;
  isAIGenerated: boolean;
  isEdited: boolean;
  orderIndex: number;
}

interface QuizEditData {
  quiz: {
    id: string;
    title: string;
    passThreshold: number;
    maxAttempts: number;
    questions: EditQuestion[];
  };
}

const fail = (e: Error) => toast(e.message, 'danger');

/** Глубокое редактирование теста: настройки + вопросы (FR-7.3). */
export function QuizEditorPage() {
  const { t } = useTranslation();
  const { quizId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['quiz-edit', quizId],
    queryFn: () => api.get<QuizEditData>(`/quizzes/${quizId}/edit`),
    enabled: !!quizId,
  });

  const addQuestion = useMutation({
    mutationFn: () =>
      api.post(`/quizzes/${quizId}/questions`, {
        type: QuestionType.SINGLE_CHOICE,
        prompt: 'Новый вопрос',
        options: ['A', 'B'],
        correctOptionIds: [0],
        difficulty: Difficulty.MEDIUM,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quiz-edit', quizId] });
      toast(t('common.success'));
    },
    onError: fail,
  });

  const header = (
    <PageHeader
      title={t('manager.quizEditor')}
      action={
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => navigate(-1)}>{t('common.back')}</Button>
          <Button variant="spark" onClick={() => addQuestion.mutate()} loading={addQuestion.isPending}>
            {t('manager.addQuestion')}
          </Button>
        </div>
      }
    />
  );

  if (isLoading) return <>{header}<LoadingRows rows={5} /></>;
  if (isError || !data) return <>{header}<ErrorState message={t('errors.generic')} /></>;

  const { quiz } = data;

  return (
    <>
      {header}

      <SettingsCard quiz={quiz} quizId={quiz.id} />

      {quiz.questions.length === 0 ? (
        <EmptyState
          title={t('common.empty')}
          action={
            <Button variant="spark" onClick={() => addQuestion.mutate()} loading={addQuestion.isPending}>
              {t('manager.addQuestion')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {quiz.questions.map((q, i) => (
            <QuestionCard key={q.id} question={q} quizId={quiz.id} index={i} />
          ))}
        </div>
      )}
    </>
  );
}

/* ── Настройки теста ────────────────────────────────────── */
function SettingsCard({ quiz, quizId }: { quiz: QuizEditData['quiz']; quizId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [title, setTitle] = useState(quiz.title);
  const [passThreshold, setPassThreshold] = useState(String(quiz.passThreshold));
  const [maxAttempts, setMaxAttempts] = useState(String(quiz.maxAttempts));

  const sig = JSON.stringify([quiz.title, quiz.passThreshold, quiz.maxAttempts]);
  const [seen, setSeen] = useState(sig);
  useEffect(() => {
    if (sig !== seen) {
      setTitle(quiz.title);
      setPassThreshold(String(quiz.passThreshold));
      setMaxAttempts(String(quiz.maxAttempts));
      setSeen(sig);
    }
  }, [sig, seen, quiz.title, quiz.passThreshold, quiz.maxAttempts]);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/quizzes/${quizId}`, {
        title,
        passThreshold: Number(passThreshold),
        maxAttempts: Number(maxAttempts),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quiz-edit', quizId] });
      toast(t('common.success'));
    },
    onError: fail,
  });

  return (
    <Card className="mb-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label={t('quiz.title')}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
        <Field label={t('quiz.passThreshold')} hint="0 – 1">
          <Input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={passThreshold}
            onChange={(e) => setPassThreshold(e.target.value)}
            className="font-mono tabular-nums"
          />
        </Field>
        <Field label={t('quiz.attempts')}>
          <Input
            type="number"
            min={1}
            step={1}
            value={maxAttempts}
            onChange={(e) => setMaxAttempts(e.target.value)}
            className="font-mono tabular-nums"
          />
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={() => save.mutate()} loading={save.isPending}>{t('common.save')}</Button>
      </div>
    </Card>
  );
}

/* ── Карточка вопроса ───────────────────────────────────── */
function QuestionCard({ question, quizId, index }: { question: EditQuestion; quizId: string; index: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [type, setType] = useState(question.type);
  const [prompt, setPrompt] = useState(question.prompt);
  const [options, setOptions] = useState<string[]>(question.options);
  const [correct, setCorrect] = useState<number>(question.correctOptionIds[0] ?? 0);
  const [difficulty, setDifficulty] = useState(question.difficulty);
  const [explanation, setExplanation] = useState(question.explanation ?? '');

  // Ресинхронизация локальной формы, когда серверные данные изменились
  // (перегенерация / сохранение), но без затирания правок других вопросов.
  const sig = JSON.stringify([
    question.type, question.prompt, question.options,
    question.correctOptionIds, question.difficulty, question.explanation,
  ]);
  const [seen, setSeen] = useState(sig);
  useEffect(() => {
    if (sig !== seen) {
      setType(question.type);
      setPrompt(question.prompt);
      setOptions(question.options);
      setCorrect(question.correctOptionIds[0] ?? 0);
      setDifficulty(question.difficulty);
      setExplanation(question.explanation ?? '');
      setSeen(sig);
    }
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const isTF = type === QuestionType.TRUE_FALSE;
  const invalidTF = isTF && options.length !== 2;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['quiz-edit', quizId] });

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/quiz-questions/${question.id}`, {
        type, prompt, options, correctOptionIds: [correct], explanation, difficulty,
      }),
    onSuccess: () => { invalidate(); toast(t('common.success')); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/quiz-questions/${question.id}`),
    onSuccess: () => { invalidate(); toast(t('common.success')); },
    onError: fail,
  });
  const regenerate = useMutation({
    mutationFn: () => api.post(`/quiz-questions/${question.id}/regenerate`),
    onSuccess: () => { invalidate(); toast(t('common.success')); },
    onError: fail,
  });

  function changeType(next: string) {
    setType(next);
    if (next === QuestionType.TRUE_FALSE) {
      setOptions((o) => (o.length === 2 ? o : [t('quiz.trueLabel'), t('quiz.falseLabel')]));
      setCorrect((c) => (c > 1 ? 0 : c));
    }
  }
  function setOpt(i: number, val: string) {
    setOptions((o) => o.map((x, idx) => (idx === i ? val : x)));
  }
  function addOpt() {
    setOptions((o) => [...o, '']);
  }
  function removeOpt(i: number) {
    setOptions((o) => o.filter((_, idx) => idx !== i));
    setCorrect((c) => (c === i ? 0 : c > i ? c - 1 : c));
  }

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-soft font-mono text-sm font-bold text-brand">
          {index + 1}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {question.isAIGenerated && <Badge tone="spark">{t('manager.aiGenerated')}</Badge>}
          {question.isEdited && <Badge tone="teal">{t('manager.edited')}</Badge>}
        </div>
      </div>

      <div className="space-y-4">
        <Field label={t('manager.questionText')}>
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('manager.assessmentType')}>
            <Select value={type} onChange={(e) => changeType(e.target.value)}>
              <option value={QuestionType.SINGLE_CHOICE}>{t('manager.options')}</option>
              <option value={QuestionType.TRUE_FALSE}>{t('quiz.trueLabel')} / {t('quiz.falseLabel')}</option>
            </Select>
          </Field>
          <Field label={t('manager.difficulty')}>
            <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              {Object.values(Difficulty).map((d) => (
                <option key={d} value={d}>{t(`difficulty.${d}`)}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-fg">{t('manager.options')}</span>
            <span className="text-xs text-muted">{t('manager.correctAnswer')}</span>
          </div>
          <div className="space-y-2">
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`correct-${question.id}`}
                  checked={correct === i}
                  onChange={() => setCorrect(i)}
                  className="h-4 w-4 shrink-0 accent-brand"
                  aria-label={t('manager.correctAnswer')}
                />
                <Input value={opt} onChange={(e) => setOpt(i, e.target.value)} className="flex-1" />
                {!isTF && options.length > 2 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeOpt(i)}
                    aria-label={t('common.delete')}
                    className="!px-2 text-muted"
                  >
                    ×
                  </Button>
                )}
              </div>
            ))}
          </div>
          {!isTF && (
            <Button variant="secondary" size="sm" onClick={addOpt} className="mt-2">
              + {t('common.add')}
            </Button>
          )}
        </div>

        <Field label={t('quiz.explanation')}>
          <Textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} />
        </Field>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={invalidTF}>
          {t('common.save')}
        </Button>
        <Button variant="secondary" onClick={() => regenerate.mutate()} loading={regenerate.isPending}>
          {t('manager.regenerateQuestion')}
        </Button>
        <Button variant="danger" onClick={() => remove.mutate()} loading={remove.isPending} className="ml-auto">
          {t('common.delete')}
        </Button>
      </div>
    </Card>
  );
}
