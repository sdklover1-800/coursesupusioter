import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PLACEHOLDER_VIDEO_ID } from '@edu/shared';
import { api } from '../../lib/api';
import { Button, Card } from '../../components/ui';
import { LoadingRows } from '../../components/page';
import { TranscriptView } from '../../components/TranscriptView';
import { MiniQuiz } from '../../components/MiniQuiz';

interface Lecture { id: string; title: string; youtubeVideoId: string; transcriptText: string }

/** Страница лекции: адаптивный YouTube-плеер + расшифровка (FR-4.2, FR-4.4, FR-4.5). */
export function LecturePage() {
  const { t } = useTranslation();
  const { courseId, enrollmentId, lectureId } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['lecture', lectureId, enrollmentId],
    queryFn: () => api.get<{ lecture: Lecture }>(`/lectures/${lectureId}?enrollmentId=${enrollmentId}`),
  });

  const complete = useMutation({
    mutationFn: () => api.post(`/lectures/${lectureId}/complete`, { enrollmentId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['learn', courseId, enrollmentId] });
      navigate(`/learn/${courseId}/${enrollmentId}`);
    },
  });

  if (isLoading || !data) return <LoadingRows rows={3} />;
  const l = data.lecture;

  return (
    <div className="mx-auto max-w-4xl">
      <button onClick={() => navigate(`/learn/${courseId}/${enrollmentId}`)} className="mb-4 text-sm text-muted hover:text-fg">← {t('common.back')}</button>
      <h1 className="mb-4 text-2xl font-semibold">{l.title}</h1>

      {l.youtubeVideoId === PLACEHOLDER_VIDEO_ID ? (
        // Заглушка: ссылки на видео ещё не предоставлены — показываем плашку,
        // а не битый плеер. Расшифровка ниже доступна и достаточна для прохождения.
        <div
          className="bg-inquiry-grid grid place-items-center rounded-2xl border border-dashed border-border bg-card text-center"
          style={{ aspectRatio: '16 / 9' }}
        >
          <div className="px-6">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-xl text-brand">▷</div>
            <div className="mt-3 font-semibold text-fg">{t('lecture.videoPending')}</div>
            <div className="mt-1 text-sm text-muted">{t('lecture.videoPendingHint')}</div>
          </div>
        </div>
      ) : l.youtubeVideoId ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-black" style={{ aspectRatio: '16 / 9' }}>
          <iframe
            title={l.title}
            src={`https://www.youtube-nocookie.com/embed/${l.youtubeVideoId}`}
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <Card className="text-center text-muted">{t('lecture.noVideo')}</Card>
      )}

      <Card className="mt-6 !p-6 sm:!p-8">
        <div className="mb-5 font-mono text-xs font-semibold uppercase tracking-wider text-brand">{t('lecture.transcript')}</div>
        <TranscriptView text={l.transcriptText} />
      </Card>

      {/* Мини-квиз после лекции — закрепление материала (тренировочный) */}
      <div className="mt-6">
        <MiniQuiz url={`/lectures/${lectureId}/mini-quiz`} enrollmentId={enrollmentId!} />
      </div>

      <div className="mt-6 flex justify-end">
        <Button size="lg" loading={complete.isPending} onClick={() => complete.mutate()}>✓ {t('lecture.markComplete')}</Button>
      </div>
    </div>
  );
}
