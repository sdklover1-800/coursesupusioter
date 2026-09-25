import { useTranslation } from 'react-i18next';
import { PageHeader, EmptyState } from '../../components/page';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/** Входящие жалоб на контент (/manage/issues) — ЗАГЛУШКА FE0, реализует FE5 (пространство «issues»). */
export function ContentIssuesPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('shell.pages.issues'));
  return (
    <>
      <PageHeader title={t('shell.pages.issues')} />
      <EmptyState title={t('shell.stub')} hint={t('shell.stubHint')} />
    </>
  );
}
