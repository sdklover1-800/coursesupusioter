import { useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { DEFAULT_QUIZ_COOLDOWN_MINUTES } from '@edu/shared';
import { Card, Icon, ModeBadge, QuestionGlyph } from '../ui';

const KEY = 'edu.course.howItWorks';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === 'hidden';
  } catch {
    return false;
  }
}

/**
 * «Как устроен курс» (правый рельс): легенда «Тренировка / Оценивание», правило
 * «2 попытки, лучшая, пауза 24 ч», договор с тьютором и свободный порядок.
 * Скрывается кнопкой; выбор хранится в localStorage (без туров и модалок).
 */
export function HowItWorksCard({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(readDismissed);
  if (hidden) return null;
  const hours = Math.round(DEFAULT_QUIZ_COOLDOWN_MINUTES / 60);

  function dismiss() {
    try {
      localStorage.setItem(KEY, 'hidden');
    } catch {
      /* приватный режим — просто скрываем до перезагрузки */
    }
    setHidden(true);
  }

  const row = (icon: ReactNode, text: string) => (
    <li className="text-meta text-fg">
      <span className="mr-1.5 inline-flex align-middle">{icon}</span>
      {text}
    </li>
  );

  return (
    <Card className={clsx('relative !p-5', className)}>
      <h2 className="pr-10 font-sans text-title">{t('course.howItWorks.title')}</h2>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('course.howItWorks.dismiss')}
        title={t('course.howItWorks.dismiss')}
        className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-fg-2 transition-colors hover:bg-brand-soft hover:text-fg"
      >
        <Icon name="x" size={18} />
      </button>
      <ul className="mt-3 space-y-2.5">
        {row(<ModeBadge mode="practice" />, t('course.howItWorks.practice'))}
        {row(<ModeBadge mode="graded" />, t('course.howItWorks.graded', { hours }))}
        {row(<QuestionGlyph size={20} />, t('course.howItWorks.tutor'))}
        {row(<Icon name="compass" size={20} className="text-fg-2" />, t('course.howItWorks.order'))}
      </ul>
    </Card>
  );
}
