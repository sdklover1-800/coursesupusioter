import { clsx } from 'clsx';
import { useRef, type KeyboardEvent } from 'react';
import { optionLetter } from '../../lib/quiz';
import { OptionTile, type OptionMark } from './OptionTile';

/** Вариант в ПОРЯДКЕ ПОКАЗА: id — канонический (ответ отправляется по нему). */
export interface GroupOption {
  id: number;
  text: string;
}

interface GroupBase {
  options: GroupOption[];
  /** Выбранные канонические id */
  selected: number[];
  onChange?: (ids: number[]) => void;
  /** Несколько ответов (checkbox); по умолчанию — один (radio) */
  multiple?: boolean;
  /** id заголовка вопроса — доступное имя группы */
  labelledBy?: string;
  /** id строки инструкции */
  describedBy?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Официальная попытка: только выбор. marks/rationales/disabledIds — never (FE3: правильность
 * не показывается ни цветом, ни глифом, ни текстом до отправки).
 */
export type OfficialGroupProps = GroupBase & {
  mode: 'official';
  marks?: never;
  rationales?: never;
  disabledIds?: never;
};
/** Тренировка: после проверки — отметки и обоснования вариантов. */
export type PracticeGroupProps = GroupBase & {
  mode: 'practice';
  marks?: Partial<Record<number, OptionMark>>;
  rationales?: Partial<Record<number, string | null>>;
  /** Уже отвергнутые варианты (неверный первый ответ) */
  disabledIds?: number[];
};
export type OptionGroupProps = OfficialGroupProps | PracticeGroupProps;

/**
 * Группа вариантов: role=radiogroup + role=radio (или group + checkbox), roving tabindex,
 * стрелки ↑↓←→ переводят фокус и выбор (WAI-ARIA radio). Клавиши 1–4 — в раннере (useQuizHotkeys).
 */
export function OptionGroup(props: OptionGroupProps) {
  const { options, selected, onChange, multiple, labelledBy, describedBy, disabled, className } = props;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const disabledIds = props.mode === 'practice' ? props.disabledIds ?? [] : [];
  const selectedIndex = options.findIndex((o) => selected.includes(o.id));
  const focusIndex = selectedIndex >= 0 ? selectedIndex : 0;

  function choose(id: number) {
    if (disabled || disabledIds.includes(id)) return;
    if (multiple) onChange?.(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    else onChange?.([id]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (multiple) return;
    const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const n = options.length;
    for (let step = 1; step <= n; step++) {
      const next = (index + delta * step + n * n) % n;
      const opt = options[next];
      if (opt && !disabledIds.includes(opt.id)) {
        refs.current[next]?.focus();
        choose(opt.id);
        return;
      }
    }
  }

  return (
    <div
      role={multiple ? 'group' : 'radiogroup'}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-disabled={disabled || undefined}
      className={clsx('space-y-2.5', className)}
    >
      {options.map((opt, i) => {
        const isSelected = selected.includes(opt.id);
        const common = {
          letter: optionLetter(i),
          text: opt.text,
          selected: isSelected,
          multiple,
          disabled: disabled || disabledIds.includes(opt.id),
          tabIndex: multiple ? 0 : i === focusIndex ? 0 : -1,
          onSelect: () => choose(opt.id),
          onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => onKeyDown(e, i),
          ref: (el: HTMLButtonElement | null) => {
            refs.current[i] = el;
          },
        };
        return props.mode === 'official' ? (
          <OptionTile key={opt.id} mode="official" {...common} />
        ) : (
          <OptionTile
            key={opt.id}
            mode="practice"
            {...common}
            mark={props.marks?.[opt.id] ?? null}
            rationale={props.rationales?.[opt.id] ?? null}
          />
        );
      })}
    </div>
  );
}
