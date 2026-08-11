import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { LANGUAGES, AssessmentType, PublishStatus, JobStatus, GenerationType, RegenStrategy } from '@edu/shared';
import { api, ApiError } from '../../lib/api';
import { Badge, Button, Card, Field, Input, Select, Textarea, Spinner, toast } from '../../components/ui';
import { PageHeader, LoadingRows, EmptyState, ErrorState } from '../../components/page';

/* ── Модель данных ──────────────────────────────────────── */
interface Lecture {
  id: string;
  title: string;
  youtubeVideoId: string | null;
  transcriptText: string | null;
  orderIndex: number;
}
interface Module {
  id: string;
  title: string;
  orderIndex: number;
  assessmentType: string;
  coversWholeCourse: boolean;
  lectures: Lecture[];
  quiz: { id: string } | null;
  practicalTask: { id: string; title: string; difficulty: string } | null;
}
interface LanguageVersion {
  id: string;
  language: string;
  title: string;
  description: string | null;
  status: string;
  modules: Module[];
}
interface Course {
  id: string;
  defaultLanguage: string;
  status: string;
  languageVersions: LanguageVersion[];
}
interface GenerationJob {
  status: string;
  result: unknown;
  error: string | null;
}

const statusTone: Record<string, 'muted' | 'teal' | 'danger'> = {
  DRAFT: 'muted',
  PUBLISHED: 'teal',
  ARCHIVED: 'danger',
};

/** Редактор курса: языковые версии, модули, лекции, генерация, публикация (§4.2–4.4, FR-2.*, FR-7.1). */
export function CourseEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [expandedLectureId, setExpandedLectureId] = useState<string | null>(null);
  const [addingLanguage, setAddingLanguage] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [publishProblems, setPublishProblems] = useState<string[] | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['course', id],
    queryFn: () => api.get<{ course: Course }>(`/courses/${id}`),
  });

  const course = data?.course;
  const versions = course?.languageVersions ?? [];
  const activeVersion = versions.find((v) => v.id === selectedVersionId) ?? versions[0];
  const usedLanguages = versions.map((v) => v.language);
  const availableLanguages = LANGUAGES.filter((l) => !usedLanguages.includes(l));

  /* ── Опрос фоновой задачи генерации (FR-7.1) ── */
  const jobQuery = useQuery({
    queryKey: ['genjob', jobId],
    queryFn: () => api.get<{ job: GenerationJob }>(`/generation-jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const s = q.state.data?.job.status;
      return s === JobStatus.QUEUED || s === JobStatus.RUNNING ? 2000 : false;
    },
  });
  const jobStatus = jobQuery.data?.job.status;
  const generating = jobStatus === JobStatus.QUEUED || jobStatus === JobStatus.RUNNING;

  useEffect(() => {
    if (!jobId || !jobStatus) return;
    if (jobStatus === JobStatus.DONE) {
      qc.invalidateQueries({ queryKey: ['course', id] });
      toast(t('manager.generationDone'));
      setJobId(null);
    } else if (jobStatus === JobStatus.ERROR) {
      toast(jobQuery.data?.job.error || t('manager.generationError'), 'danger');
      setJobId(null);
    }
  }, [jobStatus, jobId, id, qc, t, jobQuery.data?.job.error]);

  /* ── Мутации версии ── */
  const generate = useMutation({
    mutationFn: () =>
      api.post<{ jobId: string }>(`/language-versions/${activeVersion?.id}/generate`, {
        type: GenerationType.ALL,
        regenStrategy: RegenStrategy.KEEP,
      }),
    onSuccess: (res) => setJobId(res.jobId),
    onError: (err: unknown) => toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger'),
  });

  const publish = useMutation({
    mutationFn: () => api.post(`/language-versions/${activeVersion?.id}/publish`),
    onSuccess: () => {
      setPublishProblems(null);
      qc.invalidateQueries({ queryKey: ['course', id] });
      toast(t('common.success'));
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 422) {
        const problems = (err.details as { problems?: string[] } | null | undefined)?.problems;
        if (problems?.length) {
          setPublishProblems(problems);
          return;
        }
      }
      toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger');
    },
  });

  const unpublish = useMutation({
    mutationFn: () => api.post(`/language-versions/${activeVersion?.id}/unpublish`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course', id] });
      toast(t('common.success'));
    },
    onError: (err: unknown) => toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger'),
  });

  if (isLoading) return <LoadingRows rows={6} />;
  if (isError || !course) return <ErrorState message={error instanceof ApiError ? error.message : t('errors.notFound')} />;
  if (!activeVersion) return <ErrorState message={t('errors.notFound')} />;

  const primaryVersion = versions.find((v) => v.language === course.defaultLanguage) ?? versions[0];
  const courseTitle = primaryVersion?.title || t('manager.courses');
  const isPublished = activeVersion.status === PublishStatus.PUBLISHED;
  const modules = [...activeVersion.modules].sort((a, b) => a.orderIndex - b.orderIndex);

  return (
    <>
      <button onClick={() => navigate('/manage/courses')} className="mb-4 text-sm text-muted hover:text-fg">
        ← {t('common.back')}
      </button>

      <PageHeader eyebrow={t('manager.editor')} title={courseTitle} subtitle={activeVersion.description ?? undefined} />

      {/* ── Табы языковых версий ── */}
      <div className="mb-4 flex flex-wrap gap-2">
        {versions.map((v) => (
          <button
            key={v.id}
            onClick={() => {
              setSelectedVersionId(v.id);
              setExpandedLectureId(null);
              setPublishProblems(null);
            }}
            className={clsx(
              'inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors',
              v.id === activeVersion.id ? 'border-brand bg-brand-soft text-brand' : 'border-border bg-card text-muted hover:border-brand/40',
            )}
          >
            {t(`languages.${v.language}`)}
            <Badge tone={statusTone[v.status] ?? 'muted'}>{t(`status.${v.status}`)}</Badge>
          </button>
        ))}
        {availableLanguages.length > 0 && (
          <button
            onClick={() => setAddingLanguage((s) => !s)}
            className={clsx(
              'inline-flex items-center gap-2 rounded-xl border border-dashed px-4 py-2 text-sm font-semibold transition-colors',
              addingLanguage ? 'border-brand text-brand' : 'border-border text-muted hover:border-brand/40',
            )}
          >
            + {t('manager.addLanguage')}
          </button>
        )}
      </div>

      {addingLanguage && availableLanguages.length > 0 && (
        <AddLanguageForm
          courseId={course.id}
          available={availableLanguages}
          copyFromId={versions[0]?.id}
          onDone={() => setAddingLanguage(false)}
        />
      )}

      {/* ── Панель действий версии ── */}
      <Card className="mb-6 !py-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={statusTone[activeVersion.status] ?? 'muted'}>
            {t('common.status')}: {t(`status.${activeVersion.status}`)}
          </Badge>
          {generating && (
            <Badge tone={jobStatus === JobStatus.RUNNING ? 'brand' : 'muted'}>
              {jobStatus === JobStatus.RUNNING && <Spinner className="h-3 w-3" />}
              {jobStatus === JobStatus.RUNNING ? t('manager.generationRunning') : t('manager.generationQueued')}
            </Badge>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setPreviewOpen(true)}>
              {t('manager.preview')}
            </Button>
            <Button variant="spark" loading={generate.isPending || generating} onClick={() => generate.mutate()}>
              {t('manager.generateMaterials')}
            </Button>
            {isPublished ? (
              <Button variant="secondary" loading={unpublish.isPending} onClick={() => unpublish.mutate()}>
                {t('common.unpublish')}
              </Button>
            ) : (
              <Button loading={publish.isPending} onClick={() => publish.mutate()}>
                {t('common.publish')}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {previewOpen && <PreviewModal versionId={activeVersion.id} onClose={() => setPreviewOpen(false)} />}

      {/* ── Проблемы для публикации (422) ── */}
      {publishProblems && publishProblems.length > 0 && (
        <Card className="mb-6 border-danger/40">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-semibold text-danger">⚠ {t('manager.publishProblems')}</div>
            <button onClick={() => setPublishProblems(null)} className="text-sm text-muted hover:text-fg">
              {t('common.close')}
            </button>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg/80">
            {publishProblems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── Модули ── */}
      {modules.length === 0 ? (
        <EmptyState
          title={t('manager.modules')}
          hint={t('manager.useDefault')}
          action={
            <Button variant="spark" loading={generate.isPending || generating} onClick={() => generate.mutate()}>
              {t('manager.generateMaterials')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {modules.map((m, i) => (
            <ModuleCard
              key={m.id}
              module={m}
              index={i}
              expandedLectureId={expandedLectureId}
              onToggleLecture={(lid) => setExpandedLectureId((cur) => (cur === lid ? null : lid))}
            />
          ))}
        </div>
      )}
    </>
  );
}

/* ── Форма добавления языковой версии ──────────────────── */
function AddLanguageForm({
  courseId,
  available,
  copyFromId,
  onDone,
}: {
  courseId: string;
  available: readonly string[];
  copyFromId: string | undefined;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [language, setLanguage] = useState(available[0] ?? '');
  const [title, setTitle] = useState('');

  const add = useMutation({
    mutationFn: () =>
      api.post(`/courses/${courseId}/language-versions`, {
        language,
        title: title.trim(),
        copyStructureFrom: copyFromId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course', courseId] });
      toast(t('common.success'));
      onDone();
    },
    onError: (err: unknown) => toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger'),
  });

  const canSubmit = !!language && title.trim().length > 0 && !add.isPending;

  return (
    <Card className="mb-4">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) add.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('common.language')}>
            <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {available.map((l) => (
                <option key={l} value={l}>
                  {t(`languages.${l}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('manager.courseTitle')}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('manager.courseTitle')} autoFocus />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={add.isPending} disabled={!canSubmit}>
            {t('common.add')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ── Карточка модуля ────────────────────────────────────── */
function ModuleCard({
  module,
  index,
  expandedLectureId,
  onToggleLecture,
}: {
  module: Module;
  index: number;
  expandedLectureId: string | null;
  onToggleLecture: (lectureId: string) => void;
}) {
  const { t } = useTranslation();
  const isPractical = module.assessmentType === AssessmentType.PRACTICAL;
  const lectures = [...module.lectures].sort((a, b) => a.orderIndex - b.orderIndex);

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-soft font-mono text-sm font-bold text-brand">{index + 1}</span>
        <h3 className="text-lg font-semibold">{module.title}</h3>
        <Badge tone={isPractical ? 'spark' : 'brand'} className="ml-auto">
          {isPractical ? t('manager.practical') : t('manager.quiz')}
        </Badge>
      </div>

      {/* Лекции (инлайн-редактирование) */}
      <div className="divide-y divide-border">
        {lectures.map((l, li) => (
          <div key={l.id}>
            <button
              onClick={() => onToggleLecture(l.id)}
              className="flex w-full items-center gap-3 py-3 text-left text-sm transition-colors hover:text-brand"
            >
              <span className="font-mono text-xs text-muted tabular-nums">{li + 1}</span>
              <span className="flex-1 font-medium">{l.title}</span>
              <span className="text-muted">{expandedLectureId === l.id ? '▾' : '▸'}</span>
            </button>
            {expandedLectureId === l.id && <LectureEditor lecture={l} />}
          </div>
        ))}
      </div>

      {/* Ссылки на редакторы оценивания */}
      <div className="mt-4 flex flex-wrap gap-2">
        {module.quiz && (
          <Link
            to={`/manage/quiz/${module.quiz.id}`}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold hover:border-brand/50"
          >
            <span className="text-brand">◆</span>
            {t('manager.quizEditor')}
          </Link>
        )}
        {module.practicalTask && (
          <Link
            to={`/manage/practical/${module.practicalTask.id}`}
            className="inline-flex items-center gap-2 rounded-xl border border-spark/40 bg-spark/5 px-4 py-2 text-sm font-semibold hover:border-spark"
          >
            <span className="grid h-5 w-5 place-items-center rounded-full bg-spark font-display text-xs font-bold text-ink">?</span>
            {t('manager.practicalEditor')}
            <Badge tone="muted">{t(`difficulty.${module.practicalTask.difficulty}`)}</Badge>
          </Link>
        )}
      </div>
    </Card>
  );
}

/* ── Инлайн-редактор лекции ─────────────────────────────── */
function LectureEditor({ lecture }: { lecture: Lecture }) {
  const { t } = useTranslation();
  const { id } = useParams();
  const qc = useQueryClient();

  const [title, setTitle] = useState(lecture.title);
  const [youtubeUrl, setYoutubeUrl] = useState(lecture.youtubeVideoId ? `https://youtu.be/${lecture.youtubeVideoId}` : '');
  const [transcriptText, setTranscriptText] = useState(lecture.transcriptText ?? '');

  const save = useMutation({
    mutationFn: () => api.patch(`/lectures/${lecture.id}`, { title: title.trim(), youtubeUrl: youtubeUrl.trim(), transcriptText }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course', id] });
      toast(t('common.success'));
    },
    onError: (err: unknown) => toast(err instanceof ApiError ? err.message : t('errors.generic'), 'danger'),
  });

  return (
    <div className="space-y-4 border-l-2 border-brand/30 py-4 pl-4">
      <Field label={t('manager.lecture')}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('manager.lecture')} />
      </Field>
      <Field label={t('manager.youtubeUrl')}>
        <Input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
      </Field>
      <Field label={t('manager.transcript')}>
        <Textarea rows={5} value={transcriptText} onChange={(e) => setTranscriptText(e.target.value)} placeholder={t('manager.transcript')} />
      </Field>
      <div className="flex justify-end">
        <Button size="sm" loading={save.isPending} disabled={!title.trim()} onClick={() => save.mutate()}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

/* ── L11: реальный предпросмотр «глазами студента» (FR-2.8) ── */
interface PreviewData {
  version: {
    id: string;
    title: string;
    language: string;
    modules: {
      id: string;
      title: string;
      orderIndex: number;
      assessmentType: string;
      lectures: { id: string; title: string; youtubeVideoId: string; transcriptText: string }[];
      quiz: { id: string; title: string; questions: { id: string; prompt: string; type: string; options: string[]; correctOptionIds: number[] }[] } | null;
      practicalTask: { id: string; title: string; scenarioPrompt: string; difficulty: string } | null;
    }[];
  };
}

function PreviewModal({ versionId, onClose }: { versionId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['preview', versionId],
    queryFn: () => api.get<PreviewData>(`/language-versions/${versionId}/preview`),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="my-8 w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <div className="font-mono text-xs font-semibold uppercase tracking-wider text-brand">{t('manager.preview')}</div>
            <button onClick={onClose} className="text-muted hover:text-fg" aria-label={t('common.close')}>✕</button>
          </div>
          {isLoading || !data ? (
            <LoadingRows rows={4} />
          ) : (
            <>
              <h2 className="text-xl font-semibold">{data.version.title}</h2>
              <div className="mt-4 space-y-4">
                {data.version.modules.map((m, i) => (
                  <div key={m.id} className="rounded-xl border border-border p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand-soft font-mono text-xs font-bold text-brand">{i + 1}</span>
                      <span className="font-semibold">{m.title}</span>
                      <Badge tone={m.assessmentType === 'PRACTICAL' ? 'spark' : 'brand'} className="ml-auto">
                        {m.assessmentType === 'PRACTICAL' ? t('manager.practical') : t('manager.quiz')}
                      </Badge>
                    </div>
                    <ul className="ml-8 list-disc space-y-1 text-sm text-muted">
                      {m.lectures.map((l) => (
                        <li key={l.id}>
                          {l.title} {l.youtubeVideoId ? '▶' : <span className="text-danger">({t('lecture.noVideo')})</span>}
                        </li>
                      ))}
                    </ul>
                    {m.quiz && (
                      <div className="mt-3 rounded-lg bg-surface px-3 py-2 text-sm">
                        <div className="font-semibold text-brand">◆ {m.quiz.title} · {m.quiz.questions.length} {t('quiz.question').toLowerCase()}</div>
                      </div>
                    )}
                    {m.practicalTask && (
                      <div className="mt-3 rounded-lg bg-spark/5 px-3 py-2 text-sm">
                        <div className="font-semibold">? {m.practicalTask.title}</div>
                        <div className="mt-1 text-muted">{m.practicalTask.scenarioPrompt}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          <Button className="mt-6 w-full" onClick={onClose}>{t('common.close')}</Button>
        </Card>
      </div>
    </div>
  );
}
