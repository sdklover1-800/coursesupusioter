import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { MAX_STUDENT_MESSAGE_CHARS } from '@edu/shared';
import { api, postSse } from '../../lib/api';
import { Button, Card, InquiryMeter, QuestionGlyph, Textarea } from '../../components/ui';
import { LoadingRows, MeterBar } from '../../components/page';

interface Msg { id: string; role: 'AI' | 'STUDENT' | 'SYSTEM'; content: string; createdAt: string }
interface SessionView {
  id: string; status: 'IN_PROGRESS' | 'PASSED' | 'FAILED' | 'ABANDONED';
  aiMessageCount: number; maxAiMessages: number; remainingAiMessages: number;
  verdictReason: string | null;
  evaluationResult: { avg_methodicalness: number; avg_question_quality: number; avg_logical_progression: number; avg_self_correction: number } | null;
}

/**
 * Сократический чат (§5.4, FR-6.*). Ответы ассистента приходят потоково (SSE).
 * Индикатор — оставшиеся реплики (не токены, FR-6.7). Техническая ошибка не
 * засчитывается как FAILED и позволяет повтор (FR-6.12).
 */
export function PracticalPage() {
  const { t } = useTranslation();
  const { taskId, enrollmentId, courseId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionView | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState('');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState(false); // §5.7f: модель отвечает дольше обычного
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const typingStart = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Старт/возобновление сессии
  useEffect(() => {
    api.post<{ session: SessionView; messages: Msg[] }>(`/practical-tasks/${taskId}/sessions`, { enrollmentId })
      .then((r) => { setSession(r.session); setMessages(r.messages); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [taskId, enrollmentId]);

  // M6: прерываем активный SSE-поток при уходе со страницы (утечка reader)
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, streaming]);

  const done = session && session.status !== 'IN_PROGRESS';

  /**
   * Один ход. isRetry=true — возобновление (§5.7, FR-6.12): сервер уже сохранил
   * реплику студента, поэтому повтор шлёт пустое сообщение и сервер продолжает
   * с места остановки, не дублируя реплику.
   */
  async function runTurn(text: string, isRetry: boolean) {
    if (!session || sending) return;
    setError('');
    setSending(true);
    const typingMs = typingStart.current ? Date.now() - typingStart.current : undefined;
    typingStart.current = null;

    if (!isRetry) {
      // Оптимистично добавляем реплику студента (её же сохранит сервер до вызова LLM)
      setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: 'STUDENT', content: text, createdAt: new Date().toISOString() }]);
      setInput('');
    }
    setStreaming('');

    abortRef.current = new AbortController();
    let acc = '';
    try {
      await postSse(
        `/sessions/${session.id}/messages`,
        { message: isRetry ? '' : text, typingMs },
        {
          onWaiting: () => setWaiting(true),
          onDelta: (chunk) => { setWaiting(false); acc += chunk; setStreaming(acc); },
          onDone: (result) => {
            const r = result as SessionView & { tutorMessage: string | null };
            setMessages((m) => [...m, { id: `ai-${Date.now()}`, role: 'AI', content: acc || r.tutorMessage || '', createdAt: new Date().toISOString() }]);
            setStreaming('');
            setSession((s) => (s ? { ...s, status: r.status, aiMessageCount: r.aiMessageCount, maxAiMessages: r.maxAiMessages, remainingAiMessages: r.remainingAiMessages, verdictReason: r.verdictReason ?? null, evaluationResult: r.evaluationResult ?? s.evaluationResult } : s));
          },
          // Техническая ошибка ≠ провал (§5.7): реплика студента остаётся, повтор — resume.
          onError: (err) => { setError(err.recoverable ? t('practical.techError') : err.message); setStreaming(''); },
        },
        abortRef.current.signal,
      );
    } catch {
      // Исключение из postSse (обрыв сети и т. п.) — тоже техническая ошибка, не провал.
      setError(t('practical.techError'));
      setStreaming('');
    } finally {
      setSending(false); // M6: всегда снимаем «отправку», даже при исключении
      setWaiting(false);
    }
  }

  function send() {
    const text = input.trim();
    if (text) void runTurn(text, false);
  }

  if (loading) return <LoadingRows rows={4} />;

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col">
      <div className="mb-3 flex items-center justify-between gap-4">
        <button onClick={() => navigate(`/learn/${courseId}/${enrollmentId}`)} className="text-sm text-muted hover:text-fg">← {t('common.back')}</button>
        {session && !done && (
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
            <span className="text-xs text-muted">{t('practical.remainingReplies')}</span>
            <InquiryMeter used={session.aiMessageCount} max={session.maxAiMessages} />
          </div>
        )}
      </div>

      {/* Сократическая заметка */}
      <div className="mb-3 flex items-start gap-2 rounded-xl bg-spark/8 px-4 py-2.5 text-xs text-fg/80">
        <span className="text-spark">✦</span> {t('practical.socraticNote')}
      </div>

      {/* Лента сообщений (M6: aria-live — потоковые реплики озвучиваются скринридером) */}
      <div ref={scrollRef} role="log" aria-live="polite" aria-atomic="false" aria-label={t('practical.socratic')} className="flex-1 space-y-4 overflow-y-auto rounded-2xl border border-border bg-card/50 p-4">
        {messages.filter((m) => m.role !== 'SYSTEM').map((m) => <Bubble key={m.id} role={m.role as 'AI' | 'STUDENT'} content={m.content} />)}
        {streaming && <Bubble role="AI" content={streaming} streaming />}
        {sending && !streaming && (
          <div className="flex items-center gap-3"><QuestionGlyph size={32} /><span className="text-sm text-muted">{t(waiting ? 'practical.waiting' : 'practical.thinking')}</span></div>
        )}
      </div>

      {/* Вердикт по завершении */}
      {done && session && <VerdictCard session={session} onDone={() => navigate(`/learn/${courseId}/${enrollmentId}`)} />}

      {/* Ввод */}
      {!done && (
        <div className="mt-3">
          {error && <div className="mb-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error} <button className="ml-1 underline" disabled={sending} onClick={() => void runTurn('', true)}>{t('common.retry')}</button></div>}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Textarea
                value={input}
                maxLength={MAX_STUDENT_MESSAGE_CHARS}
                placeholder={t('practical.placeholder')}
                className="min-h-[52px] max-h-40"
                onChange={(e) => { if (!typingStart.current && e.target.value) typingStart.current = Date.now(); setInput(e.target.value); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
              />
              <div className="mt-1 text-right font-mono text-[11px] text-muted">{input.length}/{MAX_STUDENT_MESSAGE_CHARS}</div>
            </div>
            <Button size="lg" loading={sending} disabled={!input.trim()} onClick={send}>{t('practical.send')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Bubble({ role, content, streaming }: { role: 'AI' | 'STUDENT'; content: string; streaming?: boolean }) {
  if (role === 'STUDENT') {
    return (
      <div className="flex justify-end animate-fade-up">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-sm text-white">{content}</div>
      </div>
    );
  }
  return (
    <div className="flex gap-3 animate-fade-up">
      <QuestionGlyph size={32} />
      <div className="max-w-[80%] rounded-2xl rounded-tl-md border border-border bg-card px-4 py-2.5 text-sm text-fg">
        {content}{streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-spark align-middle" />}
      </div>
    </div>
  );
}

function VerdictCard({ session, onDone }: { session: SessionView; onDone: () => void }) {
  const { t } = useTranslation();
  const passed = session.status === 'PASSED';
  const ev = session.evaluationResult;
  return (
    <Card className={clsx('mt-3', passed ? 'border-teal/40' : 'border-danger/30')}>
      <div className="flex items-center gap-3">
        <span className={clsx('grid h-10 w-10 place-items-center rounded-full text-xl', passed ? 'bg-teal/15 text-teal' : 'bg-danger/10 text-danger')}>{passed ? '✓' : '—'}</span>
        <div>
          <div className="font-semibold">{passed ? t('practical.verdictPassed') : session.status === 'ABANDONED' ? t('practical.verdictAbandoned') : t('practical.verdictFailed')}</div>
          {session.verdictReason && <div className="text-xs text-muted">{session.verdictReason}</div>}
        </div>
      </div>
      {ev && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('practical.reasoning')} · {t('practical.scaleNote')}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <MeterBar value={ev.avg_methodicalness / 3} tone="brand" label={t('practical.methodicalness')} />
            <MeterBar value={ev.avg_question_quality / 3} tone="spark" label={t('practical.questionQuality')} />
            <MeterBar value={ev.avg_logical_progression / 3} tone="brand" label={t('practical.logicalProgression')} />
            <MeterBar value={ev.avg_self_correction / 3} tone="teal" label={t('practical.selfCorrection')} />
          </div>
        </div>
      )}
      <Button className="mt-5 w-full" onClick={onDone}>{t('common.close')}</Button>
    </Card>
  );
}
