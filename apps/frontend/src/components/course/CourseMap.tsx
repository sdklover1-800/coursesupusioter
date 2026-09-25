import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CertificateStatus, LearnLecture, LearnModule, LearnModuleQuiz, LearnPractical, NextItem } from '../../lib/learn';
import { routes } from '../../lib/learn';
import { Card, Icon } from '../ui';
import { cleanModuleTitle, cleanTitle, practicalMapState, quizMapState, romanOf, type PracticalMapState, type QuizMapState } from './labels';

/**
 * Карта курса (Khan mastery grid → Scrimba path к сертификату): строка на модуль I–V,
 * квадрат на лекцию (контур — не начата, половина — начата, ink с галочкой — пройдена,
 * кольцо spark-ink + видимое «Далее» — рекомендуемый шаг), ◆ — модульный тест,
 * «?» — итоговый практикум, в конце — награда. Мини-квизы НЕ рисуются: результаты
 * тренировки никогда не показываются как достижение (валидность исследования).
 * Каждая клетка — ссылка с aria-label «<тип> <название>: <состояние>».
 */
export function CourseMap({
  courseId, enrollmentId, modules, next, certificate, className,
}: {
  courseId: string;
  enrollmentId: string;
  modules: LearnModule[];
  next: NextItem | null;
  certificate: CertificateStatus;
  className?: string;
}) {
  const { t } = useTranslation();
  const sorted = [...modules].sort((a, b) => a.orderIndex - b.orderIndex);
  const nextLabel = t('course.next');
  const isNext = (kind: NextItem['kind'], id: string) => !!next && next.kind === kind && next.id === id;
  const aria = (type: string, title: string, state: string, nextOne: boolean) =>
    t('course.map.aria', { type, title, state: nextOne ? `${state}, ${t('course.map.nextSuffix')}` : state })
      .replace(/\s+:/, ':')
      .trim();

  return (
    <Card className={clsx('!p-5 sm:!p-6', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-sans text-title">{t('course.map.title')}</h2>
        <p className="text-meta text-fg-2">{t('course.map.hint')}</p>
      </div>
      <ol className="mt-4 divide-y divide-border">
        {sorted.map((m, mi) => {
          const last = mi === sorted.length - 1;
          const started = m.state !== 'NOT_STARTED';
          return (
            <li
              key={m.id}
              className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 py-3 first:pt-1 last:pb-1 sm:grid-cols-[2.25rem_minmax(0,15rem)_minmax(0,1fr)] 2xl:grid-cols-[2.25rem_minmax(0,18rem)_minmax(0,1fr)]"
            >
              <span className={clsx('font-display text-display-md', started ? 'text-fg' : 'text-fg-2')} aria-hidden>
                {romanOf(m.orderIndex)}
              </span>
              {/* Название переносится, а не режется многоточием (kk длиннее на ~30%, §8) */}
              <a href={`#module-${m.id}`} className="min-w-0 break-words rounded text-meta text-fg-2 hover:text-fg">
                <span className="sr-only">{t('course.moduleNo', { roman: romanOf(m.orderIndex) })}: </span>
                {cleanModuleTitle(m.title)}
              </a>
              <div className="col-start-2 flex flex-wrap items-center gap-x-1.5 gap-y-2 sm:col-start-3">
                {[...m.lectures]
                  .sort((a, b) => a.orderIndex - b.orderIndex)
                  .map((l) => {
                    const nx = isNext('LECTURE', l.id);
                    const st = lectureMapState(l);
                    return (
                      <MapCell key={l.id} nextLabel={nx ? nextLabel : undefined}>
                        <Link
                          to={routes.lecture(courseId, enrollmentId, l.id, l.positionSec > 0 && !l.completed ? { t: l.positionSec } : {})}
                          aria-label={aria(t('ui.kind.LECTURE'), `${l.lectureNumber}. ${cleanTitle(l.title)}`, t(`course.map.lecture.${st}`), nx)}
                          title={`${t('course.itemName.LECTURE', { n: l.lectureNumber })}: ${cleanTitle(l.title)}`}
                          className={clsx(
                            'lip grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors',
                            st === 'DONE' && 'border-ink bg-ink text-white !border-b-ink dark:border-fg dark:bg-fg dark:text-card dark:!border-b-fg',
                            st === 'IN_PROGRESS' && 'border-brand/60',
                            st === 'NOT_STARTED' && 'border-border-strong bg-card hover:border-brand/60',
                            nx && 'ring-2 ring-spark-ink ring-offset-2 ring-offset-card',
                          )}
                          style={st === 'IN_PROGRESS' ? { background: 'linear-gradient(to top, rgb(var(--brand) / 0.55) 50%, rgb(var(--card)) 50%)' } : undefined}
                        >
                          {st === 'DONE' && <Icon name="check" size={14} strokeWidth={3} />}
                        </Link>
                      </MapCell>
                    );
                  })}
                {m.quiz && (
                  <MapCell nextLabel={isNext('MODULE_QUIZ', m.quiz.id) ? nextLabel : undefined} className="ml-1">
                    <QuizDiamond
                      quiz={m.quiz}
                      href={routes.quiz(courseId, enrollmentId, m.quiz.id)}
                      next={isNext('MODULE_QUIZ', m.quiz.id)}
                      label={aria(
                        t('ui.kind.MODULE_QUIZ'),
                        romanOf(m.orderIndex),
                        t(`course.map.quiz.${quizMapState(m.quiz)}`),
                        isNext('MODULE_QUIZ', m.quiz.id),
                      )}
                    />
                  </MapCell>
                )}
                {m.practicalTask && (
                  <MapCell nextLabel={isNext('PRACTICAL', m.practicalTask.id) ? nextLabel : undefined} className="ml-1">
                    <PracticalChip
                      task={m.practicalTask}
                      href={routes.practical(courseId, enrollmentId, m.practicalTask.id)}
                      next={isNext('PRACTICAL', m.practicalTask.id)}
                      label={aria(
                        t('ui.kind.PRACTICAL'),
                        '',
                        t(`course.map.practical.${practicalMapState(m.practicalTask)}`),
                        isNext('PRACTICAL', m.practicalTask.id),
                      )}
                    />
                  </MapCell>
                )}
                {last && (
                  <>
                    <span className="mx-0.5 h-px w-4 bg-border-strong" aria-hidden />
                    <CertificateNode certificate={certificate} next={isNext('CERTIFICATE', next?.id ?? '')} />
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <Legend />
    </Card>
  );
}

type LectureMapState = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE';
function lectureMapState(l: LearnLecture): LectureMapState {
  if (l.completed) return 'DONE';
  if ((l.positionSec ?? 0) > 0 || (l.watchedPercent ?? 0) > 0) return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

/** Клетка карты; у рекомендуемой — видимая подпись «Далее» справа (A24: не только цвет). */
function MapCell({ children, nextLabel, className }: { children: ReactNode; nextLabel?: string; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center', nextLabel ? 'mr-1.5 gap-2' : 'gap-1.5', className)}>
      {children}
      {nextLabel && (
        <span className="text-small font-semibold text-spark-ink" aria-hidden>
          {nextLabel}
        </span>
      )}
    </span>
  );
}

/** ◆ модульного теста: контур — не начат, кольцо с точкой — есть попытки, ✓ teal-ink — сдан, ✗ danger-ink — исчерпан. */
function QuizDiamond({ quiz, href, next, label }: { quiz: LearnModuleQuiz; href: string; next: boolean; label: string }) {
  const st: QuizMapState = quizMapState(quiz);
  const shape = clsx(
    'absolute left-1/2 top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] border-2',
    st === 'NOT_STARTED' && 'border-ink/70 bg-card dark:border-fg/70',
    (st === 'ATTEMPTED' || st === 'IN_PROGRESS') && 'border-ink bg-card dark:border-fg',
    st === 'PASSED' && 'border-teal-ink bg-teal/12',
    st === 'FAILED' && 'border-danger-ink bg-card',
  );
  return (
    <Link
      to={href}
      aria-label={label}
      title={label}
      className={clsx('relative grid h-7 w-7 shrink-0 place-items-center rounded-md', next && 'ring-2 ring-spark-ink ring-offset-2 ring-offset-card')}
    >
      <span className={shape} aria-hidden />
      <span className="relative" aria-hidden>
        {(st === 'ATTEMPTED' || st === 'IN_PROGRESS') && <span className="block h-1.5 w-1.5 rounded-full bg-ink dark:bg-fg" />}
        {st === 'PASSED' && <Icon name="check" size={12} strokeWidth={3} className="text-teal-ink" />}
        {st === 'FAILED' && <Icon name="x" size={12} strokeWidth={3} className="text-danger-ink" />}
      </span>
    </Link>
  );
}

/** «?» итогового практикума: те же состояния; замок — только окно доступности. */
function PracticalChip({ task, href, next, label }: { task: LearnPractical; href: string; next: boolean; label: string }) {
  const st: PracticalMapState = practicalMapState(task);
  return (
    <Link
      to={href}
      aria-label={label}
      title={label}
      className={clsx(
        'grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 font-display text-sm font-bold leading-none',
        st === 'NOT_STARTED' && 'border-spark bg-card text-spark-ink',
        (st === 'IN_PROGRESS' || st === 'ATTEMPTED') && 'border-spark-ink bg-spark text-ink',
        st === 'PASSED' && 'border-teal-ink bg-teal/12 text-teal-ink',
        st === 'FAILED' && 'border-danger-ink bg-card text-danger-ink',
        st === 'LOCKED' && 'border-dashed border-border-strong bg-card text-fg-2',
        next && 'ring-2 ring-spark-ink ring-offset-2 ring-offset-card',
      )}
    >
      {st === 'PASSED' ? (
        <Icon name="check" size={14} strokeWidth={3} />
      ) : st === 'FAILED' ? (
        <Icon name="x" size={14} strokeWidth={3} />
      ) : st === 'LOCKED' ? (
        <Icon name="lock" size={13} strokeWidth={2} />
      ) : (
        <span aria-hidden>?</span>
      )}
    </Link>
  );
}

/** Награда в конце пути: spark-ink — выдан; ссылка в «Сертификаты». */
function CertificateNode({ certificate, next }: { certificate: CertificateStatus; next: boolean }) {
  const { t } = useTranslation();
  const state = certificate.issued ? 'issued' : certificate.eligible ? 'eligible' : 'notYet';
  const label = t('course.map.aria', { type: t('ui.kind.CERTIFICATE'), title: '', state: t(`course.map.certificate.${state}`) }).replace(/\s+:/, ':');
  return (
    <Link
      to={routes.certificates()}
      aria-label={label}
      title={label}
      className={clsx(
        'grid h-7 w-7 shrink-0 place-items-center rounded-full border-2',
        certificate.issued ? 'border-spark-ink bg-spark text-ink' : certificate.eligible ? 'border-teal-ink text-teal-ink' : 'border-border-strong bg-card text-fg-2',
        next && 'ring-2 ring-spark-ink ring-offset-2 ring-offset-card',
      )}
    >
      <Icon name="award" size={15} strokeWidth={2} />
    </Link>
  );
}

/** Легенда одной строкой (Onest 13–14px, fg-2 — §12, без моно-капса). */
function Legend() {
  const { t } = useTranslation();
  const item = (glyph: ReactNode, text: string) => (
    <li className="inline-flex items-center gap-1.5">
      {glyph}
      <span>{text}</span>
    </li>
  );
  const sq = 'inline-block h-3.5 w-3.5 rounded-[3px] border';
  return (
    <div className="mt-4 border-t border-border pt-3">
      <h3 className="sr-only">{t('course.map.legend.title')}</h3>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-small text-fg-2" aria-label={t('course.map.legend.title')}>
        {item(<span className={clsx(sq, 'border-border-strong bg-card')} aria-hidden />, t('course.map.legend.notStarted'))}
        {item(
          <span
            className={clsx(sq, 'border-brand/60')}
            style={{ background: 'linear-gradient(to top, rgb(var(--brand) / 0.55) 50%, rgb(var(--card)) 50%)' }}
            aria-hidden
          />,
          t('course.map.legend.inProgress'),
        )}
        {item(
          <span className={clsx(sq, 'grid place-items-center border-ink bg-ink text-white dark:border-fg dark:bg-fg dark:text-card')} aria-hidden>
            <Icon name="check" size={10} strokeWidth={3} />
          </span>,
          t('course.map.legend.done'),
        )}
        {item(<span className={clsx(sq, 'border-border-strong bg-card ring-2 ring-spark-ink ring-offset-1 ring-offset-card')} aria-hidden />, t('course.map.legend.next'))}
        {item(<span className="inline-block h-3 w-3 rotate-45 rounded-[2px] border-2 border-ink/70 dark:border-fg/70" aria-hidden />, t('course.map.legend.quiz'))}
        {item(
          <span className="grid h-[18px] w-[18px] place-items-center rounded-full border-2 border-spark font-display text-small font-bold leading-none text-spark-ink" aria-hidden>
            ?
          </span>,
          t('course.map.legend.practical'),
        )}
        {item(<Icon name="award" size={16} className="text-fg-2" />, t('course.map.legend.certificate'))}
      </ul>
    </div>
  );
}
