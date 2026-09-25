import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { AttemptResult, LearnView, QuizLobby as QuizLobbyData } from '@edu/shared';
import { invalidateLearning, routes, useLearnView } from '../../lib/learn';
import {
  errorCode, quizKeys, QuizErrorCode, quizRoutes, romanNumeral, startAttempt, useAttemptResult, useAttemptState,
  usePracticeSet, useQuizLobby, type PracticeItem,
} from '../../lib/quiz';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { ApiError } from '../../lib/api';
import { Breadcrumb, toast, type Crumb } from '../../components/ui';
import { ErrorState, LoadingRows } from '../../components/page';
import { ContentError } from '../../components/enrollment';
import { QuizLobby } from '../../components/quiz/QuizLobby';
import { OfficialRunner } from '../../components/quiz/OfficialRunner';
import { PracticeRunner } from '../../components/quiz/PracticeRunner';
import { ResultView } from '../../components/quiz/ResultView';

/**
 * Страница теста (FE3 §8): /learn/:courseId/:enrollmentId/quiz/:quizId
 * — оцениваемый тест → лобби; тренировочный (мини-квиз) → тренировка в режиме фокуса;
 * — ?run=<attemptId>   → официальная попытка (обновление страницы → GET /quiz-attempts/:id/state);
 * — ?attempt=<id>      → результат сохранённой попытки (GET /quiz-attempts/:id);
 * — ?mode=practice     → «Тренировка по модулю» (модуль — из moduleId теста); &only=graded —
 *   только вопросы теста (открыты после финала, иначе 403 PRACTICE_LOCKED).
 */
export function QuizPage() {
  const { t } = useTranslation();
  const { courseId = '', enrollmentId = '', quizId = '' } = useParams();
  const [sp] = useSearchParams();
  const runId = sp.get('run');
  const attemptId = sp.get('attempt');
  const practice = sp.get('mode') === 'practice';
  const onlyGraded = sp.get('only') === 'graded';

  const lobbyQ = useQuizLobby(quizId, enrollmentId);
  const learnQ = useLearnView(courseId, enrollmentId);
  const ctx = useQuizContext(lobbyQ.data, learnQ.data);

  // Смена экрана (лобби → попытка → результат, тренировка) — с начала страницы: путь тот же,
  // меняются только параметры, и SPA сохранила бы прокрутку лобби («Начать попытку» внизу
  // на мобильных) — навигатор и начало вопроса оказались бы под FocusBar.
  const screenKey = `${quizId}|${runId ?? ''}|${attemptId ?? ''}|${practice ? (onlyGraded ? 'graded' : 'practice') : ''}`;
  useLayoutEffect(() => {
    window.scrollTo({ top: 0 });
  }, [screenKey]);

  if (lobbyQ.error) return <ContentError error={lobbyQ.error} courseId={courseId} enrollmentId={enrollmentId} />;
  if (!lobbyQ.data) return <LoadingRows rows={4} />;
  const lobby = lobbyQ.data;
  const base = { lobby, courseId, enrollmentId, quizId, ctx };

  if (runId && lobby.isGraded) return <RunScreen key={runId} {...base} attemptId={runId} />;
  if (attemptId && lobby.isGraded) return <ResultScreen key={attemptId} {...base} attemptId={attemptId} />;
  if (!lobby.isGraded) return <MiniPracticeScreen {...base} />;
  if (practice) return <ModulePracticeScreen {...base} onlyGraded={onlyGraded} />;
  return <LobbyScreen {...base} />;
}

/* ── Контекст: модуль, курс, лекции (карта курса — из кэша страницы курса) ── */
interface QuizContext {
  numeral: string | null;
  moduleTitle: string | null;
  courseTitle: string | null;
  lectureNumbers: Record<string, number>;
  lectureTitles: Record<string, string>;
}
function useQuizContext(lobby: QuizLobbyData | undefined, learn: LearnView | undefined): QuizContext {
  return useMemo(() => {
    const numeral = lobby?.moduleOrderIndex !== null && lobby?.moduleOrderIndex !== undefined ? romanNumeral(lobby.moduleOrderIndex + 1) : null;
    const mod = learn?.version.modules.find((m) => m.id === lobby?.moduleId) ?? null;
    const lectureNumbers: Record<string, number> = {};
    const lectureTitles: Record<string, string> = {};
    for (const m of learn?.version.modules ?? []) {
      for (const l of m.lectures) {
        lectureNumbers[l.id] = l.lectureNumber;
        lectureTitles[l.id] = l.title;
      }
    }
    return { numeral, moduleTitle: mod?.title ?? null, courseTitle: learn?.version.title ?? null, lectureNumbers, lectureTitles };
  }, [lobby, learn]);
}

interface ScreenProps {
  lobby: QuizLobbyData;
  courseId: string;
  enrollmentId: string;
  quizId: string;
  ctx: QuizContext;
}

function useCrumbs({ lobby, courseId, enrollmentId, quizId, ctx }: ScreenProps, extra?: Crumb): Crumb[] {
  const { t } = useTranslation();
  const items: Crumb[] = [{ label: ctx.courseTitle ?? t('nav.myCourses'), to: routes.course(courseId, enrollmentId) }];
  if (ctx.moduleTitle) items.push({ label: ctx.moduleTitle, to: routes.course(courseId, enrollmentId) });
  items.push({ label: lobby.isGraded ? t('quiz.moduleTest') : lobby.title, to: extra ? quizRoutes.lobby(courseId, enrollmentId, quizId) : undefined });
  if (extra) items.push(extra);
  return items;
}

/* ── Лобби ── */
function LobbyScreen(props: ScreenProps) {
  const { lobby, courseId, enrollmentId, quizId, ctx } = props;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [ackError, setAckError] = useState(false);
  const crumbs = useCrumbs(props);
  useDocumentTitle(ctx.numeral ? t('quiz.moduleTestN', { n: ctx.numeral }) : lobby.title);

  async function onStart(integrityAck: boolean) {
    setStarting(true);
    setAckError(false);
    try {
      const start = await startAttempt(quizId, enrollmentId, integrityAck);
      // Попытка уже загружена — раннер не перезапрашивает /state
      qc.setQueryData(quizKeys.attemptState(start.attemptId), start);
      void qc.invalidateQueries({ queryKey: quizKeys.lobby(quizId, enrollmentId) });
      // Старт попытки блокирует язык курса (USER_DECISIONS §3) — карта курса устарела
      void qc.invalidateQueries({ queryKey: ['learn'] });
      navigate(quizRoutes.run(courseId, enrollmentId, quizId, start.attemptId));
    } catch (err) {
      const code = errorCode(err);
      if (code === QuizErrorCode.INTEGRITY_ACK_REQUIRED) setAckError(true);
      else if (code === QuizErrorCode.COOLDOWN || code === QuizErrorCode.ATTEMPTS_EXHAUSTED || code === QuizErrorCode.QUIZ_ALREADY_PASSED) {
        toast(t(`quiz.lobby.errors.${code}`), 'muted');
        void qc.invalidateQueries({ queryKey: quizKeys.lobby(quizId, enrollmentId) });
      } else toast(err instanceof ApiError && err.status < 500 ? err.message : t('quiz.lobby.errors.generic'), 'danger');
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[760px]">
      <Breadcrumb items={crumbs} className="mb-5" />
      <QuizLobby
        lobby={lobby}
        courseId={courseId}
        enrollmentId={enrollmentId}
        moduleNumeral={ctx.numeral}
        moduleTitle={ctx.moduleTitle}
        starting={starting}
        ackError={ackError}
        onStart={(ack) => void onStart(ack)}
        onResume={(id) => navigate(quizRoutes.run(courseId, enrollmentId, quizId, id))}
        onCooldownElapsed={() => void qc.invalidateQueries({ queryKey: quizKeys.lobby(quizId, enrollmentId) })}
      />
    </div>
  );
}

/* ── Официальная попытка ── */
function RunScreen(props: ScreenProps & { attemptId: string }) {
  const { lobby, courseId, enrollmentId, quizId, ctx, attemptId } = props;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const stateQ = useAttemptState(attemptId);
  const title = ctx.numeral ? t('quiz.moduleTestN', { n: ctx.numeral }) : lobby.title;
  useDocumentTitle(title);

  // Уход из раннера (✕, «назад» браузера, отправка) — снимок попытки из кэша больше не нужен:
  // повторный вход должен взять свежие ответы через /state
  // (проверка после тика — StrictMode в dev имитирует размонтирование сразу после монтирования)
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.setTimeout(() => {
        if (!mounted.current) qc.removeQueries({ queryKey: quizKeys.attemptState(attemptId) });
      }, 0);
    };
  }, [qc, attemptId]);

  const toResult = (id: string) => navigate(quizRoutes.result(courseId, enrollmentId, quizId, id), { replace: true });
  const stateCode = errorCode(stateQ.error);

  useEffect(() => {
    // Попытка уже отправлена (другая вкладка или система после простоя) — к результату
    if (stateCode === QuizErrorCode.ATTEMPT_SUBMITTED) {
      toast(t('quiz.runner.submitted'), 'muted');
      void invalidateLearning(qc);
      toResult(attemptId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateCode]);

  if (stateQ.error) {
    if (stateCode === QuizErrorCode.ATTEMPT_SUBMITTED) return <LoadingRows rows={3} />;
    return <ContentError error={stateQ.error} courseId={courseId} enrollmentId={enrollmentId} />;
  }
  if (!stateQ.data) return <LoadingRows rows={4} />;

  return (
    <OfficialRunner
      start={stateQ.data}
      title={title}
      maxAttempts={lobby.maxAttempts}
      enrollmentId={enrollmentId}
      onExit={() => {
        void qc.invalidateQueries({ queryKey: quizKeys.lobby(quizId, enrollmentId) });
        navigate(quizRoutes.lobby(courseId, enrollmentId, quizId));
      }}
      onSubmitted={(result: AttemptResult) => {
        qc.setQueryData(quizKeys.attemptResult(attemptId), result);
        qc.removeQueries({ queryKey: quizKeys.attemptState(attemptId) });
        // Уровень разбора прежних попыток мог измениться (финал) — сбрасываем все результаты
        void qc.invalidateQueries({ queryKey: ['quiz-attempt', 'result'], predicate: (q) => q.queryKey[2] !== attemptId });
        void qc.invalidateQueries({ queryKey: ['quiz-practice-set'] });
        void invalidateLearning(qc);
        toResult(attemptId);
      }}
      onAlreadySubmitted={() => {
        toast(t('quiz.runner.submitted'), 'muted');
        void invalidateLearning(qc);
        void qc.invalidateQueries({ queryKey: quizKeys.attemptResult(attemptId) });
        toResult(attemptId);
      }}
    />
  );
}

/* ── Результат попытки ── */
function ResultScreen(props: ScreenProps & { attemptId: string }) {
  const { lobby, courseId, enrollmentId, quizId, ctx, attemptId } = props;
  const { t } = useTranslation();
  const qc = useQueryClient();
  const resultQ = useAttemptResult(attemptId);
  const n = resultQ.data?.attempt.attemptNumber;
  const crumbs = useCrumbs(props, { label: n ? `${t('quiz.outcome.table.attempt')} ${t('quiz.lobby.historyNumber', { n })}` : t('quiz.result') });
  useDocumentTitle(`${t('quiz.result')} · ${ctx.numeral ? t('quiz.moduleTestN', { n: ctx.numeral }) : lobby.title}`);

  if (resultQ.error) {
    const e = resultQ.error;
    if (e instanceof ApiError && (e.status === 403 || e.code === 'ENROLLMENT_NOT_APPROVED')) return <ContentError error={e} courseId={courseId} enrollmentId={enrollmentId} />;
    return (
      <div>
        <Breadcrumb items={crumbs} className="mb-5" />
        <ErrorState message={t('quiz.outcome.loadFailed')} />
      </div>
    );
  }
  if (!resultQ.data) return <LoadingRows rows={4} />;

  return (
    <div className="mx-auto w-full max-w-[860px]">
      <Breadcrumb items={crumbs} className="mb-5" />
      <ResultView
        result={resultQ.data}
        lobby={lobby}
        courseId={courseId}
        enrollmentId={enrollmentId}
        quizId={quizId}
        moduleNumeral={ctx.numeral}
        lectureTitles={ctx.lectureTitles}
        onCooldownElapsed={() => {
          void qc.invalidateQueries({ queryKey: quizKeys.attemptResult(attemptId) });
          void qc.invalidateQueries({ queryKey: quizKeys.lobby(quizId, enrollmentId) });
        }}
      />
    </div>
  );
}

/* ── Тренировка по модулю (?mode=practice) ── */
function ModulePracticeScreen(props: ScreenProps & { onlyGraded: boolean }) {
  const { lobby, courseId, enrollmentId, quizId, ctx, onlyGraded } = props;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setQ = usePracticeSet(lobby.moduleId, enrollmentId);
  const title = onlyGraded ? t('quiz.practice.titleGraded') : t('quiz.practice.title');
  useDocumentTitle(ctx.numeral ? `${title} · ${ctx.numeral}` : title);

  const items = useMemo<PracticeItem[]>(() => {
    const all = setQ.data?.items ?? [];
    const picked = onlyGraded ? all.filter((i) => i.source === 'GRADED') : all;
    return picked.map((i) => ({ quizId: i.quizId, question: i.question, source: i.source, lectureId: i.lectureId }));
  }, [setQ.data, onlyGraded]);

  const exit = () => navigate(quizRoutes.lobby(courseId, enrollmentId, quizId));
  if (setQ.error) return <ContentError error={setQ.error} courseId={courseId} enrollmentId={enrollmentId} />;
  if (!setQ.data) return <LoadingRows rows={4} />;

  // Вопросы теста до финала закрыты (USER_DECISIONS §2): спокойное объяснение + мини-квизы модуля
  const lockedGraded = onlyGraded && !setQ.data.includesGraded;
  return (
    <PracticeRunner
      key={`${lobby.moduleId}-${onlyGraded ? 'g' : 'all'}-${items.length}`}
      variant="focus"
      items={lockedGraded ? [] : items}
      enrollmentId={enrollmentId}
      title={ctx.numeral ? `${title} · ${ctx.numeral}` : title}
      onExit={exit}
      lectureNumbers={ctx.lectureNumbers}
      lockedHref={quizRoutes.practice(courseId, enrollmentId, quizId)}
      initialLocked={lockedGraded}
    />
  );
}

/* ── Тренировочный тест, открытый по ссылке (мини-квиз / итоговый мини-квиз) ── */
function MiniPracticeScreen(props: ScreenProps) {
  const { lobby, courseId, enrollmentId, ctx } = props;
  const { t } = useTranslation();
  const navigate = useNavigate();
  useDocumentTitle(lobby.title);
  const items = useMemo<PracticeItem[]>(
    () => (lobby.questions ?? []).map((q) => ({ quizId: lobby.id, question: q, source: 'MINI' as const })),
    [lobby],
  );
  return (
    <PracticeRunner
      key={lobby.id}
      variant="focus"
      items={items}
      enrollmentId={enrollmentId}
      title={lobby.title}
      onExit={() => navigate(routes.course(courseId, enrollmentId))}
      exitLabel={t('quiz.outcome.toCourse')}
      lectureNumbers={ctx.lectureNumbers}
    />
  );
}
