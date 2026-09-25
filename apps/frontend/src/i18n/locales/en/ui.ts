import type { ui as ruUi } from '../ru/ui';
import type { Loc } from '../../types';

/** Inquiry 2.0 design-system primitives — owned by FE0. */
export const ui: Loc<typeof ruUi> = {
  mode: {
    practice: 'Practice', graded: 'Graded',
    practiceLong: 'doesn’t affect your result',
    practiceHint: 'Practice doesn’t affect your result',
    gradedHint: 'Counts toward your final grade',
  },
  state: {
    NOT_STARTED: 'Not started', IN_PROGRESS: 'In progress', DONE: 'Done', PASSED: 'Passed',
    FAILED: 'Not passed', LOCKED: 'Unavailable', NEXT: 'Next',
  },
  kind: {
    LECTURE: 'Lecture', MINI_QUIZ: 'Mini-quiz', MODULE_QUIZ: 'Module test', PRACTICAL: 'Final practical',
    FINAL_MINI_QUIZ: 'Final mini-quiz', CERTIFICATE: 'Certificate',
  },
  next: 'Next', done: 'Done', current: 'Current',
  progress: 'Progress', progressValue: 'Progress: {{value}}%',
  seekTo: 'Jump to {{time}}',
  meter: {
    label: 'Tutor replies remaining',
    remaining_one: '{{count}} of {{max}} left', remaining_other: '{{count}} of {{max}} left',
    low: 'Few tutor replies left — time to draw your conclusion',
    last: 'One tutor reply left',
    none: 'No tutor replies left',
  },
  rubric: {
    methodicalness: 'Methodicalness', question_quality: 'Question quality',
    logical_progression: 'Logical progression', self_correction: 'Self-correction',
    score: '{{score}} of {{max}}',
  },
  breadcrumb: 'Breadcrumb', backTo: 'Back: {{label}}',
  dialog: { close: 'Close', cancel: 'Cancel', confirm: 'Confirm' },
  issue: {
    report: 'Report a problem',
    hint: 'The course authors will receive your message. There is no reply to it.',
    reasonLabel: 'What’s wrong?',
    comment: 'Comment', commentPlaceholder: 'Optional: describe what exactly is wrong',
    send: 'Send', sent: 'Thank you, your message has been sent',
    failed: 'Couldn’t send the message. Please try again later.',
    tooMany: 'Too many reports today. Please try again tomorrow.',
    reasons: {
      NO_CORRECT: 'No correct answer', TWO_CORRECT: 'More than one correct answer',
      UNCLEAR: 'Unclear wording', TRANSLATION: 'Translation error', FACT_ERROR: 'Factual error',
      GIVES_ANSWER: 'The tutor gave the answer away', TRANSCRIPT_ERROR: 'Transcript error',
      VIDEO: 'Video problem', OTHER: 'Other',
    },
  },
  toast: { dismiss: 'Dismiss' },
};
