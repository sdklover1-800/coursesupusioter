import type { shell as ruShell } from '../ru/shell';
import type { Loc } from '../../types';

/** App shell: navigation, header, mobile bars, service pages — owned by FE0. */
export const shell: Loc<typeof ruShell> = {
  skipToContent: 'Skip to content',
  home: 'Home', catalog: 'Catalog', certificates: 'Certificates', profile: 'Profile', more: 'More',
  tabCertificates: 'Certificates',
  issues: 'Content issues', logout: 'Log out',
  mainNav: 'Main navigation', tabBar: 'Sections', menu: 'Menu', moreMenu: 'More options',
  language: 'Interface language',
  langShort: { kk: 'Қаз', ru: 'Рус', en: 'Eng' },
  darkTheme: 'Dark theme', lightTheme: 'Light theme', systemTheme: 'Match system',
  a11y: 'Low-vision mode',
  exitFocus: 'Exit',
  sessionExpired: 'Your session has expired. Please sign in again.',
  verifyCertificate: 'Verify a certificate',
  notFound: {
    title: 'Page not found',
    text: 'The link may be outdated, or the address may contain a typo.',
  },
  forbidden: {
    title: 'Access denied',
    text: 'Your role doesn’t have access to this section.',
  },
  toHome: 'Go to home',
  stub: 'In development', stubHint: 'This section is coming in an upcoming update.',
  pages: {
    profile: 'Profile', verify: 'Certificate verification', issues: 'Content issues', audit: 'Audit log',
  },
};
