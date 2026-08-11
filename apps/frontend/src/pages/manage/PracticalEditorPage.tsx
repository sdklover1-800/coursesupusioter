import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Difficulty } from '@edu/shared';
import { api } from '../../lib/api';
import { Button, Input, Select, Textarea, Field, Card, Badge, toast } from '../../components/ui';
import { PageHeader, LoadingRows, ErrorState } from '../../components/page';

interface RubricSpec {
  key_points: string[];
  answer_reached_criteria: string;
}

interface PracticalTask {
  id: string;
  title: string;
  scenarioPrompt: string;
  referenceSolution: string;
  rubricSpec: RubricSpec;
  difficulty: string;
  tokenBudget: number;
  maxAiMessages: number;
  isAIGenerated: boolean;
  isEdited: boolean;
}

interface FormState {
  title: string;
  scenarioPrompt: string;
  referenceSolution: string;
  keyPoints: string[];
  answerCriteria: string;
  difficulty: string;
  tokenBudget: number;
  maxAiMessages: number;
}

/** Редактор практического задания со СКРЫТЫМ эталоном/рубрикой (FR-7.3, §5.3). */
export function PracticalEditorPage() {
  const { t } = useTranslation();
  const { taskId } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['ptask', taskId],
    queryFn: () => api.get<{ task: PracticalTask }>(`/practical-tasks/${taskId}`),
  });

  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    const task = data?.task;
    if (!task) return;
    setForm({
      title: task.title,
      scenarioPrompt: task.scenarioPrompt,
      referenceSolution: task.referenceSolution,
      keyPoints: task.rubricSpec?.key_points ?? [],
      answerCriteria: task.rubricSpec?.answer_reached_criteria ?? '',
      difficulty: task.difficulty,
      tokenBudget: task.tokenBudget,
      maxAiMessages: task.maxAiMessages,
    });
  }, [data]);

  const set = <K extends keyof FormState,>(key: K, value: FormState[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const save = useMutation({
    mutationFn: () => {
      if (!form) throw new Error(t('errors.generic'));
      return api.patch(`/practical-tasks/${taskId}`, {
        title: form.title,
        scenarioPrompt: form.scenarioPrompt,
        referenceSolution: form.referenceSolution,
        rubricSpec: {
          key_points: form.keyPoints.map((k) => k.trim()).filter(Boolean),
          answer_reached_criteria: form.answerCriteria,
        },
        difficulty: form.difficulty,
        tokenBudget: form.tokenBudget,
        maxAiMessages: form.maxAiMessages,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ptask', taskId] });
      toast(t('common.success'));
    },
    onError: (err: Error) => toast(err.message, 'danger'),
  });

  const regenerate = useMutation({
    mutationFn: () => api.post(`/practical-tasks/${taskId}/regenerate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ptask', taskId] });
      toast(t('common.success'));
    },
    onError: (err: Error) => toast(err.message, 'danger'),
  });

  if (isLoading) return <LoadingRows rows={5} />;
  if (isError || !data) return <ErrorState message={t('errors.notFound')} />;
  if (!form) return <LoadingRows rows={5} />;

  const task = data.task;

  return (
    <div className="mx-auto max-w-3xl">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 text-sm text-muted hover:text-fg"
      >
        ← {t('common.back')}
      </button>

      <PageHeader
        eyebrow={t('manager.practical')}
        title={t('manager.practicalEditor')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              loading={regenerate.isPending}
              disabled={save.isPending}
              onClick={() => regenerate.mutate()}
            >
              ↻ {t('manager.regenerate')}
            </Button>
            <Button
              loading={save.isPending}
              disabled={regenerate.isPending}
              onClick={() => save.mutate()}
            >
              {t('common.save')}
            </Button>
          </div>
        }
      />

      {(task.isAIGenerated || task.isEdited) && (
        <div className="mb-6 flex flex-wrap gap-2">
          {task.isAIGenerated && <Badge tone="brand">{t('manager.aiGenerated')}</Badge>}
          {task.isEdited && <Badge tone="spark">{t('manager.edited')}</Badge>}
        </div>
      )}

      <div className="space-y-6">
        {/* Видимая студенту часть задания */}
        <Card className="space-y-5">
          <Field label={t('manager.courseTitle')}>
            <Input value={form.title} onChange={(e) => set('title', e.target.value)} />
          </Field>

          <Field label={t('manager.scenario')} hint={t('practical.socraticNote')}>
            <Textarea
              rows={5}
              value={form.scenarioPrompt}
              onChange={(e) => set('scenarioPrompt', e.target.value)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('manager.difficulty')}>
              <Select value={form.difficulty} onChange={(e) => set('difficulty', e.target.value)}>
                {Object.values(Difficulty).map((d) => (
                  <option key={d} value={d}>{t(`difficulty.${d}`)}</option>
                ))}
              </Select>
            </Field>

            <Field label={t('manager.tokenBudget')}>
              <Input
                type="number"
                min={0}
                className="font-mono tabular-nums"
                value={form.tokenBudget}
                onChange={(e) => set('tokenBudget', Number.isNaN(e.target.valueAsNumber) ? 0 : e.target.valueAsNumber)}
              />
            </Field>

            <Field label={t('manager.maxMessages')}>
              <Input
                type="number"
                min={0}
                className="font-mono tabular-nums"
                value={form.maxAiMessages}
                onChange={(e) => set('maxAiMessages', Number.isNaN(e.target.valueAsNumber) ? 0 : e.target.valueAsNumber)}
              />
            </Field>
          </div>
        </Card>

        {/* СКРЫТО ОТ СТУДЕНТА: эталон + рубрика (FR-7.3, §5.3) */}
        <Card className="space-y-5 border-danger/40 bg-spark/8">
          <div className="flex items-center gap-2">
            <Badge tone="danger">⦸ {t('manager.hiddenFromStudent')}</Badge>
            <span className="text-sm font-semibold text-fg">{t('manager.rubric')}</span>
          </div>

          <Field label={t('manager.referenceSolution')}>
            <Textarea
              rows={4}
              value={form.referenceSolution}
              onChange={(e) => set('referenceSolution', e.target.value)}
            />
          </Field>

          <div className="space-y-2">
            <span className="text-sm font-semibold text-fg">{t('manager.keyPoints')}</span>
            <div className="space-y-2">
              {form.keyPoints.map((kp, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-muted tabular-nums">{i + 1}</span>
                  <Input
                    className="flex-1"
                    value={kp}
                    onChange={(e) => set('keyPoints', form.keyPoints.map((v, idx) => (idx === i ? e.target.value : v)))}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('common.delete')}
                    onClick={() => set('keyPoints', form.keyPoints.filter((_, idx) => idx !== i))}
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => set('keyPoints', [...form.keyPoints, ''])}
            >
              + {t('common.add')}
            </Button>
          </div>

          <Field label={t('manager.answerCriteria')}>
            <Textarea
              rows={3}
              value={form.answerCriteria}
              onChange={(e) => set('answerCriteria', e.target.value)}
            />
          </Field>
        </Card>
      </div>
    </div>
  );
}
