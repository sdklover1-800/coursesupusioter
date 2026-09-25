import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet, StatusIcon } from '../ui';
import { Icon } from '../icons';
import { OutlineRows, type OutlineModule } from './CourseOutlineRail';

/**
 * Содержание курса на мобильных и планшетах (Open edX drill-down): нижний лист FE0.
 * Уровень 1 — модули со StatusIcon и «Лекции: 2 из 3»; уровень 2 — элементы модуля
 * под заголовком «‹ Все модули». Открывается сразу на модуле текущей лекции.
 */
export function OutlineSheet({
  open, onClose, modules, currentModuleId,
}: {
  open: boolean;
  onClose: () => void;
  modules: OutlineModule[];
  currentModuleId: string | undefined;
}) {
  const { t } = useTranslation();
  const [moduleId, setModuleId] = useState<string | null>(currentModuleId ?? null);
  useEffect(() => {
    if (open) setModuleId(currentModuleId ?? null);
  }, [open, currentModuleId]);
  const mod = modules.find((m) => m.id === moduleId) ?? null;

  return (
    <Sheet open={open} onClose={onClose} title={t('lecture.outline.title')}>
      {mod ? (
        <div>
          <button
            type="button"
            onClick={() => setModuleId(null)}
            className="-ml-2 mb-2 inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-lg px-2 text-body font-medium text-brand hover:bg-brand-soft"
          >
            <Icon name="chevron-left" size={18} />
            {t('lecture.outline.allModules')}
          </button>
          <h3 className="mb-1 text-title text-fg">
            <span className="font-display">{mod.roman}</span> · {mod.title}
          </h3>
          <p className="mb-3 text-meta text-fg-2">{t('lecture.outline.lecturesDone', { done: mod.lecturesDone, total: mod.lecturesTotal })}</p>
          <div className="-mx-2">
            <OutlineRows rows={mod.rows} onNavigate={onClose} />
          </div>
        </div>
      ) : (
        <ul aria-label={t('lecture.outline.modules')} className="-mx-2 space-y-0.5">
          {modules.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => setModuleId(m.id)}
                className="flex min-h-[3.5rem] w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-brand-soft/60"
              >
                <StatusIcon
                  state={m.state}
                  progress={m.lecturesTotal ? m.lecturesDone / m.lecturesTotal : 0}
                  size={24}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-semibold text-fg">
                    <span className="font-display">{m.roman}</span> · {m.title}
                  </span>
                  <span className="block text-sm text-fg-2">{t('lecture.outline.lecturesDone', { done: m.lecturesDone, total: m.lecturesTotal })}</span>
                </span>
                <Icon name="chevron-right" size={18} className="text-fg-2" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
