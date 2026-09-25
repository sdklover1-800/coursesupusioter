import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Difficulty } from '@edu/shared';
import {
  apiErrorMessage, findPracticalPlace, romanNumeral, useCourseDetail, usePracticalPatch, usePracticalRegenerate,
  usePracticalTask, type PracticalPatch, type PracticalTaskEdit,
} from '../../lib/staff';
import { authorshipTone, RUBRIC_ORDER, rubricTone, toneClasses } from '../../lib/tones';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import {
  Badge, Breadcrumb, Button, Card, ConfirmDialog, Field, Input, QuestionGlyph, Select, toast, type Crumb,
} from '../../components/ui';
import { Icon } from '../../components/icons';
import { PageHeader, LoadingRows, ErrorState } from '../../components/page';
import { AutoTextarea, MetaChip, Notice, SectionTitle } from '../../components/staff/primitives';
import { LeaveGuard, SaveBar } from '../../components/staff/SaveBar';

interface Draft {
  title: string;
  scenarioPrompt: string;
  referenceSolution: string;
  keyPoints: string[];
  answerCriteria: string;
  agenda: string[];
  introMessage: string;
  estimatedMinutes: string;
  maxAiMessages: string;
  maxSessions: string;
  difficulty: string;
  tokenBudget: string;
}

const draftOf = (task: PracticalTaskEdit): Draft => ({
  title: task.title,
  scenarioPrompt: task.scenarioPrompt,
  referenceSolution: task.referenceSolution,
  keyPoints: task.rubricSpec?.key_points?.length ? [...task.rubricSpec.key_points] : [''],
  answerCriteria: task.rubricSpec?.answer_reached_criteria ?? '',
  agenda: [0, 1, 2].map((i) => task.agenda?.[i] ?? ''),
  introMessage: task.introMessage ?? '',
  estimatedMinutes: task.estimatedMinutes === null ? '' : String(task.estimatedMinutes),
  maxAiMessages: String(task.maxAiMessages),
  maxSessions: String(task.maxSessions),
  difficulty: task.difficulty,
  tokenBudget: String(task.tokenBudget),
});

type Errors = Partial<Record<'title' | 'scenarioPrompt' | 'referenceSolution' | 'keyPoints' | 'answerCriteria' | 'agenda' | 'estimatedMinutes' | 'maxAiMessages' | 'maxSessions' | 'tokenBudget', true>>;

const intIn = (raw: string, min: number, max: number) => /^\d+$/.test(raw.trim()) && Number(raw) >= min && Number(raw) <= max;
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Патч только изменённых полей + проверка (правила PATCH /practical-tasks/:id). */
function buildPatch(task: PracticalTaskEdit, d: Draft): { patch: PracticalPatch; errors: Errors } {
  const base = draftOf(task);
  const errors: Errors = {};
  const patch: PracticalPatch = {};
  if (!d.title.trim()) errors.title = true;
  else if (d.title.trim() !== base.title.trim()) patch.title = d.title.trim();
  if (!d.scenarioPrompt.trim()) errors.scenarioPrompt = true;
  else if (d.scenarioPrompt !== base.scenarioPrompt) patch.scenarioPrompt = d.scenarioPrompt;
  if (!d.referenceSolution.trim()) errors.referenceSolution = true;
  else if (d.referenceSolution !== base.referenceSolution) patch.referenceSolution = d.referenceSolution;

  const kp = d.keyPoints.map((k) => k.trim()).filter(Boolean);
  if (!kp.length) errors.keyPoints = true;
  if (!d.answerCriteria.trim()) errors.answerCriteria = true;
  if (!errors.keyPoints && !errors.answerCriteria && (!sameList(kp, base.keyPoints.map((k) => k.trim()).filter(Boolean)) || d.answerCriteria.trim() !== base.answerCriteria.trim())) {
    patch.rubricSpec = { key_points: kp, answer_reached_criteria: d.answerCriteria.trim() };
  }

  const agenda = d.agenda.map((a) => a.trim()).filter(Boolean);
  if (agenda.some((a) => a.length > 120)) errors.agenda = true;
  else if (!sameList(agenda, base.agenda.map((a) => a.trim()).filter(Boolean))) patch.agenda = agenda;

  if (d.introMessage.trim() !== base.introMessage.trim()) patch.introMessage = d.introMessage.trim() || null;
  if (d.estimatedMinutes.trim() && !intIn(d.estimatedMinutes, 1, 600)) errors.estimatedMinutes = true;
  else if (d.estimatedMinutes.trim() !== base.estimatedMinutes) patch.estimatedMinutes = d.estimatedMinutes.trim() ? Number(d.estimatedMinutes) : null;
  if (!intIn(d.maxAiMessages, 1, 100)) errors.maxAiMessages = true;
  else if (Number(d.maxAiMessages) !== task.maxAiMessages) patch.maxAiMessages = Number(d.maxAiMessages);
  if (!intIn(d.maxSessions, 1, 5)) errors.maxSessions = true;
  else if (Number(d.maxSessions) !== task.maxSessions) patch.maxSessions = Number(d.maxSessions);
  if (!intIn(d.tokenBudget, 1, 10_000_000)) errors.tokenBudget = true;
  else if (Number(d.tokenBudget) !== task.tokenBudget) patch.tokenBudget = Number(d.tokenBudget);
  if (d.difficulty !== base.difficulty) patch.difficulty = d.difficulty;
  return { patch, errors };
}

/**
 * Редактор практического задания (FR-7.3, §5.3; FE5 §3): видимая студенту часть
 * (сценарий, план беседы, первая реплика, лимиты), СКРЫТЫЙ эталон и ключевые тезисы,
 * рубрика 0–3 (только чтение), «Как это увидит студент». Канонический сценарий
 * (canonicalRef) не перегенерируется; правки — с предупреждением о синхронности языков.
 */
export function PracticalEditorPage() {
  const { t } = useTranslation();
  const { taskId } = useParams();
  const [params] = useSearchParams();
  const { data, isLoading, isError, error } = usePracticalTask(taskId);
  const task = data?.task;
  const course = useCourseDetail(params.get('course'));
  const place = useMemo(() => (task ? findPracticalPlace(course.data?.course, task.id) : null), [course.data, task]);
  const language = place?.version.language;
  const save = usePracticalPatch(taskId);
  const regenerate = usePracticalRegenerate(taskId);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [regenOpen, setRegenOpen] = useState(false);
  useDocumentTitle(task ? `${task.title} · ${t('manager.practicalEditor')}` : t('manager.practicalEditor'));

  const crumbs: Crumb[] = [{ label: t('manager.courses'), to: '/manage/courses' }];
  if (place) {
    crumbs.push({ label: place.version.title, to: `/manage/courses/${place.course.id}?version=${place.version.id}` });
    crumbs.push({ label: t('manager.qe.placeModule', { roman: romanNumeral(place.module.orderIndex) }) });
  }
  crumbs.push({ label: t('manager.pt.crumb') });

  if (isLoading) return <><Breadcrumb items={crumbs} className="mb-3" /><LoadingRows rows={5} /></>;
  if (isError || !task) return <><Breadcrumb items={crumbs} className="mb-3" /><ErrorState message={apiErrorMessage(error, t)} /></>;

  const d = draft ?? draftOf(task);
  const { patch, errors } = buildPatch(task, d);
  const dirtyFields = Object.keys(patch);
  const dirty = dirtyFields.length > 0;
  const hasErrors = Object.keys(errors).length > 0;
  const canonical = !!task.canonicalRef;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...d, [k]: v });
  const sessions = task.sessionCount ?? 0;

  function doSave() {
    if (hasErrors) {
      toast(t('manager.save.fixErrors'), 'danger');
      return;
    }
    save.mutate(patch, {
      onSuccess: () => {
        setDraft(null);
        toast(t('manager.pt.saved'), 'teal');
      },
      onError: (err) => toast(apiErrorMessage(err, t), 'danger'),
    });
  }

  const err = (k: keyof Errors, msg: string) => (errors[k] ? msg : undefined);

  return (
    <>
      <Breadcrumb items={crumbs} className="mb-3" />
      <PageHeader
        eyebrow={t('manager.pt.eyebrow')}
        title={task.title}
        action={
          <Button
            variant="secondary"
            onClick={() => setRegenOpen(true)}
            disabled={canonical || regenerate.isPending}
            title={canonical ? t('manager.pt.regenLocked') : undefined}
          >
            <Icon name="refresh" size={18} />
            {t('manager.regenerate')}
          </Button>
        }
      />
      <div className="-mt-3 mb-6 flex flex-wrap items-center gap-2">
        {canonical && <MetaChip icon="globe" tone="brand">{t('manager.pt.canonicalBadge')}</MetaChip>}
        {task.isAIGenerated && <Badge tone={authorshipTone.ai}>{t('manager.aiGenerated')}</Badge>}
        {task.isEdited && <Badge tone={authorshipTone.edited}>{t('manager.edited')}</Badge>}
        <span className="text-meta text-fg-2">{t('manager.pt.sessions', { count: sessions })}</span>
      </div>

      {canonical && (
        <Notice tone="brand" icon="lock" className="mb-4" title={t('manager.pt.canonicalTitle', { ref: task.canonicalRef })}>
          {t('manager.pt.regenLocked')}
        </Notice>
      )}
      {canonical && dirty && (
        <Notice tone="spark" icon="alert" className="mb-4">
          {t('manager.pt.canonicalEditWarning')}
        </Notice>
      )}
      {sessions > 0 && (
        <Notice tone="muted" icon="info" className="mb-6">
          {t('manager.pt.snapshotNote')}
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          {/* Видимая студенту часть */}
          <Card className="space-y-5 !p-4 sm:!p-6">
            <SectionTitle hint={t('manager.pt.visibleHint')}>{t('manager.pt.visibleTitle')}</SectionTitle>
            <Field label={t('manager.pt.title')} error={err('title', t('manager.pt.errRequired'))}>
              <Input lang={language} value={d.title} onChange={(e) => set('title', e.target.value)} />
            </Field>
            <Field label={t('manager.pt.scenario')} hint={t('manager.pt.scenarioHint')} error={err('scenarioPrompt', t('manager.pt.errRequired'))}>
              <AutoTextarea lang={language} minRows={5} maxHeight={640} value={d.scenarioPrompt} onChange={(e) => set('scenarioPrompt', e.target.value)} />
            </Field>
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold text-fg">{t('manager.pt.agenda')}</legend>
              <p className="mb-2 text-small text-fg-2">{t('manager.pt.agendaHint')}</p>
              <ol className="space-y-2">
                {d.agenda.map((a, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="num w-5 shrink-0 text-fg-2">{i + 1}</span>
                    <Input
                      lang={language}
                      value={a}
                      maxLength={120}
                      onChange={(e) => set('agenda', d.agenda.map((x, idx) => (idx === i ? e.target.value : x)))}
                      aria-label={t('manager.pt.agendaItem', { n: i + 1 })}
                    />
                  </li>
                ))}
              </ol>
              {errors.agenda && <p className="mt-1 text-small font-medium text-danger-ink">{t('manager.pt.errAgenda')}</p>}
            </fieldset>
            <Field label={t('manager.pt.intro')} hint={t('manager.pt.introHint')}>
              <AutoTextarea lang={language} minRows={2} maxLength={4000} value={d.introMessage} onChange={(e) => set('introMessage', e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={t('manager.pt.minutes')} hint={t('manager.pt.minutesHint')} error={err('estimatedMinutes', t('manager.pt.errMinutes'))}>
                <Input inputMode="numeric" value={d.estimatedMinutes} onChange={(e) => set('estimatedMinutes', e.target.value)} className="font-mono tabular-nums" />
              </Field>
              <Field label={t('manager.pt.maxAi')} hint={t('manager.pt.maxAiHint')} error={err('maxAiMessages', t('manager.pt.errMaxAi'))}>
                <Input inputMode="numeric" value={d.maxAiMessages} onChange={(e) => set('maxAiMessages', e.target.value)} className="font-mono tabular-nums" />
              </Field>
              <Field label={t('manager.pt.maxSessions')} hint={t('manager.pt.maxSessionsHint')} error={err('maxSessions', t('manager.pt.errMaxSessions'))}>
                <Input inputMode="numeric" value={d.maxSessions} onChange={(e) => set('maxSessions', e.target.value)} className="font-mono tabular-nums" />
              </Field>
              <Field label={t('manager.difficulty')}>
                <Select value={d.difficulty} onChange={(e) => set('difficulty', e.target.value)}>
                  {Object.values(Difficulty).map((x) => (
                    <option key={x} value={x}>{t(`difficulty.${x}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('manager.tokenBudget')} hint={t('manager.pt.tokenHint')} error={err('tokenBudget', t('manager.pt.errToken'))}>
                <Input inputMode="numeric" value={d.tokenBudget} onChange={(e) => set('tokenBudget', e.target.value)} className="font-mono tabular-nums" />
              </Field>
            </div>
          </Card>

          {/* СКРЫТО ОТ СТУДЕНТА: эталон и ключевые тезисы (FR-7.3, §5.3) */}
          <section className="space-y-5 rounded-2xl border border-danger/35 bg-danger/8 p-4 sm:p-6" aria-labelledby="pt-hidden">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 id="pt-hidden" className="text-title">{t('manager.pt.hiddenTitle')}</h2>
                <p className="mt-0.5 text-meta text-fg-2">{t('manager.pt.hiddenHint')}</p>
              </div>
              <Badge tone="danger">
                <Icon name="lock" size={14} />
                {t('manager.hiddenFromStudent')}
              </Badge>
            </div>
            <Field label={t('manager.referenceSolution')} error={err('referenceSolution', t('manager.pt.errRequired'))}>
              <AutoTextarea lang={language} minRows={4} maxHeight={640} value={d.referenceSolution} onChange={(e) => set('referenceSolution', e.target.value)} className="bg-card" />
            </Field>
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold text-fg">{t('manager.keyPoints')}</legend>
              <p className="mb-2 text-small text-fg-2">{t('manager.pt.keyPointsHint')}</p>
              <ol className="space-y-2">
                {d.keyPoints.map((kp, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="num mt-2.5 w-7 shrink-0 text-fg-2">K{i + 1}</span>
                    <AutoTextarea
                      lang={language}
                      minRows={1}
                      value={kp}
                      onChange={(e) => set('keyPoints', d.keyPoints.map((v, idx) => (idx === i ? e.target.value : v)))}
                      aria-label={t('manager.pt.keyPointN', { n: i + 1 })}
                      className="bg-card"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1 !px-2 text-fg-2"
                      disabled={d.keyPoints.length <= 1}
                      aria-label={t('manager.pt.removeKeyPoint', { n: i + 1 })}
                      onClick={() => set('keyPoints', d.keyPoints.filter((_, idx) => idx !== i))}
                    >
                      <Icon name="x" size={16} />
                    </Button>
                  </li>
                ))}
              </ol>
              {errors.keyPoints && <p className="mt-1 text-small font-medium text-danger-ink">{t('manager.pt.errKeyPoints')}</p>}
              <Button variant="secondary" size="sm" className="mt-2" onClick={() => set('keyPoints', [...d.keyPoints, ''])}>
                <Icon name="plus" size={16} />
                {t('manager.pt.addKeyPoint')}
              </Button>
            </fieldset>
            <Field label={t('manager.answerCriteria')} error={err('answerCriteria', t('manager.pt.errRequired'))}>
              <AutoTextarea lang={language} minRows={2} value={d.answerCriteria} onChange={(e) => set('answerCriteria', e.target.value)} className="bg-card" />
            </Field>
          </section>

          <RubricCard />
        </div>

        <aside className="min-w-0 xl:sticky xl:top-20 xl:self-start" aria-labelledby="pt-preview">
          <StudentPreview draft={d} language={language} />
        </aside>
      </div>

      <SaveBar count={dirtyFields.length} saving={save.isPending} onSave={doSave} onDiscard={() => setDraft(null)} hint={t('manager.pt.unsaved', { count: dirtyFields.length })} />
      <LeaveGuard when={dirty && !save.isPending} />

      <ConfirmDialog
        open={regenOpen}
        title={t('manager.pt.regenTitle')}
        body={t('manager.pt.regenBody')}
        confirmLabel={t('manager.regenerate')}
        tone="danger"
        busy={regenerate.isPending}
        onCancel={() => setRegenOpen(false)}
        onConfirm={() =>
          regenerate.mutate(undefined, {
            onSuccess: () => {
              setDraft(null);
              setRegenOpen(false);
              toast(t('manager.pt.regenerated'), 'teal');
            },
            onError: (e) => {
              setRegenOpen(false);
              toast(apiErrorMessage(e, t), 'danger');
            },
          })
        }
      />
    </>
  );
}

/** Рубрика хода рассуждений (0–3, только чтение): измерения судьи с фиксированными цветами. */
function RubricCard() {
  const { t } = useTranslation();
  return (
    <Card className="!p-4 sm:!p-6">
      <SectionTitle hint={t('manager.pt.rubricHint')}>{t('manager.pt.rubricTitle')}</SectionTitle>
      <ul className="space-y-4">
        {RUBRIC_ORDER.map((k) => (
          <li key={k}>
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${toneClasses[rubricTone[k]].fill}`} aria-hidden />
              <span className="font-semibold text-fg">{t(`ui.rubric.${k}`)}</span>
            </div>
            <p className="mt-0.5 text-body text-fg-2">{t(`manager.pt.rubricDesc.${k}`)}</p>
          </li>
        ))}
      </ul>
      <div className="mt-5 overflow-x-auto">
        <ol className="grid min-w-[30rem] grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((n) => (
            <li key={n} className="rounded-lg border border-border bg-surface px-3 py-2">
              <div className="num text-fg">{n}</div>
              <div className="text-small text-fg-2">{t(`manager.pt.anchor.${n}`)}</div>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

/** «Как это увидит студент»: упрощённый бриф (локально, без компонентов FE4). */
function StudentPreview({ draft, language }: { draft: Draft; language?: string }) {
  const { t } = useTranslation();
  const agenda = draft.agenda.map((a) => a.trim()).filter(Boolean);
  const meta = [
    draft.estimatedMinutes.trim() ? t('manager.pt.previewMinutes', { count: Number(draft.estimatedMinutes) }) : null,
    t('manager.pt.previewReplies', { count: Number(draft.maxAiMessages) || 0 }),
    t('manager.pt.previewAttempts', { count: Number(draft.maxSessions) || 0 }),
  ].filter(Boolean);
  return (
    <Card className="!p-4 sm:!p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon name="eye" size={18} className="text-fg-2" />
        <h2 id="pt-preview" className="text-sm font-semibold text-fg">{t('manager.pt.previewTitle')}</h2>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4" lang={language}>
        <div className="eyebrow">{t('manager.pt.previewEyebrow')}</div>
        <h3 className="mt-1 text-title">{draft.title || '—'}</h3>
        <p className="mt-1 text-meta text-fg-2">{meta.join(' · ')}</p>
        <p className="mt-3 line-clamp-[12] whitespace-pre-line text-body text-fg">{draft.scenarioPrompt}</p>
        {agenda.length > 0 && (
          <div className="mt-4">
            <div className="text-sm font-semibold text-fg">{t('manager.pt.previewAgenda')}</div>
            <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-body text-fg">
              {agenda.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ol>
          </div>
        )}
        {draft.introMessage.trim() && (
          <div className="mt-4 flex items-start gap-2.5">
            <QuestionGlyph size={28} />
            <p className="min-w-0 flex-1 whitespace-pre-line rounded-xl rounded-tl-sm border border-border bg-card px-3 py-2 text-body text-fg">{draft.introMessage}</p>
          </div>
        )}
      </div>
      <p className="mt-2 text-small text-fg-2">{t('manager.pt.previewNote')}</p>
    </Card>
  );
}
