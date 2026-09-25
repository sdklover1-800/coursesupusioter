import type { ui as ruUi } from '../ru/ui';
import type { Loc } from '../../types';

/** Inquiry 2.0 дизайн-жүйесінің примитивтері — иесі FE0. */
export const ui: Loc<typeof ruUi> = {
  mode: {
    practice: 'Жаттығу', graded: 'Бағалау',
    practiceLong: 'нәтижеге әсер етпейді',
    practiceHint: 'Жаттығу нәтижеге әсер етпейді',
    gradedHint: 'Қорытынды бағаға есептеледі',
  },
  state: {
    NOT_STARTED: 'Басталмаған', IN_PROGRESS: 'Орындалуда', DONE: 'Өтілді', PASSED: 'Тапсырылды',
    FAILED: 'Тапсырылмады', LOCKED: 'Қолжетімсіз', NEXT: 'Келесі',
  },
  kind: {
    LECTURE: 'Дәріс', MINI_QUIZ: 'Мини-квиз', MODULE_QUIZ: 'Модуль тесті', PRACTICAL: 'Қорытынды практикум',
    FINAL_MINI_QUIZ: 'Қорытынды мини-квиз', CERTIFICATE: 'Сертификат',
  },
  next: 'Келесі', done: 'Өтілді', current: 'Қазір',
  progress: 'Үлгерім', progressValue: 'Үлгерім: {{value}}%',
  seekTo: '{{time}} сәтіне өту',
  meter: {
    label: 'Тьютордың қалған жауаптары',
    remaining_one: 'Қалды: {{count}} / {{max}}', remaining_other: 'Қалды: {{count}} / {{max}}',
    low: 'Тьютор жауаптары аз қалды — қорытынды жасайтын уақыт келді',
    last: 'Тьютордың соңғы жауабы қалды',
    none: 'Тьютор жауаптары таусылды',
  },
  rubric: {
    methodicalness: 'Әдістілік', question_quality: 'Сұрақ сапасы',
    logical_progression: 'Логикалық бірізділік', self_correction: 'Өзін-өзі түзету',
    score: '{{max}} ішінен {{score}}',
  },
  breadcrumb: 'Навигация тізбегі', backTo: 'Артқа: {{label}}',
  dialog: { close: 'Жабу', cancel: 'Болдырмау', confirm: 'Растау' },
  issue: {
    report: 'Қате туралы хабарлау',
    hint: 'Хабарламаны курс авторлары алады. Оған жауап келмейді.',
    reasonLabel: 'Не дұрыс емес?',
    comment: 'Түсініктеме', commentPlaceholder: 'Міндетті емес: нақты не дұрыс емес екенін жазыңыз',
    send: 'Жіберу', sent: 'Рақмет, хабарлама жіберілді',
    failed: 'Хабарламаны жіберу мүмкін болмады. Кейінірек қайталап көріңіз.',
    tooMany: 'Бүгін хабарлама тым көп. Ертең қайталап көріңіз.',
    reasons: {
      NO_CORRECT: 'Дұрыс жауап жоқ', TWO_CORRECT: 'Бірнеше дұрыс жауап бар',
      UNCLEAR: 'Тұжырымы түсініксіз', TRANSLATION: 'Аударма қатесі', FACT_ERROR: 'Фактілік қате',
      GIVES_ANSWER: 'Тьютор дайын жауап берді', TRANSCRIPT_ERROR: 'Транскриптегі қате',
      VIDEO: 'Бейнеге қатысты мәселе', OTHER: 'Басқа',
    },
  },
  toast: { dismiss: 'Жасыру' },
};
