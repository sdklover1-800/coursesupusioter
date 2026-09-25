import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import type { ReviewItem } from '@edu/shared';
import { Icon } from '../icons';

/**
 * Разбор уровня CORRECTNESS (до финала теста, USER_DECISIONS §1): только формулировки
 * вопросов в порядке попытки и ✓/✗ с текстом. НИКАКИХ вариантов, ключа, пояснений,
 * ссылок на лекции и карточки «Следующий шаг» — они раскрыли бы ответы второй попытки.
 */
export function CorrectnessList({ items }: { items: ReviewItem[] }) {
  const { t } = useTranslation();
  const sorted = [...items].sort((a, b) => a.position - b.position);
  return (
    <div data-review-level="CORRECTNESS">
      <ol className="card divide-y divide-border">
        {sorted.map((it, i) => (
          <li key={it.questionId} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
            <span className="num mt-0.5 w-6 shrink-0 text-fg-2">{i + 1}</span>
            {/* На мобильных статус — под формулировкой (узкая колонка не сжимает текст вопроса) */}
            <div className="min-w-0 flex-1 sm:flex sm:items-start sm:gap-4">
              <p className="text-body leading-6 text-fg sm:flex-1">{it.prompt}</p>
              <span
                className={clsx(
                  'mt-1 inline-flex shrink-0 items-center gap-1 text-label font-semibold sm:mt-0.5',
                  it.isCorrect ? 'text-teal-ink' : 'text-danger-ink',
                )}
              >
                <Icon name={it.isCorrect ? 'check' : 'x'} size={16} strokeWidth={2.5} />
                {it.isCorrect ? t('quiz.review.itemCorrect') : t('quiz.review.itemWrong')}
              </span>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 flex items-start gap-2.5 rounded-xl bg-surface-2 px-4 py-3 text-body text-fg-2">
        <Icon name="lock" size={18} className="mt-0.5 shrink-0" />
        {t('quiz.review.correctnessNotice')}
      </p>
    </div>
  );
}
