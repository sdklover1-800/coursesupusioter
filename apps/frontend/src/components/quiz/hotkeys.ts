import { useEffect, useRef, type RefObject } from 'react';

/**
 * Клавиши раннеров тестов (FE3 §1): 1–4 — выбор варианта, Enter — основное действие
 * (только тренировка). scopeRef — слушать лишь внутри карточки (встроенный мини-квиз
 * на странице лекции не должен перехватывать клавиши плеера); без scopeRef — весь документ
 * (режим фокуса). Не срабатывают в полях ввода, с модификаторами и при открытом модальном окне.
 */
export function useQuizHotkeys({
  enabled, scopeRef, optionCount, onDigit, onEnter,
}: {
  enabled: boolean;
  scopeRef?: RefObject<HTMLElement>;
  optionCount: number;
  onDigit: (index: number) => void;
  onEnter?: () => void;
}) {
  const handlers = useRef({ onDigit, onEnter, optionCount });
  handlers.current = { onDigit, onEnter, optionCount };

  useEffect(() => {
    if (!enabled) return;
    const target: HTMLElement | Document | null = scopeRef ? scopeRef.current : document;
    if (!target) return;
    function onKey(e: Event) {
      const ev = e as KeyboardEvent;
      if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      const el = ev.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      // Открытый диалог/лист (жалоба, подтверждение) — клавиши принадлежат ему
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const h = handlers.current;
      if (/^[1-9]$/.test(ev.key)) {
        const i = Number(ev.key) - 1;
        if (i < h.optionCount) {
          ev.preventDefault();
          h.onDigit(i);
        }
        return;
      }
      if (ev.key === 'Enter' && h.onEnter) {
        // На кнопках и ссылках Enter — их собственный клик; на варианте ответа — «Проверить»
        const isOption = !!el?.closest('[role="radio"],[role="checkbox"]');
        if (!isOption && el && el.closest('button, a, [role="button"], [role="tab"]')) return;
        ev.preventDefault();
        h.onEnter();
      }
    }
    target.addEventListener('keydown', onKey);
    return () => target.removeEventListener('keydown', onKey);
  }, [enabled, scopeRef]);
}
