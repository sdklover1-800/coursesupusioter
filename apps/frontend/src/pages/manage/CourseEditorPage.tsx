import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { LANGUAGES, PublishStatus } from '@edu/shared';
import { api, ApiError } from '../../lib/api';
import {
  admittedCount, apiErrorMessage, lectureNumbers, romanNumeral, sortedModules, useAddLecture, useCourseDetail,
  useCourseEnrollments, useDeleteLecture, useGenerate, useGenerationJob, usePublishVersion, useRenameModule,
  useUnpublishVersion, useVersionPreview, type GenerationJob, type GenerationKind, type GenerationStrategy, type StaffCourse,
  type StaffLecture, type StaffModule, type StaffVersion,
} from '../../lib/staff';
import { publishStatusTone } from '../../lib/tones';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import {
  Badge, Breadcrumb, Button, Card, ConfirmDialog, Dialog, Field, Input, ModeBadge, Select, Spinner, Tabs, toast,
} from '../../components/ui';
import { Icon } from '../../components/icons';
import { PageHeader, LoadingRows, EmptyState, ErrorState } from '../../components/page';
import { HealthChips } from '../../components/staff/HealthChips';
import { LectureSheet } from '../../components/staff/LectureSheet';
import { GenerateDialog } from '../../components/staff/GenerateDialog';
import { MetaChip, Notice } from '../../components/staff/primitives';
import { lectureDisplayTitle, moduleDisplayTitle } from '../../components/lecture/lectureUtils';

const LANG_ORDER = LANGUAGES as readonly string[];

/** Иконка статуса версии во вкладке (цвет дублируется глифом и скрытым текстом). */
function VersionStatusGlyph({ status }: { status: string }) {
  const { t } = useTranslation();
  const icon = status === PublishStatus.PUBLISHED ? 'check' : status === PublishStatus.ARCHIVED ? 'history' : 'pencil';
  const cls = status === PublishStatus.PUBLISHED ? 'text-teal-ink' : 'text-fg-2';
  return (
    <span className="relative inline-flex">
      <Icon name={icon} size={16} className={cls} />
      <span className="sr-only">{t(`status.${status}`)}</span>
    </span>
  );
}

/**
 * Редактор курса (§4.2–4.4, FR-2.*, FR-7.1; FE5 §1): языковые версии со статусами,
 * «здоровье» контента (блокеры, предупреждения, экспертная проверка), модули с
 * переименованием, лекции со сквозной нумерацией и чипами, лист редактора лекции,
 * безопасная генерация и публикация (ConfirmDialog), «Структура курса».
 */
export function CourseEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useCourseDetail(id);
  const course = data?.course;
  const versions = useMemo(() => {
    const list = [...(course?.languageVersions ?? [])];
    return list.sort((a, b) => {
      if (a.language === course?.defaultLanguage) return -1;
      if (b.language === course?.defaultLanguage) return 1;
      return LANG_ORDER.indexOf(a.language) - LANG_ORDER.indexOf(b.language);
    });
  }, [course]);
  const requestedVersion = params.get('version');
  const requestedLecture = params.get('lecture');
  const lectureVersion = requestedLecture
    ? versions.find((v) => v.modules.some((m) => m.lectures.some((l) => l.id === requestedLecture)))
    : undefined;
  const active = versions.find((v) => v.id === requestedVersion) ?? lectureVersion ?? versions[0];

  const primary = versions[0];
  const courseTitle = primary?.title || t('manager.courses');
  useDocumentTitle(course ? t('manager.editorTitle', { title: courseTitle }) : t('manager.editor'));

  const enrollments = useCourseEnrollments(id);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useGenerationJob(jobId);
  const jobStatus = job.data?.job.status;
  const generating = !!jobId && (jobStatus === undefined || jobStatus === 'QUEUED' || jobStatus === 'RUNNING');

  const generate = useGenerate();
  const publish = usePublishVersion(id);
  const unpublish = useUnpublishVersion(id);

  const [genOpen, setGenOpen] = useState(false);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const [structureOpen, setStructureOpen] = useState(false);
  const [addLangOpen, setAddLangOpen] = useState(false);
  const [publishProblems, setPublishProblems] = useState<string[] | null>(null);
  const [sheet, setSheet] = useState<{ lectureId: string; focus: 'duration' | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ lecture: StaffLecture; number: number } | null>(null);

  // Лекция из ссылки (?lecture= — «Открыть в редакторе» во входящих жалобах)
  useEffect(() => {
    if (requestedLecture && lectureVersion) setSheet({ lectureId: requestedLecture, focus: null });
  }, [requestedLecture, lectureVersion?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!jobId || !jobStatus) return;
    if (jobStatus === 'DONE') {
      void qc.invalidateQueries({ queryKey: ['course', id] });
      toast(generationSummary(job.data?.job, t), 'teal', { duration: 8000 });
      setJobId(null);
    } else if (jobStatus === 'ERROR') {
      toast(job.data?.job.error || t('manager.generationError'), 'danger');
      setJobId(null);
    }
  }, [jobStatus, jobId, id, qc, t, job.data?.job]);

  function selectVersion(versionId: string) {
    const n = new URLSearchParams(params);
    n.set('version', versionId);
    n.delete('lecture');
    setParams(n, { replace: true });
    setPublishProblems(null);
  }

  function closeSheet() {
    setSheet(null);
    if (params.get('lecture')) {
      const n = new URLSearchParams(params);
      n.delete('lecture');
      setParams(n, { replace: true });
    }
  }

  if (isLoading) return <LoadingRows rows={6} />;
  if (isError || !course) return <ErrorState message={error instanceof ApiError && error.status < 500 ? error.message : t('errors.notFound')} />;

  const crumbs = [{ label: t('manager.courses'), to: '/manage/courses' }, { label: courseTitle }];

  if (!active) {
    return (
      <>
        <Breadcrumb items={crumbs} className="mb-3" />
        <PageHeader eyebrow={t('manager.editor')} title={courseTitle} />
        <EmptyState title={t('manager.noVersions')} action={<Button onClick={() => setAddLangOpen(true)}>{t('manager.addLanguage')}</Button>} />
        <AddLanguageDialog open={addLangOpen} course={course} onClose={() => setAddLangOpen(false)} />
      </>
    );
  }

  const isPublished = active.status === PublishStatus.PUBLISHED;
  const modules = sortedModules(active);
  const numbers = lectureNumbers(active);
  const lectureCount = modules.reduce((s, m) => s + m.lectures.length, 0);
  const admitted = admittedCount(enrollments.data?.items, active.id);
  const usedLanguages = versions.map((v) => v.language);
  const canAddLanguage = LANG_ORDER.some((l) => !usedLanguages.includes(l));
  const sheetLecture = sheet ? active.modules.flatMap((m) => m.lectures).find((l) => l.id === sheet.lectureId) ?? null : null;
  const problems = publishProblems ?? active.problems;

  function startGeneration(p: { type: GenerationKind; regenStrategy: GenerationStrategy }) {
    generate.mutate(
      { versionId: active!.id, ...p },
      {
        onSuccess: (res) => {
          setGenOpen(false);
          setJobId(res.jobId);
          toast(t('manager.gen.started'), 'brand');
        },
        onError: (err) => toast(apiErrorMessage(err, t), 'danger'),
      },
    );
  }

  function doPublish() {
    publish.mutate(active!.id, {
      onSuccess: (res) => {
        setPublishProblems(null);
        toast(res.warnings?.length ? t('manager.publishedWithWarnings', { count: res.warnings.length }) : t('manager.publishedOk'), 'teal');
      },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 422) {
          const p = (err.details as { problems?: string[] } | null | undefined)?.problems;
          if (p?.length) {
            setPublishProblems(p);
            toast(t('manager.publishBlocked'), 'danger');
            return;
          }
        }
        toast(apiErrorMessage(err, t), 'danger');
      },
    });
  }

  function doUnpublish() {
    unpublish.mutate(active!.id, {
      onSuccess: () => {
        setUnpublishOpen(false);
        toast(t('manager.unpublishedOk'), 'brand');
      },
      onError: (err) => toast(apiErrorMessage(err, t), 'danger'),
    });
  }

  return (
    <>
      <Breadcrumb items={crumbs} className="mb-3" />
      <PageHeader eyebrow={t('manager.editor')} title={courseTitle} subtitle={active.description ?? undefined} />

      {/* ── Языковые версии ── */}
      <div className="mb-4 flex flex-wrap items-end gap-x-3 gap-y-2">
        <Tabs
          className="min-w-0 flex-1"
          ariaLabel={t('manager.languageVersions')}
          value={active.id}
          onChange={selectVersion}
          tabs={versions.map((v) => ({
            id: v.id,
            label: (
              <span className="inline-flex items-center gap-2">
                <span lang={v.language}>{t(`languages.${v.language}`)}</span>
                <VersionStatusGlyph status={v.status} />
              </span>
            ),
          }))}
        />
        {canAddLanguage && (
          <Button variant="ghost" size="sm" onClick={() => setAddLangOpen(true)} className="mb-1">
            <Icon name="plus" size={16} />
            {t('manager.addLanguage')}
          </Button>
        )}
      </div>

      {/* ── Панель версии: статус, счётчики, действия ── */}
      <Card className="mb-4 !p-4 sm:!p-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1 basis-64">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={publishStatusTone[active.status] ?? 'muted'}>
                <VersionStatusGlyph status={active.status} />
                <span aria-hidden>{t(`status.${active.status}`)}</span>
              </Badge>
              {generating && (
                <Badge tone="brand">
                  <Spinner className="h-3.5 w-3.5" />
                  {jobStatus === 'RUNNING' ? t('manager.generationRunning') : t('manager.generationQueued')}
                </Badge>
              )}
            </div>
            <p className="mt-1.5 text-meta text-fg-2">
              <span lang={active.language}>{active.title}</span>
              {' · '}
              {t('manager.count.modules', { count: modules.length })} · {t('manager.count.lectures', { count: lectureCount })}
              {enrollments.data && <> · {t('manager.count.enrolled', { count: admitted })}</>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setStructureOpen(true)}>
              <Icon name="layers" size={18} />
              {t('manager.structureTitle')}
            </Button>
            <Button variant={isPublished ? 'secondary' : 'outline'} onClick={() => setGenOpen(true)} loading={generating} disabled={generating}>
              <Icon name="refresh" size={18} />
              {t('manager.generateMaterials')}
            </Button>
            {isPublished ? (
              <Button variant="secondary" onClick={() => setUnpublishOpen(true)}>
                {t('common.unpublish')}
              </Button>
            ) : (
              <Button loading={publish.isPending} onClick={doPublish}>
                {t('common.publish')}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* ── Здоровье версии: блокеры, предупреждения, экспертная проверка ── */}
      <HealthPanel version={active} courseId={course.id} problems={problems} />

      {/* ── Итоговый мини-квиз курса ── */}
      {active.finalMiniQuizId && (
        <Link
          to={`/manage/quiz/${active.finalMiniQuizId}?course=${course.id}`}
          className="mb-6 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-brand/50"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-dashed border-brand/60 bg-brand-soft/50 text-brand">
            <Icon name="list-check" size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-fg">{t('manager.finalMini')}</span>
            <span className="block text-meta text-fg-2">{t('manager.finalMiniHint')}</span>
          </span>
          <Icon name="chevron-right" size={18} className="shrink-0 text-fg-2" />
        </Link>
      )}

      {/* ── Модули ── */}
      {modules.length === 0 ? (
        <EmptyState
          title={t('manager.noModules')}
          hint={t('manager.noModulesHint')}
          action={<Button onClick={() => setGenOpen(true)}>{t('manager.generateMaterials')}</Button>}
        />
      ) : (
        <div className="space-y-4">
          {modules.map((m) => (
            <ModuleCard
              key={m.id}
              module={m}
              course={course}
              version={active}
              numbers={numbers}
              published={isPublished}
              onOpenLecture={(lectureId, focus) => setSheet({ lectureId, focus })}
              onDeleteLecture={(lecture) => setDeleteTarget({ lecture, number: numbers.get(lecture.id) ?? 0 })}
            />
          ))}
        </div>
      )}

      <LectureSheet
        lecture={sheetLecture}
        number={sheetLecture ? numbers.get(sheetLecture.id) ?? null : null}
        courseId={course.id}
        language={active.language}
        published={isPublished}
        focus={sheet?.focus ?? null}
        onClose={closeSheet}
      />

      <GenerateDialog
        open={genOpen}
        versionTitle={`${t(`languages.${active.language}`)} · ${active.title}`}
        published={isPublished}
        busy={generate.isPending}
        onConfirm={startGeneration}
        onCancel={() => setGenOpen(false)}
      />

      <ConfirmDialog
        open={unpublishOpen}
        title={t('manager.unpublishTitle')}
        body={
          <span className="block space-y-2">
            <span className="block">
              {enrollments.data
                ? t('manager.unpublishBody', { count: admitted })
                : t('manager.unpublishBodyUnknown')}
            </span>
            <span className="block">{t('manager.unpublishNote')}</span>
          </span>
        }
        confirmLabel={t('common.unpublish')}
        tone="danger"
        busy={unpublish.isPending}
        onConfirm={doUnpublish}
        onCancel={() => setUnpublishOpen(false)}
      />

      <DeleteLectureDialog courseId={course.id} target={deleteTarget} onClose={() => setDeleteTarget(null)} />
      <StructureDialog open={structureOpen} version={active} numbers={numbers} onClose={() => setStructureOpen(false)} />
      <AddLanguageDialog open={addLangOpen} course={course} onClose={() => setAddLangOpen(false)} />
    </>
  );
}

/** Итог задачи генерации для тоста: сколько создано и что пропущено. */
function generationSummary(job: GenerationJob | undefined, t: ReturnType<typeof useTranslation>['t']): string {
  const r = (job?.result ?? {}) as { quizzes?: number; minis?: number; practicals?: number; summaries?: number; skipped?: { frozen?: number; canonical?: number } };
  const num = (v: unknown) => (typeof v === 'number' ? v : Array.isArray(v) ? v.length : 0);
  const base = t('manager.gen.done', { quizzes: num(r.quizzes), minis: num(r.minis), practicals: num(r.practicals), summaries: num(r.summaries) });
  const frozen = num(r.skipped?.frozen);
  return frozen > 0 ? `${base} ${t('manager.gen.doneFrozen', { count: frozen })}` : base;
}

/* ── Здоровье версии ───────────────────────────────────────── */
function HealthPanel({ version, courseId, problems }: { version: StaffVersion; courseId: string; problems: string[] }) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const warnings = version.warnings;
  const visible = showAll ? warnings : warnings.slice(0, 3);
  const reviewHref = `/manage/issues?origin=SYSTEM&courseId=${courseId}&language=${version.language}`;

  if (!problems.length && !warnings.length && !version.openReviewIssues) {
    return (
      <Notice tone="teal" icon="check" className="mb-6">
        {t('manager.publishReady')}
      </Notice>
    );
  }
  return (
    <div className="mb-6 space-y-3">
      {problems.length > 0 && (
        <Notice tone="danger" icon="alert" title={t('manager.health.problemsTitle', { count: problems.length })}>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </Notice>
      )}
      {version.openReviewIssues > 0 && (
        <Notice
          tone="spark"
          icon="flag"
          title={t('manager.health.review', { count: version.openReviewIssues })}
          action={
            <Link to={reviewHref} className="inline-flex items-center gap-1 whitespace-nowrap text-body font-semibold text-brand hover:underline">
              {t('manager.health.reviewOpen')}
              <Icon name="arrow-right" size={16} />
            </Link>
          }
        >
          {t('manager.health.reviewHint')}
        </Notice>
      )}
      {warnings.length > 0 && (
        <Notice tone="muted" icon="info" title={t('manager.health.warningsTitle', { count: warnings.length })}>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {visible.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          {warnings.length > 3 && (
            <button type="button" onClick={() => setShowAll((s) => !s)} className="mt-2 font-semibold text-brand hover:underline">
              {showAll ? t('manager.health.showLess') : t('manager.health.showAll', { count: warnings.length })}
            </button>
          )}
        </Notice>
      )}
    </div>
  );
}

/* ── Карточка модуля ───────────────────────────────────────── */
function ModuleCard({
  module, course, version, numbers, published, onOpenLecture, onDeleteLecture,
}: {
  module: StaffModule;
  course: StaffCourse;
  version: StaffVersion;
  numbers: Map<string, number>;
  published: boolean;
  onOpenLecture: (lectureId: string, focus: 'duration' | null) => void;
  onDeleteLecture: (lecture: StaffLecture) => void;
}) {
  const { t } = useTranslation();
  const addLecture = useAddLecture(course.id);
  const isPractical = module.assessmentType === 'PRACTICAL';
  const lockHint = t('manager.structureLocked');

  function add() {
    addLecture.mutate(
      { moduleId: module.id },
      {
        onSuccess: () => toast(t('manager.lectureAdded'), 'teal'),
        onError: (err) => toast(apiErrorMessage(err, t), 'danger'),
      },
    );
  }

  return (
    <Card className="!p-0">
      <div className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-4 sm:px-5">
        <span className="grid h-9 min-w-[2.25rem] place-items-center rounded-lg bg-ink px-1.5 font-display text-sm font-semibold text-white dark:bg-fg dark:text-ink">
          {romanNumeral(module.orderIndex)}
        </span>
        <div className="min-w-0 flex-1 basis-48">
          <ModuleTitle module={module} courseId={course.id} language={version.language} />
          <p className="mt-0.5 text-meta text-fg-2">
            {t('manager.count.lectures', { count: module.lectures.length })}
            {module.coversWholeCourse && <> · {t('manager.coversWholeCourse')}</>}
          </p>
        </div>
        {isPractical ? (
          <MetaChip tone="spark">{t('manager.assessPractical')}</MetaChip>
        ) : module.quiz ? (
          <ModeBadge mode="graded" />
        ) : null}
      </div>

      <ol className="divide-y divide-border">
        {module.lectures.map((l) => {
          const n = numbers.get(l.id) ?? 0;
          return (
            <li key={l.id} className="group grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-brand-soft/30 sm:px-5">
              <span className="num mt-0.5 text-fg-2">{t('manager.lectureShort', { n })}</span>
              <button
                type="button"
                onClick={() => onOpenLecture(l.id, null)}
                className="min-w-0 text-left text-body font-medium text-fg hover:text-brand focus-visible:text-brand"
                lang={version.language}
              >
                {/* Номер уже в «Л5» слева — из названия «1. …» его убираем (одна нумерация, как у студента) */}
                {lectureDisplayTitle(l.title)}
              </button>
              <div className="-mt-1 flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="sm" className="!px-2" onClick={() => onOpenLecture(l.id, null)} aria-label={`${t('common.edit')}: ${lectureDisplayTitle(l.title)}`}>
                  <Icon name="pencil" size={18} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="!px-2 text-danger-ink"
                  disabled={published}
                  title={published ? lockHint : undefined}
                  onClick={() => onDeleteLecture(l)}
                  aria-label={`${t('common.delete')}: ${lectureDisplayTitle(l.title)}`}
                >
                  <Icon name="trash" size={18} />
                </Button>
              </div>
              <HealthChips lecture={l} courseId={course.id} onEditDuration={() => onOpenLecture(l.id, 'duration')} className="col-span-3 sm:col-span-2 sm:col-start-2" />
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3 sm:px-5">
        {module.quiz && (
          <Link
            to={`/manage/quiz/${module.quiz.id}?course=${course.id}`}
            className="inline-flex max-w-full items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 text-body font-semibold text-fg transition-colors hover:border-brand/50"
          >
            <Icon name="diamond" size={16} className="mt-1" />
            {/* Текст и уточнение — одним строчным блоком: на узком экране переносится как фраза, а не двумя колонками */}
            <span className="min-w-0">
              {t('manager.quizEditor')} <span className="font-normal text-fg-2">· {t('manager.count.questions', { count: module.quiz.questions.length })}</span>
            </span>
          </Link>
        )}
        {module.practicalTask && (
          <Link
            to={`/manage/practical/${module.practicalTask.id}?course=${course.id}`}
            className="inline-flex max-w-full items-start gap-2 rounded-lg border border-spark-ink/30 bg-spark/10 px-3 py-2 text-body font-semibold text-fg transition-colors hover:border-spark-ink"
          >
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-spark font-display text-small font-bold text-ink" aria-hidden>?</span>
            <span className="min-w-0">
              {t('manager.practicalEditor')}
              {module.practicalTask.canonicalRef && <> <span className="font-normal text-fg-2">· {t('manager.canonicalShort')}</span></>}
            </span>
          </Link>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {published && <span className="text-small text-fg-2">{lockHint}</span>}
          <Button variant="secondary" size="sm" onClick={add} loading={addLecture.isPending} disabled={published} title={published ? lockHint : undefined}>
            <Icon name="plus" size={16} />
            {t('manager.addLecture')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Название модуля с переименованием на месте: карандаш → поле; Enter — сохранить, Esc — отмена. */
function ModuleTitle({ module, courseId, language }: { module: StaffModule; courseId: string; language: string }) {
  const { t } = useTranslation();
  const rename = useRenameModule(courseId);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(module.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function save() {
    const title = value.trim();
    if (!title || title === module.title) {
      setEditing(false);
      setValue(module.title);
      return;
    }
    rename.mutate(
      { id: module.id, title },
      {
        onSuccess: () => {
          setEditing(false);
          toast(t('manager.moduleRenamed'), 'teal');
        },
        onError: (err) => toast(apiErrorMessage(err, t), 'danger'),
      },
    );
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setEditing(false);
      setValue(module.title);
    }
  }

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Input
          ref={inputRef}
          lang={language}
          value={value}
          maxLength={200}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          aria-label={t('manager.moduleTitle')}
          className="min-w-0 flex-1 basis-60"
        />
        <Button size="sm" onClick={save} loading={rename.isPending}>{t('common.save')}</Button>
        <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setValue(module.title); }}>{t('common.cancel')}</Button>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-1.5">
      {/* Римский номер — в бейдже слева; «Раздел I.» из названия не повторяем (полное название — в поле правки) */}
      <h3 className="text-title" lang={language}>{moduleDisplayTitle(module.title)}</h3>
      <button
        type="button"
        onClick={() => { setValue(module.title); setEditing(true); }}
        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-fg-2 transition-colors hover:bg-brand-soft hover:text-fg"
        aria-label={t('manager.renameModule')}
        title={t('manager.renameModule')}
      >
        <Icon name="pencil" size={16} />
      </button>
    </div>
  );
}

/* ── Удаление лекции (только неопубликованная версия) ─────── */
function DeleteLectureDialog({ courseId, target, onClose }: { courseId: string; target: { lecture: StaffLecture; number: number } | null; onClose: () => void }) {
  const { t } = useTranslation();
  const del = useDeleteLecture(courseId);
  return (
    <ConfirmDialog
      open={!!target}
      title={t('manager.deleteLectureTitle', { n: target?.number ?? '' })}
      body={
        <span className="block space-y-2">
          <span className="block font-medium text-fg">{target ? lectureDisplayTitle(target.lecture.title) : ''}</span>
          <span className="block">{t('manager.deleteLectureBody')}</span>
        </span>
      }
      confirmLabel={t('common.delete')}
      tone="danger"
      busy={del.isPending}
      onCancel={onClose}
      onConfirm={() =>
        target &&
        del.mutate(target.lecture.id, {
          onSuccess: () => {
            toast(t('manager.lectureDeleted'), 'brand');
            onClose();
          },
          onError: (err) => toast(apiErrorMessage(err, t), 'danger'),
        })
      }
    />
  );
}

/* ── «Структура курса» (бывший предпросмотр) — общий Dialog ── */
function StructureDialog({ open, version, numbers, onClose }: { open: boolean; version: StaffVersion; numbers: Map<string, number>; onClose: () => void }) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useVersionPreview(open ? version.id : null);
  const modules = data ? [...data.version.modules].sort((a, b) => a.orderIndex - b.orderIndex) : [];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={t('manager.structureTitle')}
      description={t('manager.structureHint')}
      footer={<Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>}
    >
      {isLoading ? (
        <LoadingRows rows={4} />
      ) : isError || !data ? (
        <ErrorState message={t('errors.generic')} />
      ) : (
        <div className="space-y-3" lang={version.language}>
          <p className="text-title">{data.version.title}</p>
          {modules.map((m) => (
            <section key={m.id} className="rounded-xl border border-border p-4">
              <div className="flex items-start gap-2">
                <span className="grid h-7 min-w-[1.75rem] place-items-center rounded-md bg-ink px-1 font-display text-small font-semibold text-white dark:bg-fg dark:text-ink">
                  {romanNumeral(m.orderIndex)}
                </span>
                <h3 className="min-w-0 flex-1 font-semibold text-fg">{moduleDisplayTitle(m.title)}</h3>
              </div>
              <ol className="mt-2 space-y-1.5 pl-9">
                {[...m.lectures].sort((a, b) => a.orderIndex - b.orderIndex).map((l) => {
                  const placeholder = !l.youtubeVideoId || l.youtubeVideoId === 'PLACEHOLDER';
                  return (
                    <li key={l.id} className="flex items-start gap-2 text-body text-fg">
                      <span className="num w-9 shrink-0 text-fg-2">{t('manager.lectureShort', { n: numbers.get(l.id) ?? '' })}</span>
                      <span className="min-w-0 flex-1">{lectureDisplayTitle(l.title)}</span>
                      {placeholder && (
                        <MetaChip icon="alert" tone="spark">{t('manager.health.videoPlaceholder')}</MetaChip>
                      )}
                    </li>
                  );
                })}
              </ol>
              {m.quiz && (
                <p className="mt-3 flex items-center gap-2 pl-9 text-body text-fg-2">
                  <Icon name="diamond" size={16} className="text-fg" />
                  <span>
                    {m.quiz.title} · {t('manager.count.questions', { count: m.quiz.questions.length })}
                  </span>
                </p>
              )}
              {m.practicalTask && (
                <div className="mt-3 rounded-lg bg-spark/10 px-3 py-2 pl-9 text-body">
                  <div className="font-semibold text-fg">{m.practicalTask.title}</div>
                  <p className="mt-1 line-clamp-3 text-fg-2">{m.practicalTask.scenarioPrompt}</p>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </Dialog>
  );
}

/* ── Добавление языковой версии (структура копируется из базовой) ── */
function AddLanguageDialog({ open, course, onClose }: { open: boolean; course: StaffCourse; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const used = course.languageVersions.map((v) => v.language);
  const available = LANG_ORDER.filter((l) => !used.includes(l));
  const source = course.languageVersions.find((v) => v.language === course.defaultLanguage) ?? course.languageVersions[0];
  const [language, setLanguage] = useState(available[0] ?? '');
  const [title, setTitle] = useState('');
  useEffect(() => {
    if (open) {
      setLanguage(available[0] ?? '');
      setTitle('');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = useMutation({
    mutationFn: () => api.post(`/courses/${course.id}/language-versions`, { language, title: title.trim(), copyStructureFrom: source?.id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['course', course.id] });
      void qc.invalidateQueries({ queryKey: ['courses'] });
      toast(t('manager.languageAdded'), 'teal');
      onClose();
    },
    onError: (err) => toast(apiErrorMessage(err, t), 'danger'),
  });
  const canSubmit = !!language && title.trim().length > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={add.isPending}
      title={t('manager.addLanguage')}
      description={source ? t('manager.addLanguageHint', { source: t(`languages.${source.language}`) }) : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={add.isPending}>{t('common.cancel')}</Button>
          <Button onClick={() => add.mutate()} loading={add.isPending} disabled={!canSubmit}>{t('common.add')}</Button>
        </>
      }
    >
      <form
        className={clsx('space-y-4')}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) add.mutate();
        }}
      >
        <Field label={t('common.language')}>
          <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {available.map((l) => (
              <option key={l} value={l}>{t(`languages.${l}`)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('manager.courseTitle')}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} lang={language} data-autofocus />
        </Field>
      </form>
    </Dialog>
  );
}
