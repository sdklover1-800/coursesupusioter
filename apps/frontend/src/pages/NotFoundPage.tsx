import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { buttonClass } from '../components/ui';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/** 404: вместо молчаливого редиректа на главную (screen_specs «Global shell»). */
export function NotFoundPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('shell.notFound.title'));
  return (
    <ServiceMessage code="404" title={t('shell.notFound.title')} text={t('shell.notFound.text')}>
      <Link to="/" className={buttonClass('primary', 'md')}>{t('shell.toHome')}</Link>
    </ServiceMessage>
  );
}

/** Общая раскладка служебных страниц (404/403): крупный моно-код, заголовок, пояснение, действие. */
export function ServiceMessage({ code, title, text, children }: { code: string; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="grid min-h-[60vh] place-items-center py-10">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-brand-soft font-display text-3xl font-bold text-brand" aria-hidden>?</div>
        <div className="num mb-2 text-fg-2">{code}</div>
        <h1 className="font-display text-display-lg">{title}</h1>
        <p className="mt-3 text-body text-fg-2">{text}</p>
        {children && <div className="mt-6 flex justify-center gap-2">{children}</div>}
      </div>
    </div>
  );
}
