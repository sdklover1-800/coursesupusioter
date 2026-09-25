import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LECTURE_SUMMARY_MAX_CHARS } from '@edu/shared';
import { Button, ConfirmDialog, Field, Input, SegmentedControl, Sheet, toast } from '../ui';
import { TranscriptView } from '../TranscriptView';
import { apiErrorMessage, clockToSeconds, secondsToClock, useUpdateLecture, type LecturePatch, type StaffLecture } from '../../lib/staff';
import { AutoTextarea, Notice } from './primitives';

interface Draft {
  title: string;
  youtubeUrl: string;
  duration: string;
  summary: string;
  transcript: string;
}

const draftOf = (l: StaffLecture): Draft => ({
  title: l.title,
  youtubeUrl: l.youtubeVideoId && l.hasVideo ? `https://youtu.be/${l.youtubeVideoId}` : '',
  duration: secondsToClock(l.durationSec),
  summary: l.summary ?? '',
  transcript: l.transcriptText ?? '',
});

/**
 * Редактор лекции в правом листе (FE5 §1): название, видео, длительность, краткое
 * содержание (≤ 600 знаков) и расшифровка с автовысотой и предпросмотром TranscriptView
 * (только чтение, компонент FE2). Сохраняются только изменённые поля (PATCH /lectures/:id).
 */
export function LectureSheet({
  lecture, number, courseId, language, published, focus, onClose,
}: {
  lecture: StaffLecture | null;
  number: number | null;
  courseId: string;
  /** Язык контента версии — атрибут lang полей (переносы, скринридер) */
  language: string;
  published: boolean;
  /** Поле для фокуса при открытии (клик по чипу длительности) */
  focus?: 'duration' | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateLecture(courseId);
  const [draft, setDraft] = useState<Draft | null>(lecture ? draftOf(lecture) : null);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [confirmClose, setConfirmClose] = useState(false);
  const durationRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(lecture ? draftOf(lecture) : null);
    setMode('edit');
  }, [lecture?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (lecture && focus === 'duration') {
      const id = window.setTimeout(() => durationRef.current?.focus(), 60);
      return () => window.clearTimeout(id);
    }
  }, [lecture, focus]);

  const base = useMemo(() => (lecture ? draftOf(lecture) : null), [lecture]);
  const durationSec = draft ? clockToSeconds(draft.duration) : null;
  const durationInvalid = durationSec === undefined || (typeof durationSec === 'number' && durationSec > 14400);
  const titleInvalid = !!draft && !draft.title.trim();
  const summaryTooLong = !!draft && draft.summary.trim().length > LECTURE_SUMMARY_MAX_CHARS;

  const patch: LecturePatch = {};
  if (draft && base) {
    if (draft.title.trim() !== base.title.trim()) patch.title = draft.title.trim();
    if (draft.youtubeUrl.trim() !== base.youtubeUrl.trim()) patch.youtubeUrl = draft.youtubeUrl.trim();
    if (draft.duration.trim() !== base.duration.trim() && !durationInvalid) patch.durationSec = durationSec ?? null;
    if (draft.summary.trim() !== base.summary.trim()) patch.summary = draft.summary.trim() || null;
    if (draft.transcript !== base.transcript) patch.transcriptText = draft.transcript;
  }
  const dirty = Object.keys(patch).length > 0 || (!!draft && !!base && draft.duration.trim() !== base.duration.trim());
  const invalid = titleInvalid || durationInvalid || summaryTooLong;

  function requestClose() {
    if (update.isPending) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  }

  function save() {
    if (!lecture || invalid || !Object.keys(patch).length) return;
    update.mutate(
      { id: lecture.id, patch },
      {
        onSuccess: () => {
          toast(t('manager.lectureSheet.saved'), 'teal');
          onClose();
        },
        onError: (err) => toast(apiErrorMessage(err, t), 'danger'),
      },
    );
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <>
      <Sheet
        open={!!lecture && !!draft}
        onClose={requestClose}
        busy={update.isPending}
        size="lg"
        title={number ? t('manager.lectureSheet.titleNumbered', { n: number }) : t('manager.lectureSheet.title')}
        description={lecture?.title}
        footer={
          <>
            <Button variant="secondary" onClick={requestClose} disabled={update.isPending}>
              {t('common.cancel')}
            </Button>
            <Button onClick={save} loading={update.isPending} disabled={!dirty || invalid}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-5">
            {published && (
              <Notice tone="brand" icon="eye">
                {t('manager.lectureSheet.publishedNote')}
              </Notice>
            )}
            <Field label={t('manager.lectureTitle')} error={titleInvalid ? t('manager.lectureSheet.titleRequired') : undefined}>
              <Input lang={language} value={draft.title} onChange={(e) => set('title', e.target.value)} data-autofocus={focus ? undefined : true} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <Field label={t('manager.youtubeUrl')} hint={t('manager.lectureSheet.youtubeHint')}>
                <Input value={draft.youtubeUrl} onChange={(e) => set('youtubeUrl', e.target.value)} placeholder="https://youtu.be/…" inputMode="url" />
              </Field>
              <Field label={t('manager.lectureSheet.duration')} hint={t('manager.lectureSheet.durationHint')} error={durationInvalid ? t('manager.lectureSheet.durationInvalid') : undefined}>
                <Input
                  ref={durationRef}
                  value={draft.duration}
                  onChange={(e) => set('duration', e.target.value)}
                  placeholder="22:00"
                  inputMode="numeric"
                  className="font-mono tabular-nums"
                />
              </Field>
            </div>
            <Field
              label={t('manager.lectureSheet.summary')}
              hint={t('manager.lectureSheet.summaryHint', { count: draft.summary.trim().length, max: LECTURE_SUMMARY_MAX_CHARS })}
              error={summaryTooLong ? t('manager.lectureSheet.summaryTooLong', { max: LECTURE_SUMMARY_MAX_CHARS }) : undefined}
            >
              <AutoTextarea lang={language} minRows={3} value={draft.summary} onChange={(e) => set('summary', e.target.value)} />
            </Field>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-fg">{t('manager.transcript')}</span>
                <SegmentedControl
                  size="sm"
                  tone="brand"
                  ariaLabel={t('manager.transcript')}
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'edit', label: t('manager.lectureSheet.modeEdit') },
                    { value: 'preview', label: t('manager.lectureSheet.modePreview') },
                  ]}
                />
              </div>
              {mode === 'edit' ? (
                <>
                  <AutoTextarea
                    lang={language}
                    minRows={8}
                    maxHeight={560}
                    value={draft.transcript}
                    onChange={(e) => set('transcript', e.target.value)}
                    aria-label={t('manager.transcript')}
                    className="font-sans"
                  />
                  <p className="mt-1.5 text-small text-fg-2">{t('manager.lectureSheet.transcriptHint')}</p>
                </>
              ) : draft.transcript.trim() ? (
                <div lang={language} className="rounded-xl border border-border bg-surface p-4">
                  <TranscriptView text={draft.transcript} compact />
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-body text-fg-2">{t('manager.health.noTranscript')}</p>
              )}
            </div>
          </div>
        )}
      </Sheet>
      <ConfirmDialog
        open={confirmClose}
        title={t('manager.save.closeTitle')}
        body={t('manager.save.closeBody')}
        confirmLabel={t('manager.save.leaveConfirm')}
        cancelLabel={t('manager.save.leaveCancel')}
        tone="danger"
        onConfirm={() => {
          setConfirmClose(false);
          onClose();
        }}
        onCancel={() => setConfirmClose(false)}
      />
    </>
  );
}
