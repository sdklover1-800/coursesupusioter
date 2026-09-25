import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { findMatches, termQuery, termStem, type ParsedTranscript } from '../../lib/transcript';
import { Button, TabPanel, Tabs, type TabItem } from '../ui';
import { Icon } from '../icons';

export type LectureTab = 'transcript' | 'summary' | 'terms' | 'mini';

/**
 * Вкладки под сценой: «Конспект | Кратко (если есть summary) | Термины (если в расшифровке
 * есть «Ключевые понятия», A28) | Мини-квиз». Панели передаёт страница.
 */
export function ContentTabs({
  value, onChange, hasSummary, hasTerms, hasMini, panels, idPrefix = 'lecture-tabs',
}: {
  value: LectureTab;
  onChange: (tab: LectureTab) => void;
  hasSummary: boolean;
  hasTerms: boolean;
  hasMini: boolean;
  panels: Partial<Record<LectureTab, ReactNode>>;
  idPrefix?: string;
}) {
  const { t } = useTranslation();
  const tabs: TabItem<LectureTab>[] = [
    { id: 'transcript', label: t('lecture.tabs.transcript') },
    ...(hasSummary ? [{ id: 'summary' as const, label: t('lecture.tabs.summary') }] : []),
    ...(hasTerms ? [{ id: 'terms' as const, label: t('lecture.tabs.terms') }] : []),
    ...(hasMini ? [{ id: 'mini' as const, label: t('lecture.tabs.miniQuiz') }] : []),
  ];
  const current = tabs.some((x) => x.id === value) ? value : 'transcript';
  return (
    <div>
      <Tabs tabs={tabs} value={current} onChange={onChange} ariaLabel={t('lecture.tabs.label')} idPrefix={idPrefix} />
      <TabPanel idPrefix={idPrefix} id={current} className="pt-5">
        {panels[current]}
      </TabPanel>
    </div>
  );
}

/** «Термины»: понятия из приложения расшифровки + сколько раз встречаются в тексте и поиск по ним. */
export function TermsList({ parsed, onFind }: { parsed: ParsedTranscript; onFind: (query: string) => void }) {
  const { t } = useTranslation();
  // Считаем упоминания только в основном тексте (не в самом списке понятий)
  const body = useMemo(
    () => parsed.sections.map((s) => [s.heading ?? '', ...s.blocks.map((b) => b.text)].join('\n')).join('\n'),
    [parsed],
  );
  const rows = useMemo(
    () =>
      parsed.terms.map((term) => {
        let query = termQuery(term.term);
        let count = findMatches(body, query).length;
        if (!count) {
          const stem = termStem(term.term);
          if (stem !== query) {
            const c = findMatches(body, stem).length;
            if (c) {
              query = stem;
              count = c;
            }
          }
        }
        return { term, query, count };
      }),
    [parsed.terms, body],
  );

  return (
    <div>
      <p className="mb-4 max-w-[62ch] text-meta text-fg-2">{t('lecture.terms.intro')}</p>
      <ul className="divide-y divide-border">
        {rows.map(({ term, query, count }) => (
          <li key={term.term} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
            <div className="min-w-0 flex-1 basis-60">
              <div className="text-body-lg font-semibold text-fg">{term.term}</div>
              {term.definition && <p className="mt-0.5 max-w-[62ch] text-body text-fg-2">{term.definition}</p>}
              <div className="mt-0.5 text-sm text-fg-2">
                {count > 0 ? t('lecture.terms.mentions', { count }) : t('lecture.terms.noMentions')}
              </div>
            </div>
            {count > 0 && (
              <Button variant="outline" size="sm" onClick={() => onFind(query)} className="shrink-0">
                <Icon name="search" size={16} />
                {t('lecture.terms.find')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
