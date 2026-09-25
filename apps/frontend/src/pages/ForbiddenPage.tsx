import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { buttonClass } from '../components/ui';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { ServiceMessage } from './NotFoundPage';

/** 403: роль не подходит к разделу — показываем причину вместо молчаливого редиректа. */
export function ForbiddenPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('shell.forbidden.title'));
  return (
    <ServiceMessage code="403" title={t('shell.forbidden.title')} text={t('shell.forbidden.text')}>
      <Link to="/" className={buttonClass('primary', 'md')}>{t('shell.toHome')}</Link>
    </ServiceMessage>
  );
}
