import { clsx } from 'clsx';
import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_STUDENT_MESSAGE_CHARS } from '@edu/shared';
import { loadDraft, saveDraft } from '../../lib/practical';
import { Button, Kbd } from '../ui';
import { Icon } from '../icons';

/** Мягкая подсказка для очень коротких ответов (screen_specs: < 15 символов). */
const SHORT_CHARS = 15;
/** Автовысота: до 8 строк (16px × 1.625) + вертикальные отступы поля. */
const MAX_LINES = 8;

export interface ComposerHandle {
  focus: () => void;
}

/**
 * Поле ответа тьютору: авторост до 8 строк, счётчик n/1500, «⌘/Ctrl + Enter — отправить»,
 * кнопка с тремя точками во время отправки, черновик в localStorage по сессии, мягкая
 * подсказка для ответов короче 15 символов. Никаких готовых подсказок/шаблонов ответа
 * (правило исследования: в оцениваемом диалоге нет suggestion chips).
 */
export const Composer = forwardRef<
  ComposerHandle,
  {
    sessionId: string;
    sending: boolean;
    /** Сессия завершена — поле скрывает родитель; здесь — блокировка отправки */
    disabled?: boolean;
    /** Ход не завершён (ошибка после сохранения реплики) — только «Повторить», черновик писать можно */
    blocked?: boolean;
    onSend: (text: string, typingMs?: number) => void;
    /** Над полем: баннер «последний ответ», ошибка хода */
    above?: ReactNode;
    className?: string;
  }
>(function Composer({ sessionId, sending, disabled, blocked, onSend, above, className }, ref) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => loadDraft(sessionId));
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const typingStart = useRef<number | null>(null);
  const hintId = useId();
  const counterId = useId();

  useImperativeHandle(ref, () => ({ focus: () => areaRef.current?.focus() }), []);

  // Черновик — по сессии (другая сессия → свой черновик)
  useEffect(() => {
    setText(loadDraft(sessionId));
  }, [sessionId]);
  useEffect(() => {
    saveDraft(sessionId, text);
  }, [sessionId, text]);

  // Авторост до 8 строк
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const cs = window.getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 26;
    // scrollHeight включает внутренние отступы (рамки у поля нет)
    const max = line * MAX_LINES + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [text]);

  const trimmed = text.trim();
  const canSend = !!trimmed && !sending && !disabled && !blocked;

  function submit() {
    if (!canSend) return;
    const typingMs = typingStart.current ? Date.now() - typingStart.current : undefined;
    typingStart.current = null;
    onSend(trimmed, typingMs);
    setText('');
  }

  return (
    <div className={clsx('mx-auto w-full max-w-[760px]', className)}>
      {above}
      <div className="rounded-2xl border border-border bg-card p-2 shadow-soft transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/25">
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t('practical.composer.label')}</span>
            <textarea
              ref={areaRef}
              value={text}
              rows={1}
              maxLength={MAX_STUDENT_MESSAGE_CHARS}
              placeholder={t('practical.composer.placeholder')}
              aria-describedby={`${hintId} ${counterId}`}
              disabled={disabled}
              onChange={(e) => {
                if (!typingStart.current && e.target.value) typingStart.current = Date.now();
                setText(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
              className="block w-full resize-none border-0 bg-transparent px-2.5 py-2 text-base leading-[1.625] text-fg placeholder:text-muted focus:outline-none focus:ring-0 disabled:opacity-60"
            />
          </label>
          <Button
            onClick={submit}
            disabled={!canSend}
            aria-label={sending ? t('practical.composer.sending') : undefined}
            className="h-11 shrink-0 px-4"
          >
            {sending ? (
              <span className="flex items-center gap-1 px-1.5" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" style={{ animationDelay: `${i * 160}ms` }} />
                ))}
              </span>
            ) : (
              <>
                <span className="hidden sm:inline">{t('practical.composer.send')}</span>
                <Icon name="arrow-right" size={18} label={t('practical.composer.send')} className="sm:hidden" />
              </>
            )}
          </Button>
        </div>
      </div>
      <div className="mt-1.5 flex min-h-[1.25rem] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-small text-fg-2">
        <span id={hintId} className="flex min-w-0 items-center gap-1">
          {trimmed && trimmed.length < SHORT_CHARS ? (
            <span className="text-fg-2">{t('practical.composer.short')}</span>
          ) : (
            <span className="hidden items-center gap-1 sm:inline-flex">
              <Kbd>⌘/Ctrl</Kbd>+<Kbd>Enter</Kbd>
              <span>— {t('practical.composer.hint')}</span>
            </span>
          )}
        </span>
        <span id={counterId} className="num ml-auto shrink-0 text-fg-2">
          <span aria-hidden>
            {text.length}/{MAX_STUDENT_MESSAGE_CHARS}
          </span>
          <span className="sr-only">{t('practical.composer.counter', { n: text.length, max: MAX_STUDENT_MESSAGE_CHARS })}</span>
        </span>
      </div>
    </div>
  );
});
