import type { admin as ruAdmin } from '../ru/admin';
import type { Loc } from '../../types';

export const admin: Loc<typeof ruAdmin> = {
  users: 'Users', createUser: 'Create user', name: 'Name', role: 'Role',
  cohort: 'Cohort', interfaceLanguage: 'Interface language', import: 'Import students',
  importFile: 'CSV or Excel file', importPreview: 'Preview', importApply: 'Apply import',
  importReport: 'Import report', rowsValid: 'Valid rows', rowsInvalid: 'With errors',
  startPassword: 'Start password', startPasswordNote: 'Copy it — shown only once',
  resetPassword: 'Reset password', cohorts: 'Cohorts', createCohort: 'Create cohort',
  condition: 'Experiment condition', teacherSessions: 'Teacher sessions',
  logTeacherSession: 'Log a session', topic: 'Topic', date: 'Date',
  export: 'Data export', exportEvents: 'Events', exportSessions: 'Sessions',
  exportRubric: 'Rubric scores', exportQuiz: 'Quiz attempts', exportCohorts: 'Cohort summary',
  audit: 'Action audit', actor: 'Actor', action: 'Action', when: 'When',
};
