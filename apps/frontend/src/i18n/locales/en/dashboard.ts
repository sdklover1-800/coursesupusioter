import type { dashboard as ruDashboard } from '../ru/dashboard';
import type { Loc } from '../../types';

export const dashboard: Loc<typeof ruDashboard> = {
  overview: 'System overview', students: 'Students', courses: 'Courses', enrollments: 'Enrollments',
  completionRate: 'Completion rate', avgProgress: 'Avg progress', certificates: 'Certificates',
  avgScore: 'Avg score', hardQuestions: 'Hard questions', errorRate: 'Error rate',
  practicalStats: 'Practical tasks', passRate: 'Pass rate', avgTokens: 'Avg tokens',
  avgMessages: 'Avg replies', rubricAverages: 'Rubric averages', criticalThinking: 'Critical thinking',
  cohortComparison: 'Cohort comparison', teacherSessionsCount: 'Teacher sessions', noData: 'No data', perStudent: 'Per student', estCost: 'Est. cost', duration: 'Days to complete', student: 'Student',
};
