import { useTranslation } from 'react-i18next';
import { PageHeader, EmptyState } from '../../components/page';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/** Журнал аудита (/admin/audit) — ЗАГЛУШКА FE0, реализует FE5. */
export function AuditPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('shell.pages.audit'));
  return (
    <>
      <PageHeader title={t('shell.pages.audit')} />
      <EmptyState title={t('shell.stub')} hint={t('shell.stubHint')} />
    </>
  );
}
