import type { dashboard as ruDashboard } from '../ru/dashboard';
import type { Loc } from '../../types';

export const dashboard: Loc<typeof ruDashboard> = {
  overview: 'Жүйе шолуы', students: 'Студенттер', courses: 'Курстар', enrollments: 'Жазылулар',
  completionRate: 'Аяқтау үлесі', avgProgress: 'Орташа үлгерім', certificates: 'Сертификаттар',
  avgScore: 'Орташа балл', hardQuestions: 'Күрделі сұрақтар', errorRate: 'Қате үлесі',
  practicalStats: 'Практикалық тапсырмалар', passRate: 'Тапсыру үлесі', avgTokens: 'Орт. токен',
  avgMessages: 'Орт. реплика', rubricAverages: 'Рубрика бойынша орташа', criticalThinking: 'Сыни ойлау',
  cohortComparison: 'Когорталарды салыстыру', teacherSessionsCount: 'Мұғаліммен сабақтар', noData: 'Дерек жоқ', perStudent: 'Студенттер бойынша', estCost: 'Болжамды құны', duration: 'Курсқа күн', student: 'Студент',
};
