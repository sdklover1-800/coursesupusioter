import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuizEdit, useQuizItems } from '../../lib/staff';
import { buttonClass, Sheet } from '../ui';
import { Icon } from '../icons';
import { ErrorState, LoadingRows } from '../page';
import { DistractorBar, PValue } from './ItemAnalysis';
import { MetaChip, SampleSize } from './primitives';

/**
 * Анализ заданий теста в листе (FE5 §5): p-value, распределение выборов (ключ выделен),
 * n по каждому вопросу; варианты и ключ — из редактора теста (сотрудник).
 */
export function ItemAnalysisSheet({ quizId, courseId, onClose }: { quizId: string | null; courseId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const items = useQuizItems(quizId);
  const edit = useQuizEdit(quizId ?? undefined, true);
  const byId = new Map((edit.data?.quiz.questions ?? []).map((q) => [q.id, q]));
  const data = items.data;

  return (
    <Sheet
      open={!!quizId}
      onClose={onClose}
      size="lg"
      title={t('dashboard.items.title')}
      description={data?.title}
      footer={
        quizId ? (
          <Link to={`/manage/quiz/${quizId}${courseId ? `?course=${courseId}` : ''}`} className={buttonClass('secondary', 'md')}>
            <Icon name="external-link" size={18} />
            {t('dashboard.items.openEditor')}
          </Link>
        ) : undefined
      }
    >
      {items.isLoading ? (
        <LoadingRows rows={4} />
      ) : items.isError ? (
        <ErrorState message={t('errors.generic')} />
      ) : !data ? (
        <p className="text-body text-fg-2">{t('dashboard.items.forbidden')}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-fg-2">
            <SampleSize n={data.n} />
            <span>{t('dashboard.items.attempts', { count: data.attempts })}</span>
          </div>
          <p className="text-small text-fg-2">{t('dashboard.items.hint')}</p>
          <ol className="space-y-3">
            {data.items.map((s, i) => {
              const q = byId.get(s.questionId);
              return (
                <li key={s.questionId} className="rounded-xl border border-border p-4">
                  <div className="flex items-start gap-2">
                    <span className="num mt-0.5 shrink-0 text-fg-2">{i + 1}</span>
                    <p className="min-w-0 flex-1 text-body font-medium text-fg" lang={data.language}>{s.prompt}</p>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-5">
                    <PValue p={s.pValue} />
                    <SampleSize n={s.n} unit="answers" />
                    {s.canonicalKey && <span className="num text-small text-fg-2">{s.canonicalKey}</span>}
                    {s.openIssues > 0 && <MetaChip icon="flag" tone="danger">{t('manager.qe.reports', { count: s.openIssues })}</MetaChip>}
                    {s.reviewPending && <MetaChip icon="flag" tone="spark">{t('manager.qe.reviewPending')}</MetaChip>}
                  </div>
                  {s.n > 0 && (
                    <div className="mt-3 pl-5">
                      <DistractorBar stat={s} options={q?.options ?? s.optionCounts.map(() => '')} correct={q?.correctOptionIds ?? []} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Sheet>
  );
}
