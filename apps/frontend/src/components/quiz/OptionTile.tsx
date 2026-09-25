import { clsx } from 'clsx';
import { forwardRef, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../icons';

/**
 * Режим поверхности теста — ДИСКРИМИНАНТ типов (FE3, правила исследования):
 * 'official' — официальная попытка: только выбор (brand), никаких отметок правильности;
 * 'practice' — тренировка: после проверки — teal/danger с глифом ✓/✗;
 * 'review'   — разбор после отправки (уровень FULL): статичные варианты с метками.
 * В ветке 'official' поля mark/rationale/tags имеют тип never: попытка их передать — ошибка tsc.
 */
export type QuizSurfaceMode = 'official' | 'practice' | 'review';

/**
 * Отметка варианта после проверки (только practice/review):
 * correct — выбран и верен; wrong — выбран и неверен; key — верный, но не выбран.
 */
export type OptionMark = 'correct' | 'wrong' | 'key';

/** Метки варианта в разборе: «Ваш ответ» / «Верный ответ». */
export type ReviewTag = 'yours' | 'correct';

interface TileBase {
  /** Буква по ПОЗИЦИИ ПОКАЗА (A–D), не по каноническому id */
  letter: string;
  text: string;
  selected: boolean;
  /** Семантика флажка (несколько ответов); по умолчанию — переключатель */
  multiple?: boolean;
  onSelect?: () => void;
  disabled?: boolean;
  tabIndex?: number;
  onKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
  className?: string;
}

export type OfficialTileProps = TileBase & {
  mode: 'official';
  mark?: never;
  rationale?: never;
  tags?: never;
};
export type PracticeTileProps = TileBase & {
  mode: 'practice';
  mark?: OptionMark | null;
  /** Обоснование варианта (после раскрытия разбора) */
  rationale?: string | null;
  tags?: never;
};
export type ReviewTileProps = Omit<TileBase, 'onSelect' | 'tabIndex' | 'onKeyDown' | 'multiple'> & {
  mode: 'review';
  mark?: OptionMark | null;
  rationale?: string | null;
  tags?: ReviewTag[];
};
export type OptionTileProps = OfficialTileProps | PracticeTileProps | ReviewTileProps;

const tileBase =
  'lip relative flex w-full min-h-[56px] items-start gap-3 rounded-lg border-2 bg-card px-3.5 py-3 text-left text-base leading-6 text-fg sm:px-4';

/** Классы плитки по состоянию. Цвета правильности — только вне официальной попытки. */
function tileTone(selected: boolean, mark: OptionMark | null | undefined, interactive: boolean): string {
  if (mark === 'correct' || mark === 'key') return 'border-teal-ink bg-teal/12 !border-b-teal-ink';
  if (mark === 'wrong') return 'border-danger-ink bg-danger/8 !border-b-danger-ink';
  if (selected) return 'border-brand bg-brand-soft !border-b-brand';
  return clsx('border-border', interactive && 'hover:border-brand/50 hover:bg-brand-soft/30');
}

function LetterChip({ letter, selected }: { letter: string; selected: boolean }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'grid h-8 w-8 shrink-0 place-items-center rounded-md border font-mono text-sm font-semibold',
        selected ? 'border-brand-fill bg-brand-fill text-white' : 'border-border-strong bg-surface text-fg-2',
      )}
    >
      {letter}
    </span>
  );
}

/** ✓ / ✗ чип отметки (глиф + текст для скринридера; цвет не единственный носитель смысла). */
function MarkChip({ mark }: { mark: OptionMark }) {
  const { t } = useTranslation();
  const ok = mark !== 'wrong';
  return (
    <span className="ml-auto flex shrink-0 items-center pl-2">
      <span
        aria-hidden
        className={clsx('grid h-7 w-7 place-items-center rounded-full text-white', ok ? 'bg-teal-ink dark:text-ink' : 'bg-danger-ink dark:text-ink')}
      >
        <Icon name={ok ? 'check' : 'x'} size={16} strokeWidth={2.5} />
      </span>
      <span className="sr-only">{mark === 'wrong' ? t('quiz.review.itemWrong') : t('quiz.review.correctAnswer')}</span>
    </span>
  );
}

function TagPill({ tag }: { tag: ReviewTag }) {
  const { t } = useTranslation();
  return tag === 'yours' ? (
    <span className="inline-flex items-center rounded-full border border-brand/60 px-2 py-px text-small font-semibold text-brand">{t('quiz.review.yourAnswer')}</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-teal/12 px-2 py-px text-small font-semibold text-teal-ink">
      <Icon name="check" size={12} strokeWidth={2.5} />
      {t('quiz.review.correctAnswer')}
    </span>
  );
}

/** Текст варианта + (practice/review) обоснование и метки. */
function TileBody({ text, rationale, tags }: { text: string; rationale?: string | null; tags?: ReviewTag[] }) {
  return (
    <span className="min-w-0 flex-1 pt-1">
      <span className="block break-words">{text}</span>
      {tags && tags.length > 0 && (
        <span className="mt-1.5 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <TagPill key={tag} tag={tag} />
          ))}
        </span>
      )}
      {rationale && <span className="mt-1.5 block text-sm leading-[1.5] text-fg-2">{rationale}</span>}
    </span>
  );
}

/**
 * Плитка варианта ответа: минимум 56px, «губа», 32px буквенный чип A–D (моно).
 * Выбор — только brand. Отметки правильности (teal-ink ✓ / danger-ink ✗) — только в
 * тренировке и полном разборе; в 'official' их нельзя передать по типу.
 */
export const OptionTile = forwardRef<HTMLButtonElement, OptionTileProps>(function OptionTile(props, ref) {
  if (props.mode === 'review') {
    const { letter, text, selected, mark, rationale, tags, className } = props;
    return (
      <div className={clsx(tileBase, tileTone(selected, mark, false), className)}>
        <LetterChip letter={letter} selected={selected && !mark} />
        <TileBody text={text} rationale={rationale} tags={tags} />
        {mark && <MarkChip mark={mark} />}
      </div>
    );
  }
  const { letter, text, selected, multiple, onSelect, disabled, tabIndex, onKeyDown, className } = props;
  const mark = props.mode === 'practice' ? props.mark : null;
  const rationale = props.mode === 'practice' ? props.rationale : null;
  return (
    <button
      ref={ref}
      type="button"
      role={multiple ? 'checkbox' : 'radio'}
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      tabIndex={tabIndex}
      onClick={() => !disabled && onSelect?.()}
      onKeyDown={onKeyDown}
      className={clsx(tileBase, tileTone(selected, mark, !disabled), disabled && 'cursor-default', className)}
    >
      <LetterChip letter={letter} selected={selected && !mark} />
      <TileBody text={text} rationale={rationale} />
      {mark && <MarkChip mark={mark} />}
    </button>
  );
});

/** Вложенный слот под списком вариантов (строка инструкции и т.п.). */
export function OptionInstruction({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1.5 text-body text-fg-2">
      {children}
    </p>
  );
}
