import { useState } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import type { LearnLecture, LearnModule, NextItem } from '../../lib/learn';
import { routes } from '../../lib/learn';
import { useFormat } from '../../lib/format';
import { Icon, KindIcon, ModeBadge, StatusIcon, TimeChip, type StatusState } from '../ui';
import { ModuleQuizCard, NextTag, PracticalCard } from './AssessmentCards';
import { cleanModuleTitle, cleanTitle, moduleCompleted, romanOf } from './labels';

/**
 * Модуль в программе курса (Yandex Practicum — липкая колонка модуля): слева (lg, sticky)
 * римская цифра, название, «3 лекции · 58 мин» и «2 из 3 лекций пройдено»; справа —
 * строки лекций (тип, номер, название, краткое содержание, длительность, «Далее»),
 * вложенная строка мини-квиза (Тренировка, без результата) и карточка оценивания.
 * Завершённый модуль по умолчанию свёрнут, текущий — раскрыт. Ничего не блокируется порядком.
 */
export function ModuleSection({
  module: m, courseId, enrollmentId, next, current, coversRange,
}: {
  module: LearnModule;
  courseId: string;
  enrollmentId: string;
  next: NextItem | null;
  /** В модуле рекомендуемый шаг */
  current: boolean;
  /** Для практикума: «I–IV» — модули, которые он охватывает */
  coversRange?: string;
}) {
  const { t } = useTranslation();
  const { formatDuration } = useFormat();
  const completed = moduleCompleted(m);
  const [open, setOpen] = useState(!completed || current);
  const roman = romanOf(m.orderIndex);
  const lectures = [...m.lectures].sort((a, b) => a.orderIndex - b.orderIndex);
  const done = lectures.filter((l) => l.completed).length;
  const total = lectures.length;
  const listId = `module-lectures-${m.id}`;
  const titleId = `module-title-${m.id}`;
  const state: StatusState = completed ? 'DONE' : done > 0 || current || m.state !== 'NOT_STARTED' ? 'IN_PROGRESS' : 'NOT_STARTED';
  const meta = [t('course.count.lectures', { count: total }), m.durationSec ? formatDuration(m.durationSec, 'human') : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <section
      id={`module-${m.id}`}
      aria-labelledby={titleId}
      className="scroll-mt-20 border-t border-border py-6 first:border-t-0 first:pt-0 last:pb-0 lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8"
    >
      <header className="lg:sticky lg:top-20 lg:self-start">
        <div className="flex items-baseline gap-3 lg:block">
          <span
            className={clsx(
              'shrink-0 font-display text-[28px] font-semibold leading-none lg:block lg:text-[40px] lg:leading-[1.05]',
              state === 'NOT_STARTED' ? 'text-fg-2' : 'text-fg',
            )}
            aria-hidden
          >
            {roman}
          </span>
          <h3 id={titleId} className="min-w-0 text-title lg:mt-2" title={m.title}>
            <span className="sr-only">{t('course.moduleNo', { roman })}. </span>
            {cleanModuleTitle(m.title)}
          </h3>
        </div>
        <p className="mt-1.5 text-meta text-fg-2">{meta}</p>
        <StatusIcon
          state={state}
          progress={total ? done / total : 0}
          size={24}
          withLabel
          label={completed ? t('course.syllabus.moduleDone') : t('course.syllabus.lecturesDone', { done, total })}
          className="mt-2"
        />
        {total > 0 && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((o) => !o)}
            className="mt-3 inline-flex min-h-[2.25rem] items-center gap-1 rounded-lg px-2 text-label font-semibold text-brand hover:bg-brand-soft"
          >
            {open ? t('course.syllabus.hideLectures') : t('course.syllabus.showLectures')}
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
          </button>
        )}
      </header>

      <div className="mt-4 min-w-0 space-y-4 lg:mt-0">
        {open && total > 0 && (
          <ol id={listId} className="overflow-hidden rounded-xl border border-border bg-card">
            {lectures.map((l, i) => (
              <LectureRow
                key={l.id}
                lecture={l}
                courseId={courseId}
                enrollmentId={enrollmentId}
                isNext={!!next && next.kind === 'LECTURE' && next.id === l.id}
                first={i === 0}
              />
            ))}
          </ol>
        )}
        {m.quiz && (
          <ModuleQuizCard
            quiz={m.quiz}
            roman={roman}
            courseId={courseId}
            enrollmentId={enrollmentId}
            isNext={!!next && next.kind === 'MODULE_QUIZ' && next.id === m.quiz.id}
          />
        )}
        {m.practicalTask && (
          <PracticalCard
            task={m.practicalTask}
            courseId={courseId}
            enrollmentId={enrollmentId}
            isNext={!!next && next.kind === 'PRACTICAL' && next.id === m.practicalTask.id}
            coversCourse={m.coversWholeCourse}
            coversRange={coversRange}
          />
        )}
      </div>
    </section>
  );
}

/** Строка лекции: вся строка — ссылка (растянутая), мини-квиз — отдельная вложенная ссылка. */
function LectureRow({
  lecture: l, courseId, enrollmentId, isNext, first,
}: {
  lecture: LearnLecture;
  courseId: string;
  enrollmentId: string;
  isNext: boolean;
  first: boolean;
}) {
  const { t } = useTranslation();
  const { formatDuration } = useFormat();
  const inProgress = !l.completed && l.positionSec > 0;
  const href = routes.lecture(courseId, enrollmentId, l.id, inProgress ? { t: l.positionSec } : {});
  return (
    <li id={`item-${l.id}`} className={clsx('scroll-mt-24', !first && 'border-t border-border', isNext && 'bg-spark/[0.07]')}>
      <div className="relative flex items-start gap-3 px-3 py-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-brand sm:px-4">
        {isNext && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-spark" aria-hidden />}
        <KindIcon kind="LECTURE" size={24} done={l.completed} current={isNext} className="mt-0.5" />
        <span className="num mt-0.5 w-9 shrink-0 text-fg-2" aria-hidden>
          {t('course.lectureNo', { n: l.lectureNumber })}
        </span>
        <div className="min-w-0 flex-1">
          <Link
            to={href}
            className="line-clamp-3 text-body font-medium text-fg outline-none sm:line-clamp-2 after:absolute after:inset-0 after:content-[''] hover:text-brand"
          >
            <span className="sr-only">
              {t('course.itemName.LECTURE', { n: l.lectureNumber })}
              {l.completed ? ` (${t('course.map.lecture.DONE')})` : ''}
              {isNext ? ` (${t('course.next')})` : ''}:{' '}
            </span>
            {cleanTitle(l.title)}
          </Link>
          {l.summary && <p className="mt-0.5 line-clamp-1 text-meta text-fg-2">{l.summary}</p>}
          {inProgress && <p className="mt-0.5 text-meta text-fg-2">{t('course.syllabus.resumeAt', { time: formatDuration(l.positionSec, 'clock') })}</p>}
        </div>
        {(isNext || l.durationSec) && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            {isNext && <NextTag />}
            {l.durationSec ? <TimeChip seconds={l.durationSec} /> : null}
          </div>
        )}
      </div>
      {l.miniQuizId && (
        <div className="pb-2.5 pl-[3.75rem] pr-3 sm:pl-[4.25rem] sm:pr-4">
          <Link
            to={routes.lecture(courseId, enrollmentId, l.id, { hash: 'mini-quiz' })}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 text-meta text-fg-2 transition-colors hover:bg-brand-soft/50 hover:text-fg"
          >
            <KindIcon kind="MINI_QUIZ" size={20} />
            <span className="min-w-0">{t('course.syllabus.miniQuiz', { count: l.miniQuestionCount })}</span>
            <ModeBadge mode="practice" />
          </Link>
        </div>
      )}
    </li>
  );
}
