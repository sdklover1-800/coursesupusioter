/**
 * Клиент сократического практикума (FE4): страница задания «бриф → диалог → оценка → разбор».
 * Контракт — @edu/shared learn.ts (BE3): GET/POST /practical-tasks/:id/sessions, GET /sessions/:id,
 * POST /sessions/:id/messages (SSE), POST /sessions/:id/end.
 *
 * Правила исследования (USER_DECISIONS §4, screen_specs «Socratic practical»):
 * - открытие страницы НИКОГДА не создаёт сессию: только GET; POST старта — лишь по клику
 *   «Начать диалог» (дедупликация ref-ом);
 * - студент не получает вывода судьи: SSE done — allowlist TurnDone, сырой verdictReason
 *   не показываем (только локализованный verdictCode);
 * - toDevelop/highlights = null, пока остаётся попытка (A6) — показываем только баллы и сильные стороны.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import type {
  ChatMessageView, LectureView, PracticalLectureRef, PracticalSessionsView, SessionDetail, SessionEndInputReason,
  SessionStatus, TurnDone, VerdictCode,
} from '@edu/shared';
import { api, ApiError, postSse } from './api';
import { invalidateLearning } from './learn';

export type {
  ChatMessageView, PracticalBrief, PracticalLectureRef, PracticalSessionSummary, PracticalSessionView,
  PracticalSessionsView, RubricCriterion, SessionDetail, SessionEndInputReason, SessionEvaluation, TurnDone, VerdictCode,
} from '@edu/shared';

/* ── Ключи запросов ─────────────────────────────────────────────────── */
export const practicalKeys = {
  /** Страница задания: бриф + сессии (GET без побочных эффектов) */
  sessions: (taskId: string | undefined, enrollmentId: string | undefined) => ['practical', 'sessions', taskId, enrollmentId] as const,
  /** Одна сессия: состояние, реплики, итоговая оценка */
  session: (sessionId: string | null | undefined) => ['practical', 'session', sessionId] as const,
  /**
   * Конспект лекции из практикума (context=PRACTICAL). Префикс НЕ 'lecture': invalidateLearning
   * не должен перезапрашивать расшифровки (текст не меняется, а запрос пишет событие просмотра).
   */
  lecture: (lectureId: string | null | undefined, enrollmentId: string | undefined) => ['practical-lecture', lectureId, enrollmentId] as const,
};

/* ── Запросы ────────────────────────────────────────────────────────── */

/** Бриф и сессии задания. Только чтение: открытие страницы сессию не создаёт. */
export function useSessionsView(taskId: string | undefined, enrollmentId: string | undefined) {
  return useQuery({
    queryKey: practicalKeys.sessions(taskId, enrollmentId),
    queryFn: () => api.get<PracticalSessionsView>(`/practical-tasks/${taskId}/sessions?enrollmentId=${enrollmentId}`),
    enabled: !!taskId && !!enrollmentId,
    refetchOnWindowFocus: false,
  });
}

/** Интервал и предел опроса итоговой оценки (A23): каждые 3 с, не дольше 60 с. */
export const SUMMARY_POLL_MS = 3000;
export const SUMMARY_POLL_LIMIT_MS = 60_000;

/**
 * Сессия (GET /sessions/:id). В диалоге — снимок без перезапросов (локальная лента не должна
 * перетираться); на экране оценки (pollPending) — опрос, пока summaryStatus = PENDING.
 */
export function useSessionDetail(sessionId: string | null | undefined, opts: { pollPending?: boolean } = {}) {
  const since = useRef<{ id: string | null | undefined; at: number }>({ id: sessionId, at: Date.now() });
  if (since.current.id !== sessionId) since.current = { id: sessionId, at: Date.now() };
  const [pollExpired, setPollExpired] = useState(false);
  useEffect(() => {
    setPollExpired(false);
    if (!opts.pollPending) return;
    const id = window.setTimeout(() => setPollExpired(true), SUMMARY_POLL_LIMIT_MS);
    return () => window.clearTimeout(id);
  }, [sessionId, opts.pollPending]);
  const query = useQuery({
    queryKey: practicalKeys.session(sessionId),
    queryFn: () => api.get<SessionDetail>(`/sessions/${sessionId}`),
    enabled: !!sessionId,
    staleTime: opts.pollPending ? 0 : Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (q) =>
      opts.pollPending && q.state.data?.session.summaryStatus === 'PENDING' && Date.now() - since.current.at < SUMMARY_POLL_LIMIT_MS
        ? SUMMARY_POLL_MS
        : false,
  });
  return { ...query, pollExpired };
}

/** Конспект лекции для листа «Конспекты лекций» (только чтение, точку возобновления не трогает). */
export function usePracticalLecture(lectureId: string | null, enrollmentId: string | undefined) {
  return useQuery({
    queryKey: practicalKeys.lecture(lectureId, enrollmentId),
    queryFn: () => api.get<{ lecture: LectureView }>(`/lectures/${lectureId}?enrollmentId=${enrollmentId}&context=PRACTICAL`).then((r) => r.lecture),
    enabled: !!lectureId && !!enrollmentId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/** Явный старт сессии — ТОЛЬКО по «Начать диалог». 409: ALREADY_PASSED / NO_SESSIONS_LEFT / NOT_AVAILABLE. */
export function startSession(taskId: string, enrollmentId: string): Promise<SessionDetail> {
  return api.post<SessionDetail>(`/practical-tasks/${taskId}/sessions`, { enrollmentId });
}

/** Завершение студентом. TECH_ISSUE — пауза: сессия остаётся IN_PROGRESS. */
export function endSession(sessionId: string, reason: SessionEndInputReason): Promise<SessionDetail> {
  return api.post<SessionDetail>(`/sessions/${sessionId}/end`, { reason });
}

/** После старта/завершения/сдачи: карта курса, «Мои курсы» и страница задания. */
export function invalidatePractical(qc: QueryClient): Promise<unknown> {
  return Promise.all([invalidateLearning(qc), qc.invalidateQueries({ queryKey: ['practical', 'sessions'] })]);
}

/* ── Состояние страницы ─────────────────────────────────────────────── */

/** Экран страницы практикума. */
export type PracticalScreen =
  | { kind: 'brief' }
  | { kind: 'chat'; sessionId: string }
  | { kind: 'verdict'; sessionId: string; review?: boolean };

/**
 * Машина состояний (FE4 §1): активная сессия → диалог; иначе последняя завершённая →
 * оценка (только чтение, «Новая попытка» при canStart); иначе → бриф.
 */
export function screenFor(
  view: Pick<PracticalSessionsView, 'activeSessionId' | 'latestFinishedSessionId'> & Partial<Pick<PracticalSessionsView, 'items' | 'status'>>,
): PracticalScreen {
  if (view.activeSessionId) return { kind: 'chat', sessionId: view.activeSessionId };
  // Задание сдано — показываем сдавшую сессию, даже если позже была ещё одна (старые данные)
  const passed = view.status === 'PASSED' ? view.items?.find((s) => s.status === 'PASSED') : undefined;
  if (passed) return { kind: 'verdict', sessionId: passed.id };
  if (view.latestFinishedSessionId) return { kind: 'verdict', sessionId: view.latestFinishedSessionId };
  return { kind: 'brief' };
}

/** Этап для PhaseStepper: 0 Задание, 1 Диалог, 2 Оценка, 3 Разбор (только структурные события). */
export type Phase = 0 | 1 | 2 | 3;
export function phaseOf(screen: PracticalScreen, sessionEnded = false): Phase {
  if (screen.kind === 'brief') return 0;
  if (screen.kind === 'chat') return sessionEnded ? 2 : 1;
  return screen.review ? 3 : 2;
}

/**
 * Номер попытки «k из max». Для сессии — её порядковый номер среди засчитанных (или всех,
 * если она ещё не засчитана); для брифа — следующая попытка (sessionsUsed + 1, не больше max).
 */
export function attemptNumber(view: Pick<PracticalSessionsView, 'items' | 'sessionsUsed' | 'maxSessions'>, sessionId?: string | null): number {
  const max = Math.max(1, view.maxSessions);
  if (sessionId) {
    const counted = view.items.filter((s) => s.counted || s.id === sessionId);
    const i = counted.findIndex((s) => s.id === sessionId);
    if (i >= 0) return Math.min(max, i + 1);
  }
  return Math.min(max, view.sessionsUsed + 1);
}

/** Коды 409 старта → ключ спокойного локализованного сообщения. */
export const START_CONFLICTS = ['ALREADY_PASSED', 'NO_SESSIONS_LEFT', 'NOT_AVAILABLE', 'OTHER_ACTIVE'] as const;
export type StartConflict = (typeof START_CONFLICTS)[number];
export function startConflictOf(err: unknown): StartConflict | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  // 409 CONFLICT — у студента уже идёт диалог по ДРУГОМУ заданию (BE3)
  if (err.code === 'CONFLICT') return 'OTHER_ACTIVE';
  return (START_CONFLICTS as readonly string[]).includes(err.code) ? (err.code as StartConflict) : null;
}

/** Пороги бюджета ответов тьютора (InquiryMeter): ≤ 3 — «мало», 1 — «последний». */
export type BudgetLevel = 'normal' | 'low' | 'last' | 'none';
export function budgetLevel(remaining: number): BudgetLevel {
  if (remaining <= 0) return 'none';
  if (remaining === 1) return 'last';
  return remaining <= 3 ? 'low' : 'normal';
}

/** Исход сессии для экрана оценки: сдано / не сдано (цвет только вместе с глифом и текстом). */
export function verdictPassed(code: VerdictCode | null | undefined, status?: SessionStatus): boolean {
  return code === 'PASSED' || (!code && status === 'PASSED');
}

/* ── Текст реплик: «лёгкий markdown» и последний вопрос тьютора ───────── */

/** Кусок строки: обычный текст или **выделение**. */
export interface InlinePart {
  text: string;
  strong?: boolean;
}

/**
 * Убираем служебную разметку, которую модель иногда добавляет: **жирный** и __жирный__ → выделение,
 * `код` → текст, ведущие #/> заголовков и цитат — без символов (в интерфейсе нет литералов markdown).
 */
export function parseInline(text: string): InlinePart[] {
  const clean = text.replace(/`([^`]+)`/g, '$1');
  const parts: InlinePart[] = [];
  const re = /\*\*(.+?)\*\*|__(.+?)__/g;
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    if (m.index > pos) parts.push({ text: clean.slice(pos, m.index) });
    parts.push({ text: m[1] ?? m[2] ?? '', strong: true });
    pos = m.index + m[0].length;
  }
  if (pos < clean.length) parts.push({ text: clean.slice(pos) });
  // Одиночные ** / __ без пары — просто убираем
  return parts.map((p) => ({ ...p, text: p.text.replace(/\*\*|__/g, '') })).filter((p) => p.text.length > 0);
}

/** Текст без символов разметки (для скринридера и заголовков). */
export function plainText(text: string): string {
  return parseInline(text.replace(/^\s*#{1,6}\s+/gm, '').replace(/^\s*>\s?/gm, ''))
    .map((p) => p.text)
    .join('');
}

/** Блок текста реплики/сценария: абзац или пункт списка. */
export interface TextBlock {
  type: 'p' | 'li' | 'oli';
  text: string;
  /** Номер пункта нумерованного списка */
  n?: number;
}

/** Абзацы и списки из многострочного текста (без символов markdown). */
export function toBlocks(text: string): TextBlock[] {
  const out: TextBlock[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let para: string[] = [];
  const flush = () => {
    const joined = para.join(' ').replace(/\s+/g, ' ').trim();
    if (joined) out.push({ type: 'p', text: joined });
    para = [];
  };
  for (const raw of lines) {
    const line = raw.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*>\s?/, '').trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const bullet = /^\s*[-*•–]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d{1,2})[.)]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      out.push({ type: 'li', text: bullet[1]!.trim() });
    } else if (numbered) {
      flush();
      out.push({ type: 'oli', text: numbered[2]!.trim(), n: Number(numbered[1]) });
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return out;
}

/** Первый абзац сценария — «цель» в брифе. */
export function firstParagraph(text: string): string {
  return toBlocks(text).find((b) => b.type === 'p')?.text ?? text.trim();
}

/**
 * Реплика тьютора: последнее предложение, оканчивающееся «?», выносится отдельной строкой
 * (левая полоса spark-ink и ✦). Если вопроса в конце нет — question = null.
 */
export function splitTutorMessage(text: string): { body: string; question: string | null } {
  const trimmed = text.replace(/\s+$/, '');
  // Конец реплики — «?» (возможно, с закрывающими кавычками/скобками/выделением)
  if (!/\?["»”')\]*_]*$/.test(trimmed)) return { body: trimmed, question: null };
  // Начало последнего предложения: после последнего [.!?…] + пробел или после перевода строки
  let start = 0;
  const re = /[.!?…]["»”')\]*_]*\s+|\n+/g;
  let m: RegExpExecArray | null;
  const searchIn = trimmed.slice(0, -1); // без финального «?»
  while ((m = re.exec(searchIn))) start = m.index + m[0].length;
  const question = trimmed.slice(start).trim();
  const body = trimmed.slice(0, start).trim();
  if (!question) return { body: trimmed, question: null };
  return { body, question };
}

/**
 * Название модуля без ведущего номера: «Раздел II. Власть…», «II бөлім. Билік…»,
 * «Section II. Power…» → «Власть…» (римский номер показываем отдельно).
 */
export function moduleShortTitle(title: string): string {
  const t = title
    .replace(/^\s*(?:Раздел|Модуль|Section|Module|Бөлім|Part|Часть)\s+[IVXLC\d]+\s*[.:)–—-]?\s*/iu, '')
    .replace(/^\s*[IVXLC\d]+\s*(?:-\s*)?(?:бөлім|модуль)\s*[.:)–—-]?\s*/iu, '')
    .trim();
  return t || title;
}

/* ── Конспекты: лекции по модулям ───────────────────────────────────── */

export interface LectureGroup {
  moduleOrderIndex: number;
  title: string | null;
  lectures: PracticalLectureRef[];
}

/**
 * Группировка лекций брифа по модулям. Названия модулей — из карты курса (по orderIndex),
 * иначе из brief.moduleTitles по порядку групп (если их число совпадает), иначе null.
 */
export function groupLectures(
  lectures: PracticalLectureRef[],
  moduleTitles: string[],
  titleByOrder?: Map<number, string>,
): LectureGroup[] {
  const map = new Map<number, PracticalLectureRef[]>();
  for (const l of [...lectures].sort((a, b) => a.lectureNumber - b.lectureNumber)) {
    const list = map.get(l.moduleOrderIndex) ?? [];
    list.push(l);
    map.set(l.moduleOrderIndex, list);
  }
  const orders = [...map.keys()].sort((a, b) => a - b);
  const byRank = moduleTitles.length === orders.length;
  return orders.map((o, i) => ({
    moduleOrderIndex: o,
    title: titleByOrder?.get(o) ?? (byRank ? moduleTitles[i] ?? null : null),
    lectures: map.get(o)!,
  }));
}

/* ── Черновик ответа (localStorage, по сессии) ───────────────────────── */
const draftKey = (sessionId: string) => `edu.practical.draft.${sessionId}`;

export function loadDraft(sessionId: string): string {
  try {
    return localStorage.getItem(draftKey(sessionId)) ?? '';
  } catch {
    return '';
  }
}
export function saveDraft(sessionId: string, text: string): void {
  try {
    if (text) localStorage.setItem(draftKey(sessionId), text);
    else localStorage.removeItem(draftKey(sessionId));
  } catch {
    /* приватный режим */
  }
}

/** Движение отключено: системная настройка или режим для слабовидящих (html.a11y). */
export function reducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return document.documentElement.classList.contains('a11y') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/* ── Ход диалога (SSE) ──────────────────────────────────────────────── */

/** Реплика в ленте диалога. fresh — пришла в этом сеансе (анимация раскрытия). */
export interface ChatItem extends ChatMessageView {
  fresh?: boolean;
  /** Оптимистичная реплика студента, ещё без id сервера */
  pending?: boolean;
}

/**
 * Ошибка хода. blocking — реплика студента УЖЕ сохранена сервером (BE3): новый текст сервер
 * проигнорирует и возобновит этот ход, поэтому до «Повторить» новую реплику не принимаем.
 * BAD_REQUEST (пустая / слишком длинная) — реплика не сохранена: поле ответа снова доступно.
 */
export interface TurnError {
  code: string;
  recoverable: boolean;
  blocking: boolean;
}

export interface ChatSessionState {
  status: SessionStatus;
  verdictCode: VerdictCode | null;
  maxAiMessages: number;
  remaining: number;
}

/** Порог «отвечает дольше обычного» для ожидания тьютора, мс. */
export const SLOW_WAIT_MS = 20_000;

/**
 * Состояние диалога поверх снимка SessionDetail: лента, бюджет, отправка, ожидание, ошибка.
 * Ход: оптимистичная реплика студента → SSE (open, waiting…, один delta, done|error).
 * done.tutorMessage — единственный источник истины текста тьютора (delta не показываем).
 * Техническая ошибка ≠ провал (FR-6.12): реплика остаётся, «Повторить» — возобновление
 * (пустое сообщение: сервер продолжает с неотвеченной реплики, не дублируя её).
 */
export function useSocraticChat(detail: SessionDetail, opts: { onTurnDone?: (done: TurnDone, firstReply: boolean) => void } = {}) {
  const sessionId = detail.session.id;
  const [items, setItems] = useState<ChatItem[]>(() => detail.messages.map((m) => ({ ...m })));
  const [state, setState] = useState<ChatSessionState>(() => ({
    status: detail.session.status,
    verdictCode: detail.session.verdictCode,
    maxAiMessages: detail.session.maxAiMessages,
    remaining: detail.session.remainingAiMessages,
  }));
  // Последняя реплика студента без ответа (обрыв в прошлый раз) — сразу предлагаем «Повторить»
  const lastVisible = [...detail.messages].reverse().find((m) => m.role !== 'SYSTEM');
  const unanswered = detail.session.status === 'IN_PROGRESS' && lastVisible?.role === 'STUDENT' ? lastVisible.content : null;
  const [sending, setSending] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<TurnError | null>(() => (unanswered ? { code: 'UNANSWERED', recoverable: true, blocking: true } : null));
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const lastTextRef = useRef<string>(unanswered ?? '');
  const onDoneRef = useRef(opts.onTurnDone);
  onDoneRef.current = opts.onTurnDone;

  // Прерываем поток при уходе со страницы (утечка reader, M6)
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    async (text: string, isRetry: boolean, typingMs?: number) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setError(null);
      setSending(true);
      setSlow(false);
      const slowTimer = window.setTimeout(() => setSlow(true), SLOW_WAIT_MS);
      const firstReply = !items.some((m) => m.role === 'STUDENT' && !m.pending);
      if (!isRetry) {
        lastTextRef.current = text;
        setItems((list) => [...list, { id: `tmp-${Date.now()}`, role: 'STUDENT', content: text, createdAt: new Date().toISOString(), pending: true }]);
      }
      abortRef.current = new AbortController();
      let delta = '';
      let finished = false;
      const fail = (code: string, recoverable: boolean) => {
        finished = true;
        // BAD_REQUEST: реплика не сохранена — убираем оптимистичный пузырь, поле ответа свободно
        if (code === 'BAD_REQUEST') setItems((list) => list.filter((m) => !m.pending));
        setError({ code, recoverable, blocking: code !== 'BAD_REQUEST' });
      };
      try {
        // Повтор шлёт тот же текст: сервер возобновит сохранённый ход (или создаст его, если
        // реплика до сервера не дошла) — новый текст он бы проигнорировал (BE3)
        await postSse(
          `/sessions/${sessionId}/messages`,
          { message: isRetry ? lastTextRef.current : text, ...(typingMs !== undefined ? { typingMs } : {}) },
          {
            onDelta: (chunk) => {
              delta += chunk;
            },
            onDone: (payload) => {
              finished = true;
              const d = payload as TurnDone;
              const content = d.tutorMessage || delta;
              // Ход, завершивший сессию: tutorMessageId указывает на служебную SYSTEM-реплику (закрывающая фраза)
              const role: ChatItem['role'] = d.status === 'IN_PROGRESS' ? 'AI' : 'SYSTEM';
              setItems((list) => {
                const next = list.map((m) => (m.pending && m.role === 'STUDENT' ? { ...m, id: d.userMessageId || m.id, pending: false } : m));
                return [...next, { id: d.tutorMessageId || `ai-${Date.now()}`, role, content, createdAt: new Date().toISOString(), fresh: true }];
              });
              setState((s) => ({ ...s, status: d.status, verdictCode: d.verdictCode, remaining: Math.max(0, d.remaining) }));
              onDoneRef.current?.(d, firstReply);
            },
            onError: (err) => fail(err.code, err.recoverable !== false),
          },
          abortRef.current.signal,
        );
        // Поток оборвался без done/error — техническая ошибка (возобновляемая)
        if (!finished) fail('STREAM_CLOSED', true);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) fail('NETWORK', true);
      } finally {
        window.clearTimeout(slowTimer);
        busyRef.current = false;
        setSending(false);
        setSlow(false);
      }
    },
    [sessionId, items],
  );

  const send = useCallback((text: string, typingMs?: number) => run(text, false, typingMs), [run]);
  const retry = useCallback(() => run('', true), [run]);

  return { items, state, sending, slow, error, send, retry, clearError: () => setError(null) };
}
