import type { consent as ruConsent } from '../ru/consent';
import type { Loc } from '../../types';

export const consent: Loc<typeof ruConsent> = {
  title: 'Informed consent to participate in research',
  intro: 'This platform is used in a scientific study of learning effectiveness and critical-thinking development.',
  point1: 'Your learning activity (lecture views, quiz answers, dialogues with the assistant) is recorded for analysis.',
  point2: 'Data is processed in a pseudonymized form: direct identifiers are not used when data is exported for analysis.',
  point3: 'Participation is voluntary. Consent withdrawal is handled through an administrator.',
  version: 'Consent text version',
  accept: 'I have read and accept the terms', acceptBtn: 'Accept and continue',
  required: 'To start learning, you must accept the informed consent.',
  eyebrow: 'Research participation',
  pageTitle: 'Research consent',
  decline: 'I do not agree — sign out',
  declineHint: 'Without consent, course access is closed; questions go to the research team.',
  contact: 'Research team: {{contact}}',
  ethics: 'Ethics committee approval: {{approval}}',
  fullText: 'Full consent text',
  fullTextOnRequest: 'The research team provides the full consent text on request.',
  acceptError: 'Could not save your consent. Reload the page and try again.',
};
