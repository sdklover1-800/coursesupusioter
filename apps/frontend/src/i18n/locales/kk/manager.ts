import type { manager as ruManager } from '../ru/manager';
import type { Loc } from '../../types';

export const manager: Loc<typeof ruManager> = {
  courses: 'Курстар', createCourse: 'Курс құру', courseTitle: 'Курс атауы',
  defaultLanguage: 'Негізгі тіл', structure: 'Құрылым', useDefault: 'Әдепкі құрылым (3 модуль × 5 дәріс)',
  modules: 'Модульдер', module: 'Модуль', lectures: 'Дәрістер', lecture: 'Дәріс',
  languageVersions: 'Тілдік нұсқалар', addLanguage: 'Тіл қосу', versionStatus: 'Нұсқа күйі',
  editor: 'Редактор', youtubeUrl: 'YouTube сілтемесі', transcript: 'Мәтіндік транскрипт',
  assessmentType: 'Бағалау түрі', quiz: 'Тест', practical: 'Практикалық',
  generateMaterials: 'Материалдарды генерациялау', generation: 'Генерация',
  generationQueued: 'Кезекте', generationRunning: 'Орындалуда', generationDone: 'Дайын', generationError: 'Қате',
  regenStrategy: 'Қайта генерациялау стратегиясы', strategyKeep: 'Түзетулерді сақтау', strategyOverwrite: 'Қайта жазу', strategyAppend: 'Қосу',
  quizEditor: 'Тест редакторы', addQuestion: 'Сұрақ қосу', questionText: 'Сұрақ мәтіні',
  options: 'Нұсқалар', correctAnswer: 'Дұрыс жауап', difficulty: 'Күрделілік',
  aiGenerated: 'ЖИ', edited: 'Түзетілген', regenerateQuestion: 'Қайта генерациялау',
  practicalEditor: 'Практикалық тапсырма редакторы', scenario: 'Сценарий (студентке көрінеді)',
  referenceSolution: 'Эталондық шешім', rubric: 'Рубрика', keyPoints: 'Негізгі тезистер',
  answerCriteria: 'Жауапқа жету критерийі', hiddenFromStudent: 'Студенттен жасырылған',
  tokenBudget: 'Токен-бюджет', maxMessages: 'Көмекші репликасының шегі', regenerate: 'Қайта генерациялау',
  publishReady: 'Жариялауға дайын', publishProblems: 'Жариялау мәселелері',
  enrollStudents: 'Студенттерді жазу', enrolled: 'Жазылғандар', preview: 'Студент көзімен қарау',
};
