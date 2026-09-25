import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  invalidatePractical, moduleShortTitle, practicalKeys, screenFor, startConflictOf, startSession, useSessionDetail, useSessionsView,
  type PracticalScreen, type SessionDetail, type StartConflict,
} from '../../lib/practical';
import { routes, useLearnView } from '../../lib/learn';
import { isNotApproved } from '../../lib/catalog';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { NotApprovedScreen } from '../../components/enrollment';
import { ErrorState, LoadingRows } from '../../components/page';
import { romanOf } from '../../components/course/labels';
import { Breadcrumb, toast, type Crumb } from '../../components/ui';
import { PracticalBrief } from '../../components/practical/PracticalBrief';
import { ChatView } from '../../components/practical/ChatView';
import { VerdictView } from '../../components/practical/VerdictView';
import { LectureMaterials } from '../../components/practical/LectureMaterials';

/**
 * Сократический практикум (§5.4, FR-6.*; screen_specs «Socratic practical»; USER_DECISIONS §4).
 * Машина состояний: активная сессия → диалог (режим фокуса); иначе последняя завершённая →
 * оценка (только чтение, «Новая попытка» при canStart); иначе → бриф.
 * Открытие страницы НИКОГДА не создаёт сессию: только GET. POST старта — лишь по клику
 * «Начать диалог» (дедупликация ref-ом); 409 — спокойное сообщение и перезапрос.
 */
export function PracticalPage() {
  const { t } = useTranslation();
  const { taskId, enrollmentId, courseId } = useParams();
  const qc = useQueryClient();
  const sessions = useSessionsView(taskId, enrollmentId);
  const learn = useLearnView(courseId, enrollmentId);

  // Явный переход (старт, конец сессии, «Новая попытка», разбор) поверх вычисленного экрана
  const [override, setOverride] = useState<PracticalScreen | null>(null);
  const screen: PracticalScreen | null = override ?? (sessions.data ? screenFor(sessions.data) : null);

  const chatDetail = useSessionDetail(screen?.kind === 'chat' ? screen.sessionId : null);
  const verdictDetail = useSessionDetail(screen?.kind === 'verdict' ? screen.sessionId : null, { pollPending: true });

  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const [startError, setStartError] = useState(false);
  const [conflict, setConflict] = useState<StartConflict | null>(null);
  const [briefMaterials, setBriefMaterials] = useState(false);

  // Карта курса: хлебные крошки и названия модулей для конспектов
  const module = learn.data?.version.modules.find((m) => m.practicalTask?.id === taskId);
  const titleByOrder = useMemo(() => {
    const map = new Map<number, string>();
    for (const m of learn.data?.version.modules ?? []) map.set(m.orderIndex, m.title);
    return map.size ? map : undefined;
  }, [learn.data]);
  const crumbs: Crumb[] = [
    ...(courseId && enrollmentId ? [{ label: learn.data?.version.title ?? t('nav.myCourses'), to: routes.course(courseId, enrollmentId) }] : []),
    ...(module && courseId && enrollmentId
      ? [{ label: `${romanOf(module.orderIndex)}. ${moduleShortTitle(module.title)}`, to: routes.course(courseId, enrollmentId, { hash: `module-${module.id}` }) }]
      : []),
    { label: t('ui.kind.PRACTICAL') },
  ];

  const title = sessions.data?.brief.title;
  useDocumentTitle(
    !title ? t('practical.kind') : screen?.kind === 'chat' ? `${t('practical.phase.dialog')} · ${title}` : screen?.kind === 'verdict' ? `${t('practical.phase.evaluation')} · ${title}` : title,
  );

  /** «Начать диалог» — единственный путь к POST старта. */
  const start = useCallback(async () => {
    if (!taskId || !enrollmentId || startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setStartError(false);
    setConflict(null);
    try {
      const detail = await startSession(taskId, enrollmentId);
      qc.setQueryData(practicalKeys.session(detail.session.id), detail);
      setOverride({ kind: 'chat', sessionId: detail.session.id });
      void invalidatePractical(qc);
    } catch (err) {
      const code = startConflictOf(err);
      if (code) {
        // Спокойно: сообщение + свежие данные (например, уже сдано → экран оценки)
        setConflict(code);
        toast(t(`practical.brief.conflict.${code}`), 'brand');
        setOverride(null);
        void qc.invalidateQueries({ queryKey: practicalKeys.sessions(taskId, enrollmentId) });
      } else {
        setStartError(true);
      }
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }, [taskId, enrollmentId, qc, t]);

  const showVerdict = useCallback(
    (sessionId: string, fresh?: SessionDetail) => {
      if (fresh) qc.setQueryData(practicalKeys.session(sessionId), fresh);
      // Снимок диалога устарел (статус IN_PROGRESS) — экран оценки грузит сессию заново
      else qc.removeQueries({ queryKey: practicalKeys.session(sessionId) });
      setOverride({ kind: 'verdict', sessionId });
      window.scrollTo({ top: 0 });
    },
    [qc],
  );

  // Активная по списку сессия на деле уже закрыта (sweep по бездействию) — к экрану оценки
  const chatEnded = screen?.kind === 'chat' && !!chatDetail.data && chatDetail.data.session.status !== 'IN_PROGRESS';
  useEffect(() => {
    if (chatEnded && screen?.kind === 'chat') showVerdict(screen.sessionId, chatDetail.data);
  }, [chatEnded, screen, chatDetail.data, showVerdict]);

  if (!courseId || !enrollmentId || !taskId) return null;
  if (sessions.isLoading) return <LoadingRows rows={4} />;
  if (sessions.error) {
    if (isNotApproved(sessions.error)) return <NotApprovedScreen courseId={courseId} enrollmentId={enrollmentId} error={sessions.error} />;
    return <ErrorState message={t('practical.errors.load')} />;
  }
  const view = sessions.data;
  if (!view || !screen) return null;

  if (screen.kind === 'chat') {
    if (chatDetail.isLoading) return <LoadingRows rows={4} />;
    if (chatDetail.error || !chatDetail.data) return <ErrorState message={t('practical.errors.session')} />;
    // Сессия уже завершена (например, закрыта по бездействию) — эффект ниже переключит на оценку
    if (chatDetail.data.session.status !== 'IN_PROGRESS') return <LoadingRows rows={4} />;
    return (
      <ChatView
        key={chatDetail.data.session.id}
        detail={chatDetail.data}
        view={view}
        courseId={courseId}
        enrollmentId={enrollmentId}
        titleByOrder={titleByOrder}
        onEnded={(d) => showVerdict(d.session.id, d)}
        onShowVerdict={() => showVerdict(screen.sessionId)}
      />
    );
  }

  if (screen.kind === 'verdict') {
    const loading = verdictDetail.isLoading || verdictDetail.data?.session.status === 'IN_PROGRESS';
    if (verdictDetail.error) return <ErrorState message={t('practical.errors.session')} />;
    return (
      <VerdictScreen crumbs={crumbs}>
        <VerdictView
          view={view}
          detail={verdictDetail.data}
          loading={loading}
          pollExpired={verdictDetail.pollExpired}
          review={!!screen.review}
          courseId={courseId}
          enrollmentId={enrollmentId}
          onSelectSession={(id) => setOverride({ kind: 'verdict', sessionId: id })}
          onOpenReview={() => setOverride({ kind: 'verdict', sessionId: screen.sessionId, review: true })}
          onCloseReview={() => setOverride({ kind: 'verdict', sessionId: screen.sessionId })}
          onNewAttempt={() => {
            setConflict(null);
            setStartError(false);
            setOverride({ kind: 'brief' });
            window.scrollTo({ top: 0 });
          }}
        />
      </VerdictScreen>
    );
  }

  return (
    <>
      <PracticalBrief
        view={view}
        crumbs={crumbs}
        languageLocked={!!learn.data?.enrollment.languageLocked}
        courseId={courseId}
        enrollmentId={enrollmentId}
        starting={starting}
        startError={startError}
        conflict={conflict}
        onStart={() => void start()}
        onOpenLectures={() => setBriefMaterials(true)}
      />
      <LectureMaterials
        open={briefMaterials}
        onClose={() => setBriefMaterials(false)}
        lectures={view.brief.lectures}
        moduleTitles={view.brief.moduleTitles}
        titleByOrder={titleByOrder}
        enrollmentId={enrollmentId}
      />
    </>
  );
}

/** Оценка и разбор — в обычной оболочке, колонка ~880px с хлебными крошками. */
function VerdictScreen({ crumbs, children }: { crumbs: Crumb[]; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[880px]">
      <Breadcrumb items={crumbs} className="mb-5" />
      {children}
    </div>
  );
}
