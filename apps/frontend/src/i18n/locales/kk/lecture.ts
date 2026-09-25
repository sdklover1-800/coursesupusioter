import type { lecture as ruLecture } from '../ru/lecture';
import type { Loc } from '../../types';

export const lecture: Loc<typeof ruLecture> = {
  transcript: 'Транскрипт', contents: 'Мазмұны', markComplete: 'Өтілді деп белгілеу', completed: 'Өтілді',
  watch: 'Көру', noVideo: 'Бейне қосылмаған', videoPending: 'Бейне кейінірек қосылады', videoPendingHint: 'Төмендегі транскрипт қолжетімді — оқу үшін жеткілікті.',

  lectureN: '{{n}}-дәріс',
  lectureOf: 'Дәріс {{n}} / {{total}}',
  moduleN: '{{roman}} модуль',
  crumbShort: '{{roman}} модуль · {{n}}-дәріс',
  sectionN: '{{n}}-бөлік',

  target: {
    lecture: '{{n}}-дәріс', miniQuiz: 'мини-квиз', moduleQuiz: '{{roman}} модуль тесті', practical: 'қорытынды практикум',
    finalMiniQuiz: 'қорытынды мини-квиз', certificate: 'сертификат', course: 'курс мазмұны',
  },
  nextLabel: 'Келесі: {{target}}',
  prevLabel: 'Артқа: {{target}}',
  toCourse: 'Курсқа оралу',

  markDone: 'Өтілді деп белгілеу', done: 'Өтілді', doneAria: 'Дәріс өтілді',
  doneToast: 'Дәріс өтілді деп белгіленді',
  doneFailed: 'Дәрісті белгілеу мүмкін болмады. Қайталап көріңіз.',

  // «Бөлік», а не «Бөлім»: «I бөлім» уже называет модуль в контенте
  chapterWord: 'Бөлік',
  chapter: 'Бөлік {{k}}/{{n}}',
  sections: 'Дәріс бөліктері',
  chapterStrip: 'Бейне бөліктері',

  resume: '{{time}} сәтінен жалғастырамыз', fromStart: 'Басынан',
  meta: { video: 'Бейне {{duration}}', reading: 'конспектіні оқу ≈ {{min}} мин' },
  contract: 'Дәріс есептелуі үшін бейнені көріңіз немесе конспектіні оқыңыз да, «Өтілді» деп белгілеңіз',
  contractDone: 'Дәріс өтілді және курс үлгеріміне есептелді',
  contractReading: 'Дәріс есептелуі үшін конспектіні оқыңыз да, «Өтілді» деп белгілеңіз',

  tabs: { label: 'Дәріс материалдары', transcript: 'Конспект', summary: 'Қысқаша', terms: 'Терминдер', miniQuiz: 'Мини-квиз' },

  readingMode: 'Бейне кейінірек қосылады — дәрісті оқу режимінде өтуге болады',
  videoError: 'Бейне жүктелмеді. Байланысты тексеріңіз — конспект төменде қолжетімді.',
  player: 'Бейнедәріс', navBar: 'Дәріс бойынша навигация',

  outline: {
    title: 'Курс мазмұны', open: 'Мазмұны', collapse: 'Мазмұнды жасыру', expand: 'Мазмұнды көрсету',
    prevModule: 'Алдыңғы модуль', nextModule: 'Келесі модуль', modules: 'Курс модульдері', allModules: 'Барлық модульдер',
    lecturesDone: 'Дәрістер: {{done}}/{{total}}',
    moduleQuizN: '{{roman}} модуль тесті',
    moduleQuiz: 'Модуль тесті', practical: 'Қорытынды практикум', miniQuiz: 'Мини-квиз',
  },
  questions_one: '{{count}} сұрақ', questions_other: '{{count}} сұрақ',

  end: {
    heading: 'Енді өзіңізді тексеріңіз', headingNoQuiz: 'Бейне соңына дейін көрілді',
    miniQuiz: 'Мини-квиз · {{questions}} · жаттығу',
    nextLecture: 'Келесі дәріс: {{title}}', next: 'Келесі: {{title}}',
    replay: 'Қайта көру', close: 'Жабу',
  },
  dock: { label: 'Шағын ойнатқыш', toVideo: 'Бейнеге оралу', close: 'Шағын ойнатқышты жабу' },

  search: {
    label: 'Конспектіден іздеу', placeholder: 'Конспектіден іздеу', count: '{{current}} / {{total}}', none: 'Табылмады',
    prev: 'Алдыңғы сәйкестік', next: 'Келесі сәйкестік', clear: 'Іздеуді тазарту',
  },
  follow: 'Бейнеге ілесу', backToCurrent: 'Ағымдағы орынға оралу', now: 'Қазір',
  toc: 'Дәріс мазмұны', tocShow: 'Дәріс мазмұнын көрсету', tocHide: 'Дәріс мазмұнын жасыру',
  minimap: 'Конспект картасы',
  appendix: {
    materials: 'Дәріске арналған материалдар', terms: 'Негізгі ұғымдар', reading: 'Әдебиет', questions: 'Өзін-өзі тексеру сұрақтары',
    assignment: 'Практикалық тапсырма', other: 'Қосымша',
  },
  terms: {
    intro: 'Осы дәрістің негізгі ұғымдары. «Конспектіден табу» олар айтылатын жерді белгілейді.',
    find: 'Конспектіден табу', mentions_one: 'конспектіде {{count}} рет', mentions_other: 'конспектіде {{count}} рет',
    noMentions: 'Конспект мәтінінде сөзбе-сөз кездеспейді',
  },
  summaryTitle: 'Дәріс туралы қысқаша',
  noMiniQuiz: 'Бұл дәрісте әзірге мини-квиз жоқ.',

  keys: {
    title: 'Жылдам пернелер', open: 'Жылдам пернелер',
    playPause: 'Ойнату / кідірту', back10: '10 секунд артқа', fwd10: '10 секунд алға',
    search: 'Конспектіден іздеу', next: 'Келесі қадам', help: 'Осы анықтама',
    note: 'Курсор енгізу өрісінде тұрғанда пернелер жұмыс істемейді.',
  },
};
