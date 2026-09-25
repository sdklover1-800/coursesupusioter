import { clsx } from 'clsx';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ItemState, LearnView } from '../../lib/learn';
import { routes } from '../../lib/learn';
import { KindIcon, ModeBadge, StatusIcon, TimeChip } from '../ui';
import { Icon } from '../icons';
import { lectureDisplayTitle, moduleDisplayTitle, moduleRoman } from './lectureUtils';

/**
 * Содержание курса рядом с плеером (Khan lesson rail, screen_specs «Lecture player»).
 * Модуль за модулем (‹ ›): лекции (KindIcon, номер, название, длительность), вложенный
 * мини-квиз (тренировка), модульный тест (оценивание + статус) и итоговый практикум.
 * Текущая строка — полоса spark, aria-current=page, прокручивается в видимую область.
 * Порядок изучения свободный (USER_DECISIONS §3): замков нет, только отметки состояния.
 */

export type OutlineRow =
  | { kind: 'LECTURE'; key: string; id: string; number: number; title: string; completed: boolean; inProgress: boolean; durationSec: number | null; href: string; current: boolean }
  | { kind: 'MINI_QUIZ'; key: string; lectureId: string; count: number; href: string; current: boolean }
  | { kind: 'MODULE_QUIZ'; key: string; id: string; roman: string; state: ItemState; href: string; current: boolean }
  | { kind: 'PRACTICAL'; key: string; id: string; state: ItemState; href: string; current: boolean };

export interface OutlineModule {
  id: string;
  orderIndex: number;
  roman: string;
  title: string;
  lecturesDone: number;
  lecturesTotal: number;
  state: ItemState;
  rows: OutlineRow[];
}

function quizState(q: NonNullable<LearnView['version']['modules'][number]['quiz']>): ItemState {
  if (q.passed) return 'PASSED';
  if (q.finalReached) return 'FAILED';
  if (q.inProgressAttemptId || q.attemptsUsed > 0) return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

function practicalState(p: NonNullable<LearnView['version']['modules'][number]['practicalTask']>): ItemState {
  if (p.status === 'PASSED') return 'PASSED';
  if (p.status === 'FAILED') return p.final ? 'FAILED' : 'IN_PROGRESS';
  if (p.status === 'IN_PROGRESS') return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

/** Модель оглавления из карты курса (та же, что на странице курса: один кэш useLearnView). */
export function buildOutline(view: LearnView | undefined, courseId: string, enrollmentId: string, currentLectureId: string, atMiniQuiz: boolean): OutlineModule[] {
  if (!view?.version?.modules) return [];
  const modules = [...view.version.modules].sort((a, b) => a.orderIndex - b.orderIndex);
  return modules.map((m) => {
    const rows: OutlineRow[] = [];
    for (const l of [...m.lectures].sort((a, b) => a.orderIndex - b.orderIndex)) {
      const isCur = l.id === currentLectureId;
      rows.push({
        kind: 'LECTURE',
        key: `l-${l.id}`,
        id: l.id,
        number: l.lectureNumber,
        title: lectureDisplayTitle(l.title),
        completed: l.completed,
        inProgress: !l.completed && (l.positionSec > 0 || l.watchedPercent > 0),
        durationSec: l.durationSec,
        href: routes.lecture(courseId, enrollmentId, l.id),
        current: isCur && !atMiniQuiz,
      });
      if (l.miniQuizId) {
        rows.push({
          kind: 'MINI_QUIZ',
          key: `mq-${l.id}`,
          lectureId: l.id,
          count: l.miniQuestionCount,
          href: routes.lecture(courseId, enrollmentId, l.id, { hash: 'mini-quiz' }),
          current: isCur && atMiniQuiz,
        });
      }
    }
    if (m.quiz) {
      rows.push({ kind: 'MODULE_QUIZ', key: `q-${m.quiz.id}`, id: m.quiz.id, roman: moduleRoman(m.orderIndex), state: quizState(m.quiz), href: routes.quiz(courseId, enrollmentId, m.quiz.id), current: false });
    }
    if (m.practicalTask) {
      rows.push({ kind: 'PRACTICAL', key: `p-${m.practicalTask.id}`, id: m.practicalTask.id, state: practicalState(m.practicalTask), href: routes.practical(courseId, enrollmentId, m.practicalTask.id), current: false });
    }
    return {
      id: m.id,
      orderIndex: m.orderIndex,
      roman: moduleRoman(m.orderIndex),
      title: moduleDisplayTitle(m.title),
      lecturesDone: m.lecturesDone,
      lecturesTotal: m.lecturesTotal,
      state: m.state,
      rows,
    };
  });
}

/** Строки одного модуля (рельс на тёмной сцене и лист на мобильных). */
export function OutlineRows({
  rows, onNavigate, rowRef, compact,
}: {
  rows: OutlineRow[];
  onNavigate?: () => void;
  rowRef?: (el: HTMLAnchorElement | null) => void;
  /** Узкий рельс: у мини-квиза без счётчика вопросов (строка + плашка в одну линию) */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-0.5">
      {rows.map((r) => {
        const base = clsx(
          'relative flex min-h-[2.75rem] items-center gap-3 rounded-lg py-2 pr-2.5 transition-colors',
          r.current ? 'bg-fg/8' : 'hover:bg-fg/[0.05]',
        );
        const bar = r.current && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-spark" />;
        const common = {
          to: r.href,
          onClick: onNavigate,
          'aria-current': r.current ? ('page' as const) : undefined,
          ref: r.current ? rowRef : undefined,
        };
        if (r.kind === 'LECTURE') {
          return (
            <li key={r.key}>
              <Link {...common} className={clsx(base, 'pl-3')}>
                {bar}
                <KindIcon kind="LECTURE" done={r.completed} size={24} />
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="num shrink-0 text-fg-2">{r.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className={clsx('line-clamp-3 text-body', r.current ? 'font-semibold text-fg' : 'text-fg')}>{r.title}</span>
                    {/* Одна мета-строка под названием (§8): длительность и статус — название не теряет ширину */}
                    {(r.durationSec || r.completed || r.inProgress) && (
                      <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        {r.durationSec ? <TimeChip seconds={r.durationSec} className="shrink-0" /> : null}
                        {(r.completed || r.inProgress) && (
                          <StatusIcon state={r.completed ? 'DONE' : 'IN_PROGRESS'} size={14} withLabel className="[&>span]:!text-sm [&>span]:!font-medium [&>span]:!text-fg-2" />
                        )}
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          );
        }
        if (r.kind === 'MINI_QUIZ') {
          return (
            <li key={r.key}>
              <Link
                {...common}
                title={r.count > 0 ? `${t('lecture.outline.miniQuiz')} · ${t('lecture.questions', { count: r.count })}` : undefined}
                className={clsx(base, 'pl-10')}
              >
                {bar}
                <KindIcon kind="MINI_QUIZ" size={20} />
                <span className="min-w-0 flex-1 text-sm text-fg-2">
                  {t('lecture.outline.miniQuiz')}
                  {!compact && r.count > 0 && <> · {t('lecture.questions', { count: r.count })}</>}
                </span>
                <ModeBadge mode="practice" className="shrink-0" />
              </Link>
            </li>
          );
        }
        if (r.kind === 'MODULE_QUIZ') {
          return (
            <li key={r.key}>
              <Link {...common} className={clsx(base, 'pl-3')}>
                {bar}
                <KindIcon kind="MODULE_QUIZ" size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium text-fg">{t('lecture.outline.moduleQuizN', { roman: r.roman })}</span>
                  <ModeBadge mode="graded" className="mt-1" />
                </span>
                <StatusIcon state={r.state} size={20} />
              </Link>
            </li>
          );
        }
        return (
          <li key={r.key}>
            <Link {...common} className={clsx(base, 'pl-3')}>
              {bar}
              <KindIcon kind="PRACTICAL" size={24} />
              <span className="min-w-0 flex-1 text-body font-medium text-fg">{t('lecture.outline.practical')}</span>
              <StatusIcon state={r.state} size={20} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Рельс справа от плеера (xl+; на lg — лист OutlineSheet): высота как у сцены, внутренняя прокрутка. */
export function CourseOutlineRail({
  modules, currentModuleId, onCollapse, className,
}: {
  modules: OutlineModule[];
  currentModuleId: string | undefined;
  onCollapse: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const initial = Math.max(0, modules.findIndex((m) => m.id === currentModuleId));
  const [index, setIndex] = useState(initial);
  // Перешли к лекции другого модуля — показываем её модуль
  useEffect(() => setIndex(initial), [initial]);
  const mod = modules[index];
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentRow = useRef<HTMLAnchorElement | null>(null);

  // Текущая строка — в видимой области рельса (без прокрутки страницы)
  useLayoutEffect(() => {
    const box = scrollRef.current;
    const row = currentRow.current;
    if (!box || !row) return;
    const top = row.offsetTop - box.clientHeight / 3;
    box.scrollTop = Math.max(0, top);
  }, [index, mod?.id]);

  const progressText = useMemo(
    () => (mod ? t('lecture.outline.lecturesDone', { done: mod.lecturesDone, total: mod.lecturesTotal }) : ''),
    [mod, t],
  );

  return (
    <nav aria-label={t('lecture.outline.title')} className={clsx('flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]', className)}>
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 py-1.5 pl-4 pr-1.5">
        <span className="min-w-0 flex-1 truncate text-label text-fg-2">{t('lecture.outline.title')}</span>
        <button
          type="button"
          onClick={onCollapse}
          aria-label={t('lecture.outline.collapse')}
          title={t('lecture.outline.collapse')}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-fg-2 transition-colors hover:bg-white/10 hover:text-fg"
        >
          <Icon name="chevron-right" size={18} />
        </button>
      </div>
      {mod && (
        <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-1.5 py-2">
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            aria-label={t('lecture.outline.prevModule')}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-fg transition-colors hover:bg-white/10 disabled:opacity-30"
          >
            <Icon name="chevron-left" size={18} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <div className="line-clamp-2 text-body font-semibold leading-snug text-fg">
              <span className="font-display">{mod.roman}</span> · {mod.title}
            </div>
            <div className="mt-0.5 text-sm text-fg-2">{progressText}</div>
          </div>
          <button
            type="button"
            onClick={() => setIndex((i) => Math.min(modules.length - 1, i + 1))}
            disabled={index >= modules.length - 1}
            aria-label={t('lecture.outline.nextModule')}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-fg transition-colors hover:bg-white/10 disabled:opacity-30"
          >
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
      )}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-2">
        {mod && (
          <OutlineRows
            rows={mod.rows}
            compact
            rowRef={(el) => {
              currentRow.current = el;
            }}
          />
        )}
      </div>
    </nav>
  );
}
