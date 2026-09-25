import type { issues as ruIssues } from '../ru/issues';
import type { Loc } from '../../types';

/** Content issue inbox and expert review (FE5 §4). */
export const issues: Loc<typeof ruIssues> = {
  title: 'Content issues',
  subtitle: 'Student reports and expert-review flags on questions, lectures and tasks.',
  subtitleCounts: 'Open: {{open}}, of which in expert review: {{system}}.',
  statusFilter: 'Status', originFilter: 'Origin', courseFilter: 'Course', languageFilter: 'Language', targetFilter: 'Item',
  statusTab: { OPEN: 'Open', RESOLVED: 'Resolved', DISMISSED: 'Dismissed', ALL: 'All' },
  status: { OPEN: 'Open', RESOLVED: 'Resolved', DISMISSED: 'Dismissed' },
  originAll: 'All',
  origin: { STUDENT: 'From students', SYSTEM: 'Expert review', MIXED: 'Students and expert review' },
  allCourses: 'All courses', allLanguages: 'All languages', allTargets: 'All items',
  target: { QUIZ_QUESTION: 'Quiz question', LECTURE: 'Lecture', PRACTICAL_TASK: 'Practical task', CHAT_MESSAGE: 'Practical message' },
  reason: { EXPERT_REVIEW: 'Expert review', NATIVE_PROOFREAD: 'Native-speaker proofreading', FACT_CHECK: 'Fact check' },
  context: {
    PRACTICE: 'practice', REVIEW: 'review', OFFICIAL: 'official attempt', PRACTICAL: 'practical',
    LECTURE: 'lecture', CONTENT_PIPELINE: 'content script',
  },
  reporters_one: 'reported by {{count}} student', reporters_other: 'reported by {{count}} students',
  key: 'key', roleTutor: 'Tutor message', roleStudent: 'Student message',
  lectureN: 'Lecture {{n}}. {{title}}',
  previewMissing: 'The item was deleted or is unavailable.',
  openEditor: 'Open in editor', noEditor: 'Chat messages aren’t edited — act on the task instead.',
  resolve: 'Resolved', dismiss: 'Dismiss', reopen: 'Reopen', resolveSelected: 'Mark as resolved',
  selectAll: 'Select all on this page', selectRow: 'Select report', clearSelection: 'Clear selection',
  selected_one: '{{count}} group selected ({{issues}} reports)', selected_other: '{{count}} groups selected ({{issues}} reports)',
  loadMore: 'Show more',
  emptyOpen: 'No open reports', emptyOpenSystem: 'Everything is expert-reviewed', empty: 'No reports',
  emptyHint: 'When students report a problem or a content script flags material for review, it appears here.',
  noteLabel: 'Note (optional)', noteHint: 'Visible to staff and in the audit log; not sent to the student.',
  confirm: {
    RESOLVED: {
      title_one: 'Mark {{count}} report as resolved?', title_other: 'Mark {{count}} reports as resolved?',
      body: 'The reports leave the open list; the action is logged in the audit trail. No reply is sent to students.',
      action: 'Mark as resolved',
    },
    DISMISSED: {
      title_one: 'Dismiss {{count}} report?', title_other: 'Dismiss {{count}} reports?',
      body: 'Use this when there is no error. The action is logged in the audit trail; you can reopen later.',
      action: 'Dismiss',
    },
    OPEN: {
      title_one: 'Reopen {{count}} report?', title_other: 'Reopen {{count}} reports?',
      body: 'The reports become open again and count towards the navigation badge.',
      action: 'Reopen',
    },
  },
  done: {
    RESOLVED_one: 'Resolved: {{count}}', RESOLVED_other: 'Resolved: {{count}}',
    DISMISSED_one: 'Dismissed: {{count}}', DISMISSED_other: 'Dismissed: {{count}}',
    OPEN_one: 'Reopened: {{count}}', OPEN_other: 'Reopened: {{count}}',
  },
};
