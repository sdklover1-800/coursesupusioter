import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import type { PracticalBrief } from '../../lib/practical';
import { moduleShortTitle } from '../../lib/practical';
import { romanOf } from '../course/labels';
import { Button } from '../ui';
import { Icon } from '../icons';
import { RichText } from './RichText';

/** Шаги диалога: agenda задания или «Позиция → Аргументы из курса → Итоговый вывод». */
export function useAgenda(brief: Pick<PracticalBrief, 'agenda'>): string[] {
  const { t } = useTranslation();
  const own = brief.agenda.filter((s) => s.trim());
  return own.length ? own : [t('practical.brief.agendaDefault.a'), t('practical.brief.agendaDefault.b'), t('practical.brief.agendaDefault.c')];
}

/** Нумерованные шаги диалога (вертикально). */
export function AgendaSteps({ steps, className }: { steps: string[]; className?: string }) {
  return (
    <ol className={clsx('space-y-2', className)}>
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-2.5 text-body text-fg">
          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-spark/15 font-mono text-xs font-semibold tabular-nums text-spark-ink" aria-hidden>
            {i + 1}
          </span>
          <span className="min-w-0 font-medium">{s}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Содержимое «Задания»: сценарий (ровно то, что получает тьютор), модули курса, ход диалога.
 * Используется и в левой панели (lg), и в листе «Задание» на мобильных.
 */
export function TaskDetails({ brief }: { brief: PracticalBrief }) {
  const { t } = useTranslation();
  const agenda = useAgenda(brief);
  // Римский номер модуля: по orderIndex лекций брифа (если группы совпадают с moduleTitles), иначе по порядку
  const orders = [...new Set(brief.lectures.map((l) => l.moduleOrderIndex))].sort((a, b) => a - b);
  const numeral = (i: number) => romanOf(orders.length === brief.moduleTitles.length ? orders[i] : i);
  return (
    <div className="space-y-6">
      <section>
        <h3 className="eyebrow mb-2">{t('practical.chat.panel.scenario')}</h3>
        <RichText text={brief.scenario} className="text-body leading-relaxed text-fg" />
      </section>
      {brief.moduleTitles.length > 0 && (
        <section>
          <h3 className="eyebrow mb-2">{t('practical.chat.panel.modules')}</h3>
          <ul className="space-y-1.5">
            {brief.moduleTitles.map((title, i) => (
              <li key={i} className="flex items-start gap-2.5 text-body text-fg-2">
                <span className="mt-0.5 inline-flex h-6 min-w-[1.75rem] shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface-2 px-1.5 font-display text-small font-semibold text-fg">
                  {numeral(i)}
                </span>
                <span className="min-w-0">{moduleShortTitle(title)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className="eyebrow mb-2">{t('practical.chat.panel.agenda')}</h3>
        <AgendaSteps steps={agenda} />
      </section>
    </div>
  );
}

/**
 * Левая липкая панель задания в диалоге (lg+). Сворачивается в узкую полосу с кнопками
 * «Показать задание» и «Конспекты лекций» — лента диалога получает ширину.
 */
export function TaskPanel({
  brief, collapsed, onToggle, onOpenLectures,
}: {
  brief: PracticalBrief;
  collapsed: boolean;
  onToggle: () => void;
  onOpenLectures: () => void;
}) {
  const { t } = useTranslation();
  if (collapsed) {
    return (
      <aside aria-label={t('practical.chat.task')} className="flex h-full flex-col items-center gap-2 border-r border-border py-4 pr-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          aria-label={t('practical.chat.panel.expand')}
          title={t('practical.chat.panel.expand')}
          className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-card text-fg-2 transition-colors hover:border-brand/50 hover:text-fg"
        >
          <Icon name="file-text" size={20} />
        </button>
        <button
          type="button"
          onClick={onOpenLectures}
          aria-label={t('practical.materials.title')}
          title={t('practical.materials.title')}
          className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-card text-fg-2 transition-colors hover:border-brand/50 hover:text-fg"
        >
          <Icon name="book-open" size={20} />
        </button>
      </aside>
    );
  }
  return (
    <aside aria-label={t('practical.chat.task')} className="flex h-full min-h-0 flex-col border-r border-border pr-6">
      <div className="flex shrink-0 items-center justify-between gap-2 pb-3 pt-5">
        <h2 className="font-sans text-title text-fg">{t('practical.chat.task')}</h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded
          className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-medium text-fg-2 transition-colors hover:bg-brand-soft hover:text-fg"
        >
          {t('practical.chat.panel.collapse')}
          <Icon name="chevron-left" size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4 pr-1">
        <TaskDetails brief={brief} />
      </div>
      <div className="shrink-0 border-t border-border py-4">
        <Button variant="secondary" className="w-full" onClick={onOpenLectures}>
          <Icon name="book-open" size={18} />
          {t('practical.materials.title')}
        </Button>
      </div>
    </aside>
  );
}
