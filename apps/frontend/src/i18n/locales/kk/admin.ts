import type { admin as ruAdmin } from '../ru/admin';
import type { Loc } from '../../types';

export const admin: Loc<typeof ruAdmin> = {
  users: 'Пайдаланушылар', createUser: 'Пайдаланушы құру', name: 'Аты', role: 'Рөл',
  cohort: 'Когорта', interfaceLanguage: 'Интерфейс тілі', import: 'Студенттерді импорттау',
  importFile: 'CSV немесе Excel файлы', importPreview: 'Алдын ала қарау', importApply: 'Импортты қолдану',
  importReport: 'Импорт есебі', rowsValid: 'Жарамды жолдар', rowsInvalid: 'Қателермен',
  startPassword: 'Бастапқы құпия сөз', startPasswordNote: 'Көшіріп алыңыз — бір рет қана көрсетіледі',
  resetPassword: 'Құпия сөзді қалпына келтіру', cohorts: 'Когорталар', createCohort: 'Когорта құру',
  condition: 'Эксперимент шарты', teacherSessions: 'Мұғаліммен сабақтар',
  logTeacherSession: 'Сабақты тіркеу', topic: 'Тақырып', date: 'Күні',
  export: 'Деректерді экспорттау', exportEvents: 'Оқиғалар', exportSessions: 'Сессиялар',
  exportRubric: 'Рубрика бағалары', exportQuiz: 'Тест әрекеттері', exportCohorts: 'Когорталар жиынтығы',
  audit: 'Әрекеттер аудиті', actor: 'Кім', action: 'Әрекет', when: 'Қашан',
};
