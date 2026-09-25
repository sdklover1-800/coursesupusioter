import type { certificate as ruCertificate } from '../ru/certificate';
import type { Loc } from '../../types';

/** Student certificates (CertificatesPage). */
export const certificate: Loc<typeof ruCertificate> = {
  eyebrow: 'Achievements',
  title: 'Certificates',
  issuedOn: 'Issued {{date}}',
  serial: 'Certificate number',
  download: 'Download PDF',
  copyLink: 'Copy the verification link',
  copied: 'Link copied',
  copyFailed: 'Could not copy. The link: {{url}}',
  emptyTitle: 'Your certificate appears once you complete the course',
  emptyHint: 'Here is what is left:',
  emptyNoCourses: 'Enrol in a course from the catalog — the certificate is issued when you complete it.',
  toCourse: 'Go to the course',
  allDone: 'All requirements met — the certificate is being issued.',
  loadError: 'Could not load certificates',
};
