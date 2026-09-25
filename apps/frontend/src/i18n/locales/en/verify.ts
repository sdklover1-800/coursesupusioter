import type { verify as ruVerify } from '../ru/verify';
import type { Loc } from '../../types';

/** Public certificate verification (/verify, /verify/:serial). */
export const verify: Loc<typeof ruVerify> = {
  eyebrow: 'Public verification',
  title: 'Verify a certificate',
  lead: 'Enter the certificate number — it is printed next to the QR code.',
  label: 'Certificate number',
  placeholder: 'EDU-2026-XXXXXXXXXX',
  submit: 'Verify',
  checking: 'Checking…',
  valid: 'Certificate is valid',
  invalid: 'Certificate not found',
  invalidHint: 'Check the number: it must match the one printed on the certificate.',
  holder: 'Holder',
  course: 'Course',
  language: 'Language of instruction',
  issuedAt: 'Date of issue',
  modules: 'Course modules',
  issuer: 'Issued by',
  number: 'Number',
  tooMany: 'Too many checks in a row. Please try again in a minute.',
  error: 'The check failed. Please try again.',
  privacy: 'Only the details printed on the certificate are shown.',
  empty: 'Enter a certificate number',
};
