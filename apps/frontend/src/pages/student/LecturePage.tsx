import { clsx } from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import {
  hrefForItem, invalidateLearning, learnKeys, routes, useLearnView,
  type LearnView, type LectureView, type NextItem, type ProgressBreakdown,
} from '../../lib/learn';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { formatDuration } from '../../lib/format';
import { activeSectionAt, parseTranscript, readingMinutes, type TranscriptSection } from '../../lib/transcript';
import { YT_STATE } from '../../lib/youtube';
import { Breadcrumb, toast } from '../../components/ui';
import { Icon } from '../../components/icons';
import { LoadingRows } from '../../components/page';
import { ContentError } from '../../components/enrollment';
import { TranscriptView } from '../../components/TranscriptView';
import { MiniQuiz } from '../../components/MiniQuiz';
import { ReportIssueButton } from '../../components/ReportIssue';
import { useYouTubePlayer } from '../../components/lecture/useYouTubePlayer';
import { useProgressSaver } from '../../components/lecture/useProgressSaver';
import { LectureStage, ReadingModeBanner, useMediaQuery } from '../../components/lecture/LectureStage';
import { ChapterStrip } from '../../components/lecture/ChapterStrip';
import { LectureActionBar, type NavTarget } from '../../components/lecture/LectureActionBar';
import { buildOutline, CourseOutlineRail } from '../../components/lecture/CourseOutlineRail';
import { OutlineSheet } from '../../components/lecture/OutlineSheet';
import { EndOfLectureOverlay } from '../../components/lecture/EndOfLectureOverlay';
import { ContentTabs, TermsList, type LectureTab } from '../../components/lecture/ContentTabs';
import { KeyboardHelp } from '../../components/lecture/KeyboardHelp';
import {
  isTypingTarget, lectureDisplayTitle, moduleDisplayTitle, moduleRoman, prefersReducedMotion, readFlag, targetLabel, writeFlag,
} from '../../components/lecture/lectureUtils';

/**
 * Страница лекции — «театральная» раскладка (FR-4.2, FR-4.4, FR-4.5; screen_specs
 * «Lecture player (theater layout)» и «Transcript»):
 * хлебные крошки → тёмная сцена во всю ширину [плеер + полоса разделов + панель действий |
 * содержание курса 340px] → заголовок, мета, «как засчитывается» → вкладки
 * «Конспект | Кратко | Термины | Мини-квиз». На мобильных плеер липнет сверху,
 * снизу — панель [‹] [☰ II · 2/3] [✓] [Далее ›]. Видео-заглушка — режим чтения.
 * Порядок изучения свободный (USER_DECISIONS §3): «Далее» — только рекомендация;
 * мини-квиз — тренировка (не влияет на результат).
 */
export function LecturePage() {
  const { courseId, enrollmentId, lectureId } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: learnKeys.lecture(lectureId, enrollmentId),
    queryFn: () => api.get<{ lecture: LectureView }>(`/lectures/${lectureId}?enrollmentId=${enrollmentId}`),
    enabled: !!lectureId && !!enrollmentId,
  });

  if (error) return <ContentError error={error} courseId={courseId} enrollmentId={enrollmentId} />;
  if (isLoading || !data || !courseId || !enrollmentId) return <LectureSkeleton />;
  // key: другая лекция — новый экран (плеер, сохранение позиции, вкладки начинаются заново)
  return <LectureScreen key={data.lecture.id} lecture={data.lecture} courseId={courseId} enrollmentId={enrollmentId} />;
}

function LectureSkeleton() {
  return (
    <div>
      <div className="mb-4 h-5 w-64 rounded bg-border/60" />
      <div className="stage -mx-4 aspect-video sm:-mx-6 sm:aspect-auto sm:h-[26rem] lg:-mx-8" />
      <div className="mt-6">
        <LoadingRows rows={3} />
      </div>
    </div>
  );
}

interface CompleteResponse {
  ok: boolean;
  progress: ProgressBreakdown | null;
  next: NextItem | null;
}

/** Карта курса после отметки «пройдено» — сразу, до повторной загрузки (рельс и CourseMap). */
function markLectureDone(old: LearnView | undefined, lectureId: string, res: CompleteResponse): LearnView | undefined {
  if (!old?.version?.modules) return old;
  const modules = old.version.modules.map((m) => {
    if (!m.lectures.some((l) => l.id === lectureId && !l.completed)) return m;
    const lectures = m.lectures.map((l) => (l.id === lectureId ? { ...l, completed: true } : l));
    return { ...m, lectures, lecturesDone: lectures.filter((l) => l.completed).length, state: m.state === 'NOT_STARTED' ? ('IN_PROGRESS' as const) : m.state };
  });
  return {
    ...old,
    version: { ...old.version, modules },
    progress: res.progress ?? old.progress,
    next: res.next,
    enrollment: res.progress ? { ...old.enrollment, progressPercent: res.progress.percent } : old.enrollment,
  };
}

const OUTLINE_KEY = 'eduopen.outline.collapsed';
const SEARCH_INPUT_ID = 'lecture-transcript-search';

function LectureScreen({ lecture, courseId, enrollmentId }: { lecture: LectureView; courseId: string; enrollmentId: string }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const displayTitle = lectureDisplayTitle(lecture.title);
  useDocumentTitle(displayTitle);

  const learn = useLearnView(courseId, enrollmentId);
  const view = learn.data;
  const parsed = useMemo(() => parseTranscript(lecture.transcriptText), [lecture.transcriptText]);
  const timeline = useMemo(() => parsed.sections.filter((s) => s.onTimeline), [parsed]);
  const isLg = useMediaQuery('(min-width: 1024px)');

  /* ── Точка старта: ?t= или сохранённая позиция (> 30 с и не у самого конца), A14 ── */
  const start = useRef<{ sec: number; resumed: boolean } | null>(null);
  if (!start.current) {
    const raw = params.get('t');
    const fromUrl = raw !== null && raw !== '' ? Number(raw) : NaN;
    if (Number.isFinite(fromUrl) && fromUrl >= 0) start.current = { sec: Math.floor(fromUrl), resumed: false };
    else {
      const pos = lecture.positionSec ?? 0;
      const dur = lecture.durationSec;
      const ok = pos > 30 && (!dur || pos < dur - 30);
      start.current = { sec: ok ? pos : 0, resumed: ok };
    }
  }
  const player = useYouTubePlayer(lecture.youtubeVideoId, { startSec: start.current.sec, lang: i18n.language });
  const readingMode = player.readingMode;

  useProgressSaver({ lectureId: lecture.id, enrollmentId, player, baseWatchedSec: lecture.watchedSec ?? 0, enabled: !readingMode });

  // «Продолжаем с 12:40 · С начала» — один раз за визит
  const resumeToast = useRef(false);
  useEffect(() => {
    if (resumeToast.current || readingMode || !start.current?.resumed) return;
    resumeToast.current = true;
    toast(t('lecture.resume', { time: formatDuration(start.current.sec, 'clock') }), 'brand', {
      action: { label: t('lecture.fromStart'), onClick: () => player.restart() },
      duration: 8000,
    });
    // один раз при входе
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Длительность стала известна, а сохранённая позиция — у самого конца: начинаем с начала
  useEffect(() => {
    if (!start.current?.resumed || player.duration <= 0) return;
    if (start.current.sec > player.duration - 30) {
      start.current = { sec: 0, resumed: false };
      player.restart();
    }
  }, [player.duration, player]);

  /* ── Вкладки и якорь #mini-quiz ── */
  const hasSummary = !!lecture.summary?.trim();
  const hasTerms = parsed.terms.length > 0;
  const hasMini = !!lecture.miniQuizId;
  const atMini = location.hash === '#mini-quiz';
  const [tab, setTab] = useState<LectureTab>(atMini && hasMini ? 'mini' : 'transcript');
  const [query, setQuery] = useState('');
  const smooth: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';

  useEffect(() => {
    if (!atMini || !hasMini) return;
    setTab('mini');
    const id = window.requestAnimationFrame(() => document.getElementById('mini-quiz')?.scrollIntoView({ block: 'start', behavior: smooth }));
    return () => window.cancelAnimationFrame(id);
    // smooth — производная от настроек, не триггер
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atMini, hasMini]);

  /* ── Экран окончания видео (и ?simulateEnd=1 только в dev — для скриншотов) ── */
  const simulateEnd = import.meta.env.DEV && params.get('simulateEnd') === '1';
  const [overlayDismissed, setOverlayDismissed] = useState(false);
  useEffect(() => {
    if (player.state === YT_STATE.ENDED) setOverlayDismissed(false);
  }, [player.state]);
  const overlayOpen = !readingMode && (player.state === YT_STATE.ENDED || simulateEnd) && !overlayDismissed;

  const openMiniQuiz = useCallback(() => {
    setOverlayDismissed(true);
    setTab('mini');
    if (atMini) document.getElementById('mini-quiz')?.scrollIntoView({ block: 'start', behavior: smooth });
    else navigate({ pathname: location.pathname, search: location.search, hash: 'mini-quiz' }, { replace: true });
  }, [atMini, navigate, location.pathname, location.search, smooth]);

  /* ── Карта курса: рельс, счётчик мини-квиза, состояние «пройдено» ── */
  const lectureInView = useMemo(() => view?.version?.modules.flatMap((m) => m.lectures).find((l) => l.id === lecture.id), [view, lecture.id]);
  const miniCount = hasMini ? lectureInView?.miniQuestionCount ?? 0 : null;
  const outline = useMemo(() => buildOutline(view, courseId, enrollmentId, lecture.id, atMini), [view, courseId, enrollmentId, lecture.id, atMini]);
  const completedNow = lecture.completed || !!lectureInView?.completed;

  /* ── «Отметить пройденной»: без перехода; кэш обновляется на месте ── */
  const complete = useMutation({
    mutationFn: () => api.post<CompleteResponse>(`/lectures/${lecture.id}/complete`, { enrollmentId }),
    onSuccess: (res) => {
      qc.setQueryData<{ lecture: LectureView }>(learnKeys.lecture(lecture.id, enrollmentId), (old) => (old ? { lecture: { ...old.lecture, completed: true } } : old));
      qc.setQueryData<LearnView>(learnKeys.learn(courseId, enrollmentId), (old) => markLectureDone(old, lecture.id, res));
      toast(t('lecture.doneToast'), 'teal');
      void invalidateLearning(qc);
    },
    onError: () => toast(t('lecture.doneFailed'), 'danger'),
  });
  const onComplete = () => {
    if (!completedNow && !complete.isPending) complete.mutate();
  };

  /* ── Навигация: «Далее» по типу цели, «Назад» ── */
  const nextTarget: NavTarget = useMemo(() => {
    if (hasMini && !atMini) return { label: t('lecture.nextLabel', { target: t('lecture.target.miniQuiz') }), onClick: openMiniQuiz };
    if (lecture.next) {
      const label = t('lecture.nextLabel', { target: targetLabel(t, lecture.next) });
      return { label, ariaLabel: `${label} — ${lectureDisplayTitle(lecture.next.title)}`, href: hrefForItem(courseId, enrollmentId, lecture.next) };
    }
    return { label: t('lecture.toCourse'), href: routes.course(courseId, enrollmentId) };
  }, [hasMini, atMini, lecture.next, t, openMiniQuiz, courseId, enrollmentId]);
  const prevTarget: NavTarget | null = lecture.prev
    ? {
        label: targetLabel(t, lecture.prev),
        ariaLabel: t('lecture.prevLabel', { target: `${targetLabel(t, lecture.prev)} — ${lectureDisplayTitle(lecture.prev.title)}` }),
        href: hrefForItem(courseId, enrollmentId, lecture.prev),
      }
    : null;
  const overlayNext = lecture.next
    ? {
        label:
          lecture.next.kind === 'LECTURE'
            ? t('lecture.end.nextLecture', { title: lectureDisplayTitle(lecture.next.title) })
            : t('lecture.end.next', { title: targetLabel(t, lecture.next) }),
        href: hrefForItem(courseId, enrollmentId, lecture.next),
      }
    : null;
  const goNext = () => {
    if (nextTarget.onClick) nextTarget.onClick();
    else if (nextTarget.href) navigate(nextTarget.href);
  };

  /* ── Перемотка: на планшете прокручиваем к плееру; на десктопе его подхватит мини-плеер ── */
  const stageRef = useRef<HTMLElement>(null);
  const seek = useCallback(
    (sec: number) => {
      setOverlayDismissed(true);
      player.seekTo(sec, true);
      if (!isLg) {
        const el = stageRef.current;
        const r = el?.getBoundingClientRect();
        if (el && r && (r.bottom < 80 || r.top > window.innerHeight - 80)) el.scrollIntoView({ block: 'start', behavior: smooth });
      }
    },
    [player, isLg, smooth],
  );
  const seekSection = useCallback((s: TranscriptSection) => s.startSec !== null && seek(s.startSec), [seek]);
  const active = readingMode ? null : activeSectionAt(parsed.sections, player.currentTime);

  /* ── Содержание: рельс (lg+, сворачивается) или лист ── */
  const [railCollapsed, setRailCollapsed] = useState(() => readFlag(OUTLINE_KEY));
  const [sheetOpen, setSheetOpen] = useState(false);
  const railOpen = !railCollapsed && !readingMode;
  const setCollapsed = (v: boolean) => {
    setRailCollapsed(v);
    writeFlag(OUTLINE_KEY, v);
  };
  const onOutlineButton = () => {
    if (isLg && !readingMode) setCollapsed(false);
    else setSheetOpen(true);
  };

  /* ── Горячие клавиши: K, J/L, /, N, ? (не в полях ввода и не в диалогах) ── */
  const [helpOpen, setHelpOpen] = useState(false);
  const keyActions = useRef({ player, goNext, readingMode });
  keyActions.current = { player, goNext, readingMode };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.target instanceof Element && e.target.closest('[role="dialog"][aria-modal="true"], [role="menu"]')) return;
      const a = keyActions.current;
      // e.code — физическая клавиша: работает и в русской/казахской раскладке
      switch (e.code) {
        case 'KeyK':
          if (a.readingMode) return;
          e.preventDefault();
          if (a.player.playing) a.player.pause();
          else a.player.play();
          break;
        case 'KeyJ':
          if (a.readingMode) return;
          e.preventDefault();
          a.player.seekTo(Math.max(0, a.player.getTime() - 10), a.player.playing);
          break;
        case 'KeyL':
          if (a.readingMode) return;
          e.preventDefault();
          a.player.seekTo(a.player.getTime() + 10, a.player.playing);
          break;
        case 'KeyN':
          e.preventDefault();
          a.goNext();
          break;
        case 'Slash':
          e.preventDefault();
          if (e.shiftKey) {
            setHelpOpen((o) => !o);
            break;
          }
          setTab('transcript');
          window.requestAnimationFrame(() => document.getElementById(SEARCH_INPUT_ID)?.focus());
          break;
        default:
          break;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* ── Мета: «Видео ≈ 22 мин · конспект ≈ 11 мин чтения» ── */
  const durationSec = lecture.durationSec ?? (player.duration > 0 ? player.duration : null);
  const metaParts = [
    !readingMode && durationSec ? t('lecture.meta.video', { duration: formatDuration(durationSec, 'human', i18n.language) }) : null,
    parsed.wordCount > 0 ? t('lecture.meta.reading', { min: readingMinutes(parsed.wordCount) }) : null,
  ].filter(Boolean);
  const roman = moduleRoman(lecture.module.orderIndex);

  const crumbs = [
    { label: t('nav.myCourses'), to: routes.home() },
    ...(view?.version?.title ? [{ label: view.version.title, to: routes.course(courseId, enrollmentId) }] : []),
    { label: `${roman}. ${moduleDisplayTitle(lecture.module.title)}`, to: routes.course(courseId, enrollmentId) },
    { label: t('lecture.lectureN', { n: lecture.lectureNumber }) },
  ];

  const transcriptTop = readingMode
    ? 'top-[calc(52px+env(safe-area-inset-top,0px))] lg:top-14'
    : 'max-sm:top-[calc(56.25vw+12px+env(safe-area-inset-top,0px))] sm:top-[calc(52px+env(safe-area-inset-top,0px))] lg:top-14';

  return (
    <div>
      {/* Хлебные крошки; на мобильных — «‹ Модуль II · Лекция 5» */}
      <Breadcrumb items={crumbs} className="mb-4 hidden sm:block" />
      <Link
        to={routes.course(courseId, enrollmentId)}
        className="-mt-2 mb-3 inline-flex min-h-[2.75rem] max-w-full items-center gap-1 rounded-md text-sm font-medium text-fg-2 hover:text-fg sm:hidden"
      >
        <Icon name="chevron-left" size={16} />
        <span className="truncate">{t('lecture.crumbShort', { roman, n: lecture.lectureNumber })}</span>
      </Link>

      {/* Сцена: тёмная полоса во всю ширину (от полей оболочки GUTTER) */}
      <section
        ref={stageRef}
        data-theme="dark"
        aria-label={t('lecture.player')}
        className={clsx(
          'stage relative -mx-4 text-fg sm:-mx-6 sm:px-6 sm:py-6 lg:-mx-8 lg:px-8 lg:py-7',
          readingMode ? 'px-4 py-4' : 'max-sm:sticky max-sm:top-[env(safe-area-inset-top,0px)] max-sm:z-[35]',
        )}
      >
        <div className={clsx(railOpen && 'lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6')}>
          <div className="min-w-0">
            {readingMode ? (
              <ReadingModeBanner />
            ) : (
              <LectureStage
                player={player}
                videoId={lecture.youtubeVideoId}
                title={displayTitle}
                overlay={(docked) => (
                  <EndOfLectureOverlay
                    open={overlayOpen && !docked}
                    onClose={() => setOverlayDismissed(true)}
                    lectureNumber={lecture.lectureNumber}
                    lecturesTotal={lecture.lecturesTotal}
                    miniQuizCount={miniCount}
                    onMiniQuiz={openMiniQuiz}
                    next={overlayNext}
                    onReplay={() => {
                      setOverlayDismissed(true);
                      player.seekTo(0, true);
                    }}
                    completed={completedNow}
                    onComplete={onComplete}
                    completing={complete.isPending}
                  />
                )}
              />
            )}
            {!readingMode && timeline.length > 1 && (
              <>
                <ChapterStrip sections={timeline} duration={durationSec ?? 0} currentTime={player.currentTime} onSeek={seek} className="mt-3 hidden sm:flex" />
                <ChapterStrip sections={timeline} duration={durationSec ?? 0} currentTime={player.currentTime} onSeek={seek} variant="mobile" className="sm:hidden" />
              </>
            )}
            <LectureActionBar
              className={clsx('hidden sm:flex', readingMode ? 'mt-4' : 'mt-2')}
              prev={prevTarget}
              completed={completedNow}
              completing={complete.isPending}
              onComplete={onComplete}
              sections={readingMode ? [] : timeline}
              activeSection={active}
              onSeekSection={seekSection}
              next={nextTarget}
              outline={{ onClick: onOutlineButton, expanded: sheetOpen, className: railOpen ? 'lg:hidden' : undefined }}
              onHelp={readingMode ? undefined : () => setHelpOpen(true)}
              wide={!railOpen}
            />
          </div>
          {railOpen && (
            <div className="relative hidden min-h-0 lg:block">
              <CourseOutlineRail
                className="lg:absolute lg:inset-0"
                modules={outline}
                currentModuleId={lecture.module.id}
                onCollapse={() => setCollapsed(true)}
              />
            </div>
          )}
        </div>
      </section>

      {/* Под сценой: заголовок, мета, как засчитывается, вкладки */}
      <div className="mt-6 sm:mt-8">
        <div className="eyebrow">
          {t('lecture.moduleN', { roman })} · {t('lecture.lectureOf', { n: lecture.lectureNumber, total: lecture.lecturesTotal })}
        </div>
        <h1 className="mt-1 text-display-lg text-fg">{displayTitle}</h1>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          {metaParts.length > 0 && <p className="text-meta text-fg-2">{metaParts.join(' · ')}</p>}
          <ReportIssueButton targetType="LECTURE" targetId={lecture.id} context="LECTURE" enrollmentId={enrollmentId} compact />
        </div>
        <div
          className={clsx(
            'mt-4 flex max-w-[68ch] items-start gap-2.5 rounded-xl border px-4 py-3 text-body',
            completedNow ? 'border-teal/30 bg-teal/8 text-teal-ink' : 'border-border bg-surface-2/70 text-fg-2',
          )}
        >
          <Icon name={completedNow ? 'check' : 'info'} size={18} className="mt-0.5" />
          <p>{completedNow ? t('lecture.contractDone') : t('lecture.contract')}</p>
        </div>

        <div className="mt-6">
          <ContentTabs
            value={tab}
            onChange={setTab}
            hasSummary={hasSummary}
            hasTerms={hasTerms}
            hasMini={hasMini}
            panels={{
              transcript: (
                <div className="card p-5 sm:p-8">
                  <TranscriptView
                    text={lecture.transcriptText}
                    parsed={parsed}
                    currentTime={readingMode ? undefined : player.currentTime}
                    onSeek={readingMode ? undefined : seek}
                    query={query}
                    onQueryChange={setQuery}
                    searchInputId={SEARCH_INPUT_ID}
                    searchBarClassName={clsx('-mx-5 px-5 sm:-mx-8 sm:px-8', transcriptTop)}
                    stickyToc={readingMode}
                  />
                </div>
              ),
              summary: hasSummary ? (
                <div className="card p-5 sm:p-8">
                  <h2 className="text-title text-fg">{t('lecture.summaryTitle')}</h2>
                  <p className="mt-3 max-w-[68ch] whitespace-pre-line text-body-lg text-fg">{lecture.summary}</p>
                </div>
              ) : null,
              terms: hasTerms ? (
                <div className="card p-5 sm:p-8">
                  <TermsList
                    parsed={parsed}
                    onFind={(q) => {
                      setQuery(q);
                      setTab('transcript');
                    }}
                  />
                </div>
              ) : null,
              mini: (
                <div id="mini-quiz" className="scroll-mt-24">
                  {hasMini ? (
                    <MiniQuiz url={`/lectures/${lecture.id}/mini-quiz`} enrollmentId={enrollmentId} />
                  ) : (
                    <p className="text-body text-fg-2">{t('lecture.noMiniQuiz')}</p>
                  )}
                </div>
              ),
            }}
          />
        </div>
      </div>

      {/* Мобильная нижняя панель: [‹] [☰ II · 2/3] [✓] [Далее ›] — поверх панели вкладок оболочки */}
      <nav
        aria-label={t('lecture.player')}
        className="fixed inset-x-0 bottom-0 z-[35] border-t border-border bg-card pb-[env(safe-area-inset-bottom,0px)] sm:hidden"
      >
        <div className="grid h-16 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem_minmax(0,1.3fr)] items-center gap-2 px-3">
          {prevTarget?.href ? (
            <Link to={prevTarget.href} aria-label={prevTarget.ariaLabel} className="grid h-11 w-11 place-items-center rounded-xl border border-border text-fg">
              <Icon name="chevron-left" size={20} />
            </Link>
          ) : (
            <span className="grid h-11 w-11 place-items-center rounded-xl border border-border text-fg opacity-30" aria-hidden>
              <Icon name="chevron-left" size={20} />
            </span>
          )}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            aria-label={`${t('lecture.outline.title')}: ${t('lecture.moduleN', { roman })}, ${t('lecture.lectureN', { n: lecture.lectureNumber })}`}
            className="inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-border px-2 text-fg"
          >
            <Icon name="menu" size={18} />
            <span className="num truncate">
              {roman} · {lecture.module.indexInModule}/{lecture.module.lecturesInModule}
            </span>
          </button>
          {completedNow ? (
            <span role="img" aria-label={t('lecture.doneAria')} className="grid h-11 w-11 place-items-center rounded-xl border border-teal/40 bg-teal/15 text-teal-ink">
              <Icon name="check" size={20} strokeWidth={2} />
            </span>
          ) : (
            <button
              type="button"
              onClick={onComplete}
              disabled={complete.isPending}
              aria-label={t('lecture.markDone')}
              title={t('lecture.markDone')}
              className="grid h-11 w-11 place-items-center rounded-xl border border-border text-fg disabled:opacity-50"
            >
              <Icon name="check" size={20} />
            </button>
          )}
          {nextTarget.href ? (
            <Link to={nextTarget.href} aria-label={nextTarget.ariaLabel ?? nextTarget.label} className="inline-flex h-11 min-w-0 items-center justify-center gap-1 rounded-xl bg-brand-fill px-3 text-body font-semibold text-white">
              <span className="truncate">{t('ui.next')}</span>
              <Icon name="chevron-right" size={18} />
            </Link>
          ) : (
            <button
              type="button"
              onClick={nextTarget.onClick}
              aria-label={nextTarget.label}
              className="inline-flex h-11 min-w-0 items-center justify-center gap-1 rounded-xl bg-brand-fill px-3 text-body font-semibold text-white"
            >
              <span className="truncate">{t('ui.next')}</span>
              <Icon name="chevron-right" size={18} />
            </button>
          )}
        </div>
      </nav>

      <OutlineSheet open={sheetOpen} onClose={() => setSheetOpen(false)} modules={outline} currentModuleId={lecture.module.id} />
      <KeyboardHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
