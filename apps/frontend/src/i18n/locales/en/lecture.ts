import type { lecture as ruLecture } from '../ru/lecture';
import type { Loc } from '../../types';

export const lecture: Loc<typeof ruLecture> = {
  transcript: 'Transcript', contents: 'Contents', markComplete: 'Mark as complete', completed: 'Completed',
  watch: 'Watch', noVideo: 'No video set', videoPending: 'Video will be added later', videoPendingHint: 'The transcript below is available and sufficient to study.',

  lectureN: 'Lecture {{n}}',
  lectureOf: 'Lecture {{n}} of {{total}}',
  moduleN: 'Module {{roman}}',
  crumbShort: 'Module {{roman}} · Lecture {{n}}',
  sectionN: 'Section {{n}}',

  target: {
    lecture: 'Lecture {{n}}', miniQuiz: 'Mini-quiz', moduleQuiz: 'Module test {{roman}}', practical: 'Final practical',
    finalMiniQuiz: 'Final mini-quiz', certificate: 'Certificate', course: 'Course contents',
  },
  nextLabel: 'Next: {{target}}',
  prevLabel: 'Back: {{target}}',
  toCourse: 'To the course',

  markDone: 'Mark as complete', done: 'Completed', doneAria: 'Lecture completed',
  doneToast: 'Lecture marked as complete',
  doneFailed: 'Could not mark the lecture. Please try again.',

  chapterWord: 'Section',
  chapter: 'Section {{k}}/{{n}}',
  sections: 'Lecture sections',
  chapterStrip: 'Video sections',

  resume: 'Resuming from {{time}}', fromStart: 'From the start',
  meta: { video: 'Video {{duration}}', reading: 'notes ≈ {{min}} min read' },
  contract: 'For the lecture to count: watch the video or read the notes, then mark it “Completed”',
  contractDone: 'Lecture completed and counted towards your course progress',

  tabs: { label: 'Lecture materials', transcript: 'Notes', summary: 'Summary', terms: 'Terms', miniQuiz: 'Mini-quiz' },

  readingMode: 'The video will be added later — the lecture is available in reading mode',
  videoError: 'The video did not load. Check your connection — the notes are available below.',
  player: 'Video lecture',

  outline: {
    title: 'Course contents', open: 'Contents', collapse: 'Hide contents', expand: 'Show contents',
    prevModule: 'Previous module', nextModule: 'Next module', modules: 'Course modules', allModules: 'All modules',
    lecturesDone: 'Lectures: {{done}} of {{total}}',
    moduleQuiz: 'Module test', practical: 'Final practical', miniQuiz: 'Mini-quiz',
  },
  questions_one: '{{count}} question', questions_other: '{{count}} questions',

  end: {
    heading: 'Next — check yourself', headingNoQuiz: 'Video finished',
    miniQuiz: 'Mini-quiz · {{questions}} · practice',
    nextLecture: 'Next lecture: {{title}}', next: 'Next: {{title}}',
    replay: 'Watch again', close: 'Close',
  },
  dock: { label: 'Mini player', toVideo: 'Back to video', close: 'Close mini player' },

  search: {
    label: 'Search the notes', placeholder: 'Search the notes', count: '{{current}} of {{total}}', none: 'No matches',
    prev: 'Previous match', next: 'Next match', clear: 'Clear search',
  },
  follow: 'Follow the video', backToCurrent: 'Back to the current spot', now: 'Now',
  toc: 'Lecture contents', tocShow: 'Show lecture contents', tocHide: 'Hide lecture contents',
  minimap: 'Notes map',
  appendix: {
    materials: 'Lecture materials', terms: 'Key concepts', reading: 'Reading', questions: 'Self-check questions',
    assignment: 'Practical assignment', other: 'More',
  },
  terms: {
    intro: 'Key concepts of this lecture. “Find in notes” highlights where they are discussed.',
    find: 'Find in notes', mentions_one: '{{count}} mention', mentions_other: '{{count}} mentions',
    noMentions: 'Not found verbatim in the notes',
  },
  summaryTitle: 'Lecture summary',
  noMiniQuiz: 'This lecture has no mini-quiz yet.',

  keys: {
    title: 'Keyboard shortcuts', open: 'Keyboard shortcuts',
    playPause: 'Play / pause', back10: 'Back 10 seconds', fwd10: 'Forward 10 seconds',
    search: 'Search the notes', next: 'Next step', help: 'This help',
    note: 'Keys do nothing while the cursor is in a text field.',
  },
};
