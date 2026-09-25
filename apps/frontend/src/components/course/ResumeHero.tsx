import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import type { LearnView, MyCourseSummary, NextItem } from '../../lib/learn';
import type { MyEnrollment } from '../../lib/catalog';
import { useFormat } from '../../lib/format';
import { Icon, ModeBadge, QuestionGlyph, buttonClass } from '../ui';
import { cleanTitle, humanLeft, keepTogether, itemShortName, nextHref, quizInCooldown, romanOf, ytThumb } from './labels';
import { useNow } from './useNow';

/**
 * «Продолжить» — герой главной (MasterClass Continue Watching, Open edX Resume):
 * слева 16:9 — превью YouTube с полосой просмотра (лекция) или ink-панель (тест ◆,
 * практикум «?», сертификат); справа — курс, название шага, ОДНА мета-строка и кнопка,
 * которая называет действие. Данные — summary.next из /me/courses; карта курса (view)
 * есть только у первого курса (превью, длительность, попытки) — остальные без неё.
 */
export function ResumeHero({
  enrollment: e, summary, view, compact, className,
}: {
  enrollment: MyEnrollment;
  summary: MyCourseSummary;
  view?: LearnView;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { formatDuration, lng } = useFormat();
  const next = summary.next as NextItem;
  const modules = view?.version.modules ?? [];
  const module = modules.find((m) => m.id === next.moduleId);
  const lecture = next.kind === 'LECTURE' ? module?.lectures.find((l) => l.id === next.id) : undefined;
  const quiz = next.kind === 'MODULE_QUIZ' ? (module?.quiz?.id === next.id ? module.quiz : undefined) : undefined;
  const practical = next.kind === 'PRACTICAL' ? (module?.practicalTask?.id === next.id ? module.practicalTask : undefined) : undefined;
  const now = useNow(!!quiz?.cooldownUntil, 30_000);
  const cooldown = quiz ? quizInCooldown(quiz, now) : false;
  const roman = romanOf(next.moduleOrderIndex);
  const position = next.positionSec ?? lecture?.positionSec ?? 0;

  // Название шага и мета-строка (одна, fg-2 — §8)
  let title: string;
  let meta: (string | null | undefined)[];
  let cta: string;
  switch (next.kind) {
    case 'LECTURE':
      title = cleanTitle(next.title) || itemShortName(t, next);
      meta = [
        roman ? `${t('course.moduleNo', { roman })} · ${t('course.itemName.LECTURE', { n: next.lectureNumber ?? '' })}` : itemShortName(t, next),
        position > 0 ? t('student.resumeAt', { time: formatDuration(position, 'clock') }) : t('student.newLecture'),
        lecture?.durationSec ? keepTogether(formatDuration(lecture.durationSec, 'human')) : null,
      ];
      cta = position > 0 ? t('student.cta.LECTURE') : t('student.cta.LECTURE_START');
      break;
    case 'MODULE_QUIZ':
      title = t('course.itemName.MODULE_QUIZ', { roman });
      if (quiz && cooldown && quiz.cooldownUntil) {
        const left = humanLeft(new Date(quiz.cooldownUntil).getTime() - now, lng);
        meta = [roman ? t('course.moduleNo', { roman }) : null, left ? t('course.quiz.cooldown', { time: left }) : t('course.quiz.cooldownSoon')];
      } else if (quiz) {
        meta = [
          roman ? t('course.moduleNo', { roman }) : null,
          t('course.count.questions', { count: quiz.questionCount }),
          quiz.passed || quiz.finalReached ? null : t('course.quiz.attemptsLeft', { count: quiz.attemptsLeft }),
        ];
      } else {
        meta = [t('student.quizMetaShort')];
      }
      cta = t('student.cta.MODULE_QUIZ');
      break;
    case 'PRACTICAL':
      title = t('course.practical.title');
      meta = [t('student.practicalMeta', { answers: t('course.practical.answers', { count: practical?.maxAiMessages ?? 24 }) })];
      cta = t('student.cta.PRACTICAL');
      break;
    default:
      title = t('course.certificate.ready');
      meta = [t('student.certificateMeta')];
      cta = t('student.cta.CERTIFICATE');
  }
  const metaLine = meta.filter(Boolean).join(' · ');
  const href = nextHref(e.courseId, e.id, { ...next, positionSec: position });
  const thumb = lecture ? ytThumb(lecture.youtubeVideoId) : null;

  return (
    <article
      className={clsx(
        'card grid gap-4 p-4 sm:gap-5 sm:p-5',
        compact ? 'grid-cols-[112px_minmax(0,1fr)] items-start sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center' : 'md:grid-cols-[280px_minmax(0,1fr)] md:items-center',
        className,
      )}
    >
      <Media kind={next.kind} thumb={thumb} watched={lecture?.watchedPercent ?? 0} lectureNumber={next.lectureNumber} compact={compact} />
      <div className="min-w-0">
        <p className="eyebrow line-clamp-1" lang={e.languageVersion.language}>
          {e.languageVersion.title}
        </p>
        <h3 className={clsx('mt-1 line-clamp-2 text-fg', compact ? 'text-body-lg font-semibold' : 'text-title')} lang={e.languageVersion.language}>
          {title}
        </h3>
        <p className="mt-1.5 text-meta text-fg-2">{metaLine}</p>
        <Link
          to={href}
          className={buttonClass(next.kind === 'PRACTICAL' ? 'spark' : 'primary', compact ? 'md' : 'lg', clsx('mt-4 w-full sm:w-auto', !compact && '!h-12'))}
        >
          {cta}
          <Icon name="arrow-right" size={18} />
        </Link>
      </div>
    </article>
  );
}

/** Медиа-плитка 16:9: превью лекции или ink-панель по типу шага (внутри — тёмная палитра). */
function Media({
  kind, thumb, watched, lectureNumber, compact,
}: {
  kind: NextItem['kind'];
  thumb: string | null;
  watched: number;
  lectureNumber?: number;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const glyphSize = compact ? 36 : 52;
  if (kind === 'LECTURE' && thumb) {
    return (
      <div className="relative aspect-video overflow-hidden rounded-xl bg-stage">
        <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
        <span className="absolute inset-0 bg-gradient-to-t from-stage/60 via-transparent to-transparent" aria-hidden />
        <span
          className="absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-ink shadow-float"
          style={{ width: glyphSize, height: glyphSize }}
          aria-hidden
        >
          <Icon name="play" size={Math.round(glyphSize * 0.42)} fill="currentColor" className="translate-x-[1px]" />
        </span>
        {watched > 0 && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-white/25" aria-hidden>
            <span className="block h-full bg-brand-fill" style={{ width: `${Math.min(100, watched)}%` }} />
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="relative grid aspect-video place-items-center overflow-hidden rounded-xl bg-ink">
      <span className="bg-inquiry-grid absolute inset-0 opacity-40" aria-hidden />
      <span data-theme="dark" className={clsx('relative flex flex-col items-center text-fg', compact ? 'gap-1.5' : 'gap-3')}>
        {kind === 'MODULE_QUIZ' ? (
          <>
            <span className="grid place-items-center" style={{ width: glyphSize, height: glyphSize }} aria-hidden>
              <svg viewBox="0 0 10 10" width={glyphSize * 0.7} height={glyphSize * 0.7}>
                <path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" fill="none" stroke="currentColor" strokeWidth="0.7" />
              </svg>
            </span>
            <ModeBadge mode="graded" />
          </>
        ) : kind === 'PRACTICAL' ? (
          <QuestionGlyph size={glyphSize} />
        ) : kind === 'CERTIFICATE' ? (
          <span className="grid place-items-center rounded-full bg-spark text-ink" style={{ width: glyphSize, height: glyphSize }} aria-hidden>
            <Icon name="award" size={Math.round(glyphSize * 0.55)} />
          </span>
        ) : (
          <>
            <span className="grid place-items-center rounded-full bg-white/90 text-ink" style={{ width: glyphSize, height: glyphSize }} aria-hidden>
              <Icon name="play" size={Math.round(glyphSize * 0.42)} fill="currentColor" className="translate-x-[1px]" />
            </span>
            {lectureNumber && !compact ? <span className="text-label text-fg-2">{t('course.itemName.LECTURE', { n: lectureNumber })}</span> : null}
          </>
        )}
      </span>
    </div>
  );
}
