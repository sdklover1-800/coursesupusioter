import type { issues as ruIssues } from '../ru/issues';
import type { Loc } from '../../types';

/** Контенттегі қателер туралы кіріс хабарламалар және сараптамалық тексеру (FE5 §4). */
export const issues: Loc<typeof ruIssues> = {
  title: 'Контенттегі қателер',
  subtitle: 'Сұрақтар, дәрістер мен тапсырмалар бойынша студенттердің хабарламалары және сараптамалық тексеру белгілері.',
  subtitleCounts: 'Ашық: {{open}}, оның ішінде сараптамалық тексеруде: {{system}}.',
  statusFilter: 'Күйі', originFilter: 'Шығу тегі', courseFilter: 'Курс', languageFilter: 'Тіл', targetFilter: 'Нысан',
  statusTab: { OPEN: 'Ашық', RESOLVED: 'Шешілген', DISMISSED: 'Қабылданбаған', ALL: 'Барлығы' },
  status: { OPEN: 'Ашық', RESOLVED: 'Шешілді', DISMISSED: 'Қабылданбады' },
  originAll: 'Барлығы',
  origin: { STUDENT: 'Студенттерден', SYSTEM: 'Сараптамалық тексеру', MIXED: 'Студенттер және сараптамалық тексеру' },
  allCourses: 'Барлық курс', allLanguages: 'Барлық тіл', allTargets: 'Барлық нысан',
  target: { QUIZ_QUESTION: 'Тест сұрағы', LECTURE: 'Дәріс', PRACTICAL_TASK: 'Практикалық тапсырма', CHAT_MESSAGE: 'Практикумдағы сөз' },
  reason: { EXPERT_REVIEW: 'Сараптамалық тексеру', NATIVE_PROOFREAD: 'Тіл иесінің оқып шығуы', FACT_CHECK: 'Фактілерді тексеру' },
  context: {
    PRACTICE: 'жаттығу', REVIEW: 'талдау', OFFICIAL: 'ресми әрекет', PRACTICAL: 'практикум',
    LECTURE: 'дәріс', CONTENT_PIPELINE: 'контент-скрипт',
  },
  reporters_one: '{{count}} студент хабарлады', reporters_other: '{{count}} студент хабарлады',
  key: 'кілт', roleTutor: 'Тьютордың сөзі', roleStudent: 'Студенттің сөзі',
  lectureN: '{{n}}-дәріс. {{title}}',
  previewMissing: 'Нысан жойылған немесе қолжетімсіз.',
  openEditor: 'Редакторда ашу', noEditor: 'Чат сөзі өңделмейді — шараны тапсырмада қолданыңыз.',
  resolve: 'Шешілді', dismiss: 'Қабылдамау', reopen: 'Қайта жұмысқа алу', resolveSelected: 'Шешілді деп белгілеу',
  selectAll: 'Беттегінің барлығын таңдау', selectRow: 'Хабарламаны таңдау', clearSelection: 'Таңдауды тазарту',
  selected_one: '{{count}} топ таңдалды ({{issues}} хабарлама)', selected_other: '{{count}} топ таңдалды ({{issues}} хабарлама)',
  loadMore: 'Тағы көрсету',
  emptyOpen: 'Ашық хабарламалар жоқ', emptyOpenSystem: 'Барлығын сарапшы тексерді', empty: 'Хабарламалар жоқ',
  emptyHint: 'Студенттер қате туралы хабарлағанда немесе контент-скрипт материалдарды тексеруге белгілегенде, олар осында пайда болады.',
  noteLabel: 'Ескертпе (міндетті емес)', noteHint: 'Қызметкерлерге және аудит журналында көрінеді; студентке жіберілмейді.',
  confirm: {
    RESOLVED: {
      title_one: '{{count}} хабарламаны шешілді деп белгілеу керек пе?', title_other: '{{count}} хабарламаны шешілді деп белгілеу керек пе?',
      body: 'Хабарламалар ашықтардан кетеді; әрекет аудит журналында тіркеледі. Студентке жауап жіберілмейді.',
      action: 'Шешілді деп белгілеу',
    },
    DISMISSED: {
      title_one: '{{count}} хабарламаны қабылдамау керек пе?', title_other: '{{count}} хабарламаны қабылдамау керек пе?',
      body: 'Қате болмаса пайдаланыңыз. Әрекет аудит журналында тіркеледі; кейін қайта жұмысқа алуға болады.',
      action: 'Қабылдамау',
    },
    OPEN: {
      title_one: '{{count}} хабарламаны қайта жұмысқа алу керек пе?', title_other: '{{count}} хабарламаны қайта жұмысқа алу керек пе?',
      body: 'Хабарламалар қайта ашылып, навигация санауышында пайда болады.',
      action: 'Қайта жұмысқа алу',
    },
  },
  done: {
    RESOLVED_one: 'Шешілді: {{count}}', RESOLVED_other: 'Шешілді: {{count}}',
    DISMISSED_one: 'Қабылданбады: {{count}}', DISMISSED_other: 'Қабылданбады: {{count}}',
    OPEN_one: 'Қайта жұмысқа алынды: {{count}}', OPEN_other: 'Қайта жұмысқа алынды: {{count}}',
  },
};
