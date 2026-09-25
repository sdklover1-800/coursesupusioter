import { clsx } from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import type { PracticalSessionsView, SessionDetail, SessionEndInputReason, TurnError } from '../../lib/practical';
import { api } from '../../lib/api';
import { budgetLevel, endSession, invalidatePractical, practicalKeys, useSocraticChat } from '../../lib/practical';
import { invalidateLearning, routes } from '../../lib/learn';
import { useFocusMode } from '../AppShell';
import { Button, InquiryMeter, Menu, Sheet, toast } from '../ui';
import { Icon } from '../icons';
import { ChatThread } from './ChatThread';
import { Composer, type ComposerHandle } from './Composer';
import { EndSessionDialog } from './EndSessionDialog';
import { LectureMaterials } from './LectureMaterials';
import { PhaseStepper } from './PhaseStepper';
import { TaskDetails, TaskPanel } from './TaskPanel';

/** Локализованный текст ошибки хода (сырые серверные сообщения не показываем). */
function turnErrorKey(err: TurnError): string {
  if (err.code === 'UNANSWERED') return 'practical.chat.error.unanswered';
  if (err.code === 'BAD_REQUEST') return 'practical.chat.error.badRequest';
  if (/TOO_MANY|RATE|HTTP_429/.test(err.code)) return 'practical.chat.error.rateLimited';
  if (err.recoverable) return 'practical.chat.error.tech';
  return 'practical.chat.error.generic';
}

/**
 * Диалог с тьютором в режиме фокуса (screen_specs «Socratic practical: dialogue»).
 * lg: сетка [minmax(300px,34%) 1fr] — слева липкая сворачиваемая панель задания, справа
 * лента; ниже lg — «Задание» и «Конспекты» открываются листами из меню ⋯ FocusBar.
 * Высота — 100dvh под FocusBar (прежний h-[calc(100vh-8rem)] убран), поле ответа — внизу
 * с safe area. Никаких подсказок-ответов и «Как у меня дела» (правила исследования).
 */
export function ChatView({
  detail, view, courseId, enrollmentId, titleByOrder, onEnded, onShowVerdict,
}: {
  detail: SessionDetail;
  view: PracticalSessionsView;
  courseId: string;
  enrollmentId: string;
  titleByOrder?: Map<number, string>;
  /** Сессия завершена кнопкой «Завершить» (DONE/OTHER) — ответ сервера */
  onEnded: (detail: SessionDetail) => void;
  /** «Перейти к оценке» после хода, завершившего сессию */
  onShowVerdict: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { brief } = view;
  const sessionId = detail.session.id;
  const composerRef = useRef<ComposerHandle>(null);
  const endedBtnRef = useRef<HTMLButtonElement>(null);

  const [collapsed, setCollapsed] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endFailed, setEndFailed] = useState(false);

  const chat = useSocraticChat(detail, {
    onTurnDone: (done, firstReply) => {
      // Первый ответ закрепляет язык курса (USER_DECISIONS §3) — карта курса должна это увидеть
      if (firstReply) void invalidateLearning(qc);
      if (done.status !== 'IN_PROGRESS') void invalidatePractical(qc);
    },
  });
  const { state } = chat;
  const ended = state.status !== 'IN_PROGRESS';
  const used = Math.max(0, state.maxAiMessages - state.remaining);
  const level = budgetLevel(state.remaining);
  const exitToCourse = () => navigate(routes.course(courseId, enrollmentId, { hash: `item-${brief.id}` }));

  // Фокус возвращается в поле ответа после каждого хода
  const wasSending = useRef(false);
  useEffect(() => {
    if (wasSending.current && !chat.sending && !ended) composerRef.current?.focus();
    wasSending.current = chat.sending;
  }, [chat.sending, ended]);
  // Сессия завершилась ходом — фокус на «Перейти к оценке»
  useEffect(() => {
    if (ended) endedBtnRef.current?.focus();
  }, [ended]);

  // 409 на ходе: сессия, вероятно, уже закрыта — сверяемся с сервером
  useEffect(() => {
    if (chat.error?.code !== 'CONFLICT') return;
    let cancelled = false;
    api
      .get<SessionDetail>(`/sessions/${sessionId}`)
      .then((d) => {
        if (cancelled || d.session.status === 'IN_PROGRESS') return;
        qc.setQueryData(practicalKeys.session(sessionId), d);
        void invalidatePractical(qc);
        onShowVerdict();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [chat.error, sessionId, qc, onShowVerdict]);

  useFocusMode({
    title: brief.title,
    onExit: exitToCourse,
    exitLabel: t('practical.verdict.toCourse'),
    right: (
      <div className="flex items-center gap-1 lg:hidden">
        <InquiryMeter compact used={used} max={state.maxAiMessages} />
        <Menu
          triggerLabel={t('practical.chat.menu')}
          trigger={<Icon name="more" size={22} />}
          items={[
            { key: 'task', icon: 'file-text', label: t('practical.chat.task'), onSelect: () => setTaskOpen(true) },
            { key: 'lectures', icon: 'book-open', label: t('practical.materials.title'), onSelect: () => setMaterialsOpen(true) },
            ...(!ended ? [{ key: 'end', icon: 'flag' as const, label: t('practical.chat.end'), onSelect: () => setEndOpen(true) }] : []),
          ]}
        />
      </div>
    ),
  });

  async function confirmEnd(reason: SessionEndInputReason) {
    setEnding(true);
    setEndFailed(false);
    try {
      const d = await endSession(sessionId, reason);
      if (reason === 'TECH_ISSUE') {
        // Пауза: сессия остаётся открытой, попытка не расходуется
        toast(t('practical.chat.paused'), 'brand');
        setEndOpen(false);
        exitToCourse();
        return;
      }
      qc.setQueryData(practicalKeys.session(sessionId), d);
      await invalidatePractical(qc);
      setEndOpen(false);
      onEnded(d);
    } catch {
      setEndFailed(true);
    } finally {
      setEnding(false);
    }
  }

  const banner =
    !ended && chat.error ? (
      <div role="alert" className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger/30 bg-danger/8 px-3.5 py-2.5 text-body text-danger-ink">
        <span className="flex min-w-0 items-start gap-2">
          <Icon name="alert" size={18} className="mt-0.5" />
          {t(turnErrorKey(chat.error))}
        </span>
        {chat.error.blocking && (
          <Button size="sm" variant="secondary" onClick={() => void chat.retry()} disabled={chat.sending}>
            <Icon name="refresh" size={16} />
            {t('practical.chat.retry')}
          </Button>
        )}
      </div>
    ) : !ended && level === 'last' ? (
      <div className="mb-2 flex items-start gap-2 rounded-xl border border-spark-ink/40 bg-spark/15 px-3.5 py-2.5 text-body font-medium text-fg">
        <Icon name="flag" size={18} className="mt-0.5 text-spark-ink" />
        {t('practical.chat.lastBanner')}
      </div>
    ) : null;

  const endedPanel = ended ? (
    <div className="mt-6 rounded-2xl border border-border bg-surface-2/70 p-5 text-center">
      <div className="text-title text-fg">{t('practical.chat.ended')}</div>
      <p className="mt-1 text-body text-fg-2">{t('practical.chat.endedHint')}</p>
      <Button ref={endedBtnRef} className="mt-4" onClick={onShowVerdict}>
        {t('practical.chat.toVerdict')}
        <Icon name="arrow-right" size={18} />
      </Button>
    </div>
  ) : null;

  return (
    <div className="-my-6 flex h-[calc(100dvh-3.5rem-env(safe-area-inset-top,0px))] flex-col lg:-my-8">
      <div
        className={clsx(
          'mx-auto grid h-full min-h-0 w-full max-w-6xl lg:gap-6',
          collapsed ? 'lg:grid-cols-[3.5rem_minmax(0,1fr)]' : 'lg:grid-cols-[minmax(300px,34%)_minmax(0,1fr)]',
        )}
      >
        <div className="hidden min-h-0 lg:block">
          <TaskPanel brief={brief} collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} onOpenLectures={() => setMaterialsOpen(true)} />
        </div>

        <div className="flex min-h-0 min-w-0 flex-col">
          {/* Шапка: этапы, бюджет, «Завершить», строка честности */}
          <div className="shrink-0 border-b border-border pb-3 pt-3 lg:pt-5">
            <div className="flex items-center justify-between gap-3">
              <PhaseStepper current={ended ? 2 : 1} />
              {!ended && (
                <Button variant="ghost" size="sm" className="hidden shrink-0 text-fg-2 lg:inline-flex" onClick={() => setEndOpen(true)} disabled={chat.sending}>
                  <Icon name="flag" size={16} />
                  {t('practical.chat.end')}
                </Button>
              )}
            </div>
            <InquiryMeter used={used} max={state.maxAiMessages} className="mt-3 hidden lg:block" />
            {!ended && level === 'low' && (
              <p className="mt-2 text-small font-medium text-spark-ink lg:hidden">{t('practical.chat.low', { count: state.remaining })}</p>
            )}
            <p className="mt-2 flex items-start gap-1.5 text-small text-fg-2">
              <Icon name="info" size={15} className="mt-0.5" />
              {t('practical.chat.honesty')}
            </p>
          </div>

          <ChatThread
            items={chat.items}
            sending={chat.sending}
            slow={chat.slow}
            enrollmentId={enrollmentId}
            verdictCode={state.verdictCode}
            footer={endedPanel}
          />

          {!ended && (
            <div className="shrink-0 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-2">
              <Composer
                ref={composerRef}
                sessionId={sessionId}
                sending={chat.sending}
                blocked={!!chat.error?.blocking}
                onSend={(text, ms) => void chat.send(text, ms)}
                above={banner}
              />
            </div>
          )}
        </div>
      </div>

      {/* Ниже lg: задание — нижним листом */}
      <Sheet open={taskOpen} onClose={() => setTaskOpen(false)} title={brief.title}>
        <TaskDetails brief={brief} />
      </Sheet>
      <LectureMaterials
        open={materialsOpen}
        onClose={() => setMaterialsOpen(false)}
        lectures={brief.lectures}
        moduleTitles={brief.moduleTitles}
        titleByOrder={titleByOrder}
        enrollmentId={enrollmentId}
      />
      <EndSessionDialog open={endOpen} busy={ending} failed={endFailed} onCancel={() => !ending && setEndOpen(false)} onConfirm={(r) => void confirmEnd(r)} />
    </div>
  );
}
