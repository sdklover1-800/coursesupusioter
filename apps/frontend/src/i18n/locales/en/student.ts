import type { student as ruStudent } from '../ru/student';
import type { Loc } from '../../types';

/** Student home (StudentDashboard) and shared learning labels. */
export const student: Loc<typeof ruStudent> = {
  myLearning: 'My learning', progress: 'Progress', continueCourse: 'Continue', start: 'Start',
  completed: 'Completed', inProgress: 'In progress', certificate: 'Certificate',
  downloadCertificate: 'Download certificate', noCourses: 'You are not enrolled in any course yet',
  completePercent: '{{percent}}% complete',
  pageTitle: 'Home',
  greeting: 'Hello, {{name}}',
  resumeHeading: 'Continue learning',
  cta: {
    LECTURE: 'Continue the lecture', LECTURE_START: 'Start the lecture', MODULE_QUIZ: 'Go to the test',
    PRACTICAL: 'Open the practical', CERTIFICATE: 'Get the certificate',
  },
  resumeAt: 'Resume at {{time}}',
  newLecture: 'New lecture',
  quizMetaShort: 'Module test · graded',
  practicalMeta: 'Final practical · {{answers}}',
  certificateMeta: 'All requirements met',
  myCourses: 'My courses',
  openCourse: 'Open the course',
  courseProgress: 'Course progress: {{value}}%',
  status: {
    ACTIVE: 'In progress', NOT_STARTED: 'Not started', COMPLETED: 'Completed',
    CERTIFICATE: 'Certificate earned', UNAVAILABLE: 'Temporarily unavailable',
  },
  unavailableHint: 'The course is temporarily unpublished. Your progress is saved.',
  emptyHint: 'Pick a course in the catalog and apply — access opens once your request is approved.',
  openCatalog: 'Open the catalog',
  requestsTitle: 'My requests',
};
