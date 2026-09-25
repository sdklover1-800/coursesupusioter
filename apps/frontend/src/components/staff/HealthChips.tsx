import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { useFormat } from '../../lib/format';
import type { StaffLecture } from '../../lib/staff';
import { Icon } from '../icons';
import { MetaChip } from './primitives';

/**
 * «Здоровье» лекции в редакторе курса (FE5 §1, screen_specs «Manager»): видео (есть /
 * заглушка), объём расшифровки, мини-квиз (ссылка в редактор), длительность (правка —
 * в листе лекции) и отметка краткого содержания. Цвет всегда дублируется текстом и иконкой.
 */
export function HealthChips({
  lecture, courseId, onEditDuration, className,
}: {
  lecture: StaffLecture;
  courseId: string;
  /** Клик по длительности — открыть лист лекции на поле длительности */
  onEditDuration?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const { formatDuration, formatNumber } = useFormat();
  const kChars = lecture.transcriptChars >= 1000 ? Math.round(lecture.transcriptChars / 1000) : null;

  return (
    <div className={clsx('flex flex-wrap items-center gap-1.5', className)}>
      {lecture.hasVideo ? (
        <MetaChip icon="play" tone="plain">{t('manager.health.video')}</MetaChip>
      ) : (
        <MetaChip icon="alert" tone="spark">{t('manager.health.videoPlaceholder')}</MetaChip>
      )}

      {lecture.transcriptChars > 0 ? (
        <MetaChip icon="file-text" tone="plain" title={t('manager.health.transcriptTitle', { count: lecture.transcriptChars })}>
          {kChars !== null
            ? t('manager.health.transcriptK', { value: formatNumber(kChars) })
            : t('manager.health.transcriptChars', { value: formatNumber(lecture.transcriptChars) })}
        </MetaChip>
      ) : (
        <MetaChip icon="alert" tone="danger">{t('manager.health.noTranscript')}</MetaChip>
      )}

      {lecture.miniQuizId ? (
        <Link
          to={`/manage/quiz/${lecture.miniQuizId}?course=${courseId}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-brand/30 bg-brand-soft/60 px-2 py-0.5 text-small font-medium text-brand transition-colors hover:border-brand"
        >
          <Icon name="list-check" size={14} />
          {t('manager.health.mini', { count: lecture.miniQuestionCount })}
        </Link>
      ) : (
        <MetaChip icon="list-check" tone="muted">{t('manager.health.noMini')}</MetaChip>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onEditDuration?.();
        }}
        className={clsx(
          'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-small font-medium transition-colors',
          lecture.durationSec ? 'border border-border bg-card text-fg-2 hover:border-brand/50' : 'bg-spark/15 text-spark-ink hover:bg-spark/25',
        )}
        title={t('manager.health.durationEdit')}
      >
        <Icon name="clock" size={14} />
        {lecture.durationSec ? <span className="num text-small">{formatDuration(lecture.durationSec, 'clock')}</span> : t('manager.health.noDuration')}
      </button>

      {lecture.hasSummary ? (
        <MetaChip icon="check" tone="teal">{t('manager.health.summary')}</MetaChip>
      ) : (
        <MetaChip tone="plain">{t('manager.health.noSummary')}</MetaChip>
      )}
    </div>
  );
}
