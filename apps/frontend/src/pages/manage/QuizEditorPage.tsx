import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Difficulty, QuestionType, QuizScoringRule } from '@edu/shared';
import {
  apiErrorMessage, findQuizPlace, romanNumeral, useAddQuestion, useBulkIssueStatus, useCourseDetail, useDeleteQuestion,
  useQuestionPatch, useQuizEdit, useQuizItems, useQuizSettings, useRegenerateQuestion, useReviewIssueMap,
  useSetIssueStatus, type EditQuestion, type QuizEdit,
} from '../../lib/staff';
import { formatPercent } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { Breadcrumb, Button, Card, ConfirmDialog, Field, Input, ModeBadge, toast, type Crumb } from '../../components/ui';
import { Icon } from '../../components/icons';
import { PageHeader, LoadingRows, EmptyState, ErrorState } from '../../components/page';
import { PolicyPanel, settingsDraftOf, settingsPatch, type SettingsDraft } from '../../components/staff/PolicyPanel';
import { QuestionRow, questionDraftOf, questionPatch, type QuestionDraft } from '../../components/staff/QuestionRow';
import { NoteDialog } from '../../components/staff/NoteDialog';
import { LeaveGuard, SaveBar } from '../../components/staff/SaveBar';
import { Notice, SampleSize, SectionTitle } from '../../components/staff/primitives';

/** Оцениваемый тест модуля (политика попыток); мини-квизы — тренировка без порога и попыток. */
const isGradedQuiz = (q: QuizEdit) => q.isGraded && q.kind === 'MODULE_FINAL';

/**
 * Редактор теста (FR-7.3; FE5 §2): хлебные крошки «Курс › Модуль › Тест», факты,
 * панель «Что видит студент», замороженный тест (есть попытки), строки вопросов с
 * экспертной проверкой и анализом заданий, архив, общая панель «Сохранить все (n)»
 * и защита от ухода. Удаление/перегенерация и пакетное закрытие — через ConfirmDialog.
 */
export function QuizEditorPage() {
  const { t } = useTranslation();
  const { quizId } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const qc = useQueryClient();
  const courseParam = params.get('course');

  const [showArchived, setShowArchived] = useState(false);
  const { data, isLoading, isError, error } = useQuizEdit(quizId, showArchived);
  const quiz = data?.quiz;
  const course = useCourseDetail(courseParam);
  const place = useMemo(() => (quiz ? findQuizPlace(course.data?.course, quiz.id) : null), [course.data, quiz]);
  const language = place?.version.language;
  const graded = quiz ? isGradedQuiz(quiz) : false;
  const items = useQuizItems(quizId, graded);
  const statById = useMemo(() => new Map((items.data?.items ?? []).map((s) => [s.questionId, s])), [items.data]);
  const anyReview = !!quiz?.questions.some((q) => q.reviewPending && !q.archivedAt);
  const reviewMap = useReviewIssueMap(anyReview, place?.course.id ?? null);

  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ q: EditQuestion; n: number } | null>(null);
  const [regenTarget, setRegenTarget] = useState<{ q: EditQuestion; n: number } | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{ q: EditQuestion; n: number } | null>(null);
  const [bulkReviewOpen, setBulkReviewOpen] = useState(false);

  const saveSettings = useQuizSettings(quizId);
  const patchQuestion = useQuestionPatch();
  const addQuestion = useAddQuestion(quizId);
  const deleteQuestion = useDeleteQuestion(quizId);
  const regenerate = useRegenerateQuestion(quizId);
  const setIssues = useSetIssueStatus();
  const bulkIssues = useBulkIssueStatus();

  // Якорь #q-<id> (из входящих жалоб): развернуть вопрос и прокрутить к нему
  useEffect(() => {
    const m = location.hash.match(/^#q-(.+)$/);
    if (!m || !quiz) return;
    const id = m[1]!;
    if (!quiz.questions.some((q) => q.id === id)) {
      // Вопрос мог уйти в архив (жалоба на старую версию) — показать архив и искать там
      if (!showArchived) setShowArchived(true);
      return;
    }
    setExpanded((s) => new Set(s).add(id));
    const timer = window.setTimeout(() => document.getElementById(`q-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80);
    return () => window.clearTimeout(timer);
  }, [location.hash, quiz?.id, quiz?.questions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const placeLabel = place
    ? place.kind === 'MODULE'
      ? t('manager.qe.placeModule', { roman: romanNumeral(place.module!.orderIndex) })
      : place.kind === 'LECTURE'
        ? t('manager.qe.placeLecture', { n: place.lectureNumber ?? '' })
        : t('manager.qe.placeFinal')
    : null;
  useDocumentTitle(quiz ? `${quiz.title} · ${t('manager.quizEditor')}` : t('manager.quizEditor'));

  const crumbs: Crumb[] = [{ label: t('manager.courses'), to: '/manage/courses' }];
  if (place) {
    crumbs.push({ label: place.version.title, to: `/manage/courses/${place.course.id}?version=${place.version.id}` });
    if (placeLabel) crumbs.push({ label: placeLabel });
  }
  crumbs.push({ label: graded ? t('manager.qe.crumbQuiz') : t('manager.qe.crumbMini') });

  if (isLoading) return <><Breadcrumb items={crumbs} className="mb-3" /><LoadingRows rows={5} /></>;
  if (isError || !quiz) return <><Breadcrumb items={crumbs} className="mb-3" /><ErrorState message={apiErrorMessage(error, t)} /></>;

  const active = quiz.questions.filter((q) => !q.archivedAt).sort((a, b) => a.orderIndex - b.orderIndex);
  const archived = quiz.questions.filter((q) => q.archivedAt);
  const sDraft = settingsDraft ?? settingsDraftOf(quiz);
  const sCheck = settingsPatch(quiz, sDraft, t);
  const settingsDirty = Object.keys(sCheck.patch).length > 0;
  const qChecks = active.map((q) => {
    const d = drafts[q.id];
    const check = d ? questionPatch(q, d) : null;
    return { q, draft: d ?? questionDraftOf(q), dirty: !!check && Object.keys(check.patch).length > 0, check };
  });
  const dirtyCount = (settingsDirty ? 1 : 0) + qChecks.filter((c) => c.dirty).length;
  const hasErrors =
    Object.keys(sCheck.errors).length > 0 ||
    qChecks.some((c) => c.dirty && c.check && Object.keys(c.check.errors).length > 0);
  const reviewIds = (qid: string) => reviewMap.data?.[qid] ?? [];
  const allReviewIds = active.flatMap((q) => (q.reviewPending ? reviewIds(q.id) : []));
  const reviewQuestionCount = active.filter((q) => q.reviewPending).length;
  const passCount = Math.ceil(quiz.passThreshold * active.length - 1e-9);
  const cooldownText =
    quiz.effectiveCooldownMinutes === 0
      ? t('manager.qe.noPause')
      : t('manager.qe.pause', { hours: +(quiz.effectiveCooldownMinutes / 60).toFixed(1) });

  function toggle(id: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['quiz-edit', quizId] });
    void qc.invalidateQueries({ queryKey: ['quiz-items', quizId] });
    if (place) void qc.invalidateQueries({ queryKey: ['course', place.course.id] });
  }

  async function saveAll() {
    if (!quiz) return;
    if (hasErrors) {
      toast(t('manager.save.fixErrors'), 'danger');
      setExpanded((s) => {
        const n = new Set(s);
        for (const c of qChecks) if (c.dirty && c.check && Object.keys(c.check.errors).length) n.add(c.q.id);
        return n;
      });
      return;
    }
    setSaving(true);
    let ok = 0;
    const failed: string[] = [];
    if (settingsDirty) {
      try {
        await saveSettings.mutateAsync(sCheck.patch);
        setSettingsDraft(null);
        ok++;
      } catch (err) {
        failed.push(`${t('manager.policy.title')}: ${apiErrorMessage(err, t)}`);
      }
    }
    for (const c of qChecks) {
      if (!c.dirty || !c.check) continue;
      try {
        await patchQuestion.mutateAsync({ id: c.q.id, patch: c.check.patch });
        setDrafts((d) => {
          const n = { ...d };
          delete n[c.q.id];
          return n;
        });
        ok++;
      } catch (err) {
        failed.push(`${t('manager.qe.questionN', { n: active.indexOf(c.q) + 1 })}: ${apiErrorMessage(err, t)}`);
      }
    }
    setSaving(false);
    refresh();
    if (failed.length) toast(`${t('manager.save.partial', { count: failed.length })} ${failed.join(' · ')}`, 'danger', { duration: 9000 });
    else if (ok) toast(t('manager.save.done', { count: ok }), 'teal');
  }

  function discard() {
    setSettingsDraft(null);
    setDrafts({});
  }

  function addNew() {
    const lng = language ?? undefined;
    addQuestion.mutate(
      {
        type: QuestionType.SINGLE_CHOICE,
        prompt: t('manager.qe.newPrompt', { lng }),
        options: [0, 1, 2, 3].map((i) => t('manager.qe.newOption', { lng, letter: String.fromCharCode(65 + i) })),
        correctOptionIds: [0],
        difficulty: Difficulty.MEDIUM,
      },
      {
        onSuccess: (res) => {
          toast(t('manager.qe.added'), 'teal');
          setExpanded((s) => new Set(s).add(res.question.id));
        },
        onError: (err) => toast(apiErrorMessage(err, t), 'danger'),
      },
    );
  }

  const facts = graded
    ? [
        t('manager.qe.factQuestions', { count: active.length }),
        t('manager.qe.factThreshold', { value: formatPercent(quiz.passThreshold), pass: passCount, total: active.length }),
        t('manager.qe.factAttempts', { count: quiz.maxAttempts }),
        t('manager.qe.factScoring', { rule: quiz.scoringRule === QuizScoringRule.FIRST ? t('manager.policy.scoringFIRST').toLowerCase() : t('manager.policy.scoringBEST').toLowerCase() }),
        cooldownText,
      ]
    : [t('manager.qe.factQuestions', { count: active.length })];

  return (
    <>
      <Breadcrumb items={crumbs} className="mb-3" />
      <PageHeader
        eyebrow={placeLabel ?? t('manager.quizEditor')}
        title={quiz.title}
        action={<ModeBadge mode={graded ? 'graded' : 'practice'} long={!graded} />}
      />
      <p className="-mt-3 mb-6 text-meta text-fg-2" lang={undefined}>
        {facts.join(' · ')}
        {graded && items.data && (
          <>
            {' · '}
            <SampleSize n={items.data.n} className="align-middle" />
          </>
        )}
      </p>

      {quiz.frozen && (
        <Notice tone="ink" icon="lock" className="mb-6" title={t('manager.qe.frozenTitle')}>
          {t('manager.qe.frozenBody', { count: quiz.attemptCount })}
        </Notice>
      )}

      <Card className="mb-6 !p-4 sm:!p-6">
        <Field label={graded ? t('manager.qe.titleLabel') : t('manager.qe.titleLabelMini')} error={sCheck.errors.title}>
          <Input lang={language} value={sDraft.title} onChange={(e) => setSettingsDraft({ ...sDraft, title: e.target.value })} />
        </Field>
      </Card>

      {graded && <PolicyPanel quiz={quiz} draft={sDraft} errors={sCheck.errors} onChange={setSettingsDraft} />}

      <SectionTitle
        hint={graded ? t('manager.qe.listHint') : t('manager.qe.listHintMini')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {reviewQuestionCount > 0 && (
              <Button variant="outline" size="sm" onClick={() => setBulkReviewOpen(true)} disabled={!allReviewIds.length}>
                <Icon name="check" size={16} />
                {t('manager.qe.markAllReviewed', { count: reviewQuestionCount })}
              </Button>
            )}
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl px-2 text-body font-medium text-fg hover:bg-brand-soft/50">
              <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              {t('manager.qe.showArchive')}
            </label>
            <Button variant="secondary" size="sm" onClick={addNew} loading={addQuestion.isPending} disabled={quiz.frozen} title={quiz.frozen ? t('manager.qe.addFrozen') : undefined}>
              <Icon name="plus" size={16} />
              {t('manager.addQuestion')}
            </Button>
          </div>
        }
      >
        {t('manager.qe.questionsTitle', { count: active.length })}
      </SectionTitle>

      {reviewQuestionCount > 0 && (
        <Notice tone="spark" icon="flag" className="mb-4" title={t('manager.qe.reviewBannerTitle', { count: reviewQuestionCount })}>
          {t('manager.qe.reviewBannerBody')}
        </Notice>
      )}

      {active.length === 0 ? (
        <EmptyState
          title={t('manager.qe.empty')}
          hint={quiz.frozen ? undefined : t('manager.qe.emptyHint')}
          action={quiz.frozen ? undefined : <Button onClick={addNew} loading={addQuestion.isPending}>{t('manager.addQuestion')}</Button>}
        />
      ) : (
        <ol className="space-y-2.5">
          {qChecks.map((c, i) => (
            <QuestionRow
              key={c.q.id}
              question={c.q}
              index={i + 1}
              draft={c.draft}
              dirty={c.dirty}
              expanded={expanded.has(c.q.id)}
              onToggle={() => toggle(c.q.id)}
              onChange={(d) => setDrafts((all) => ({ ...all, [c.q.id]: d }))}
              lectures={quiz.lectures}
              stat={statById.get(c.q.id)}
              reviewCount={reviewIds(c.q.id).length}
              language={language}
              canDelete={!quiz.frozen}
              onReviewed={() => setReviewTarget({ q: c.q, n: i + 1 })}
              onRegenerate={() => setRegenTarget({ q: c.q, n: i + 1 })}
              onDelete={() => setDeleteTarget({ q: c.q, n: i + 1 })}
            />
          ))}
        </ol>
      )}

      {showArchived && (
        <section className="mt-8" aria-label={t('manager.qe.archiveTitle')}>
          <SectionTitle as="h2" hint={t('manager.qe.archiveHint')}>
            {t('manager.qe.archiveTitle')}
          </SectionTitle>
          {archived.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-body text-fg-2">{t('manager.qe.archiveEmpty')}</p>
          ) : (
            <ol className="space-y-2.5">
              {archived.map((q, i) => (
                <QuestionRow
                  key={q.id}
                  question={q}
                  index={i + 1}
                  draft={questionDraftOf(q)}
                  dirty={false}
                  expanded={expanded.has(q.id)}
                  onToggle={() => toggle(q.id)}
                  onChange={() => undefined}
                  lectures={quiz.lectures}
                  reviewCount={0}
                  language={language}
                  readOnly
                  canDelete={false}
                />
              ))}
            </ol>
          )}
        </section>
      )}

      <SaveBar count={dirtyCount} saving={saving} onSave={() => void saveAll()} onDiscard={discard} />
      <LeaveGuard when={dirtyCount > 0 && !saving} />

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('manager.qe.deleteTitle', { n: deleteTarget?.n ?? '' })}
        body={
          <span className="block space-y-2">
            <span className="line-clamp-3 block font-medium text-fg">{deleteTarget?.q.prompt}</span>
            <span className="block">{t('manager.qe.deleteBody')}</span>
          </span>
        }
        confirmLabel={t('common.delete')}
        tone="danger"
        busy={deleteQuestion.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() =>
          deleteTarget &&
          deleteQuestion.mutate(deleteTarget.q.id, {
            onSuccess: () => {
              setDrafts((d) => {
                const n = { ...d };
                delete n[deleteTarget.q.id];
                return n;
              });
              toast(t('manager.qe.deleted'), 'brand');
              setDeleteTarget(null);
            },
            onError: (err) => toast(apiErrorMessage(err, t), 'danger'),
          })
        }
      />

      <ConfirmDialog
        open={!!regenTarget}
        title={t('manager.qe.regenTitle', { n: regenTarget?.n ?? '' })}
        body={
          <span className="block space-y-2">
            <span className="line-clamp-3 block font-medium text-fg">{regenTarget?.q.prompt}</span>
            <span className="block">{t('manager.qe.regenBody')}</span>
          </span>
        }
        confirmLabel={t('manager.regenerateQuestion')}
        busy={regenerate.isPending}
        onCancel={() => setRegenTarget(null)}
        onConfirm={() =>
          regenTarget &&
          regenerate.mutate(regenTarget.q.id, {
            onSuccess: () => {
              setDrafts((d) => {
                const n = { ...d };
                delete n[regenTarget.q.id];
                return n;
              });
              toast(t('manager.qe.regenerated'), 'teal');
              setRegenTarget(null);
            },
            onError: (err) => toast(apiErrorMessage(err, t), 'danger'),
          })
        }
      />

      <NoteDialog
        open={!!reviewTarget}
        title={t('manager.qe.reviewTitle', { n: reviewTarget?.n ?? '' })}
        body={t('manager.qe.reviewBody')}
        confirmLabel={t('manager.qe.markReviewed')}
        busy={setIssues.isPending}
        onCancel={() => setReviewTarget(null)}
        onConfirm={(note) =>
          reviewTarget &&
          setIssues.mutate(
            { ids: reviewIds(reviewTarget.q.id), status: 'RESOLVED', note },
            {
              onSuccess: () => {
                toast(t('manager.qe.reviewedOne'), 'teal');
                setReviewTarget(null);
              },
              onError: (err) => toast(apiErrorMessage(err, t), 'danger'),
            },
          )
        }
      />

      <NoteDialog
        open={bulkReviewOpen}
        title={t('manager.qe.bulkReviewTitle', { count: reviewQuestionCount })}
        body={t('manager.qe.bulkReviewBody', { count: reviewQuestionCount })}
        confirmLabel={t('manager.qe.bulkReviewConfirm')}
        busy={bulkIssues.isPending}
        onCancel={() => setBulkReviewOpen(false)}
        onConfirm={(note) =>
          bulkIssues.mutate(
            { ids: allReviewIds, status: 'RESOLVED', note },
            {
              onSuccess: (r) => {
                toast(t('manager.qe.bulkReviewed', { count: r.updated }), 'teal');
                setBulkReviewOpen(false);
              },
              onError: (err) => toast(apiErrorMessage(err, t), 'danger'),
            },
          )
        }
      />
    </>
  );
}
