import type { student as ruStudent } from '../ru/student';
import type { Loc } from '../../types';

/** Студенттің басты беті (StudentDashboard) және оқудың ортақ жазулары. */
export const student: Loc<typeof ruStudent> = {
  myLearning: 'Менің оқуым', progress: 'Барыс', continueCourse: 'Жалғастыру', start: 'Бастау',
  completed: 'Аяқталды', inProgress: 'Орындалуда', certificate: 'Сертификат',
  downloadCertificate: 'Сертификатты жүктеу', noCourses: 'Сіз әзірге ешбір курсқа жазылмағансыз',
  completePercent: '{{percent}}% өтілді',
  pageTitle: 'Басты бет',
  greeting: 'Сәлеметсіз бе, {{name}}',
  resumeHeading: 'Оқуды жалғастыру',
  cta: {
    LECTURE: 'Дәрісті жалғастыру', LECTURE_START: 'Дәрісті бастау', MODULE_QUIZ: 'Тестке өту',
    PRACTICAL: 'Практикумды ашу', CERTIFICATE: 'Сертификатты алу',
  },
  resumeAt: '{{time}} сәтінен жалғастыру',
  newLecture: 'Жаңа дәріс',
  quizMetaShort: 'Модуль тесті · бағалау',
  practicalMeta: 'Қорытынды практикум · {{answers}}',
  certificateMeta: 'Барлық талап орындалды',
  myCourses: 'Менің курстарым',
  openCourse: 'Курсты ашу',
  courseProgress: 'Курс барысы: {{value}}%',
  status: {
    ACTIVE: 'Орындалуда', NOT_STARTED: 'Басталмаған', COMPLETED: 'Аяқталды',
    CERTIFICATE: 'Сертификат алынды', UNAVAILABLE: 'Уақытша қолжетімсіз',
  },
  unavailableHint: 'Курс жариялаудан уақытша алынды. Барысыңыз сақталған.',
  emptyHint: 'Каталогтан курс таңдап, өтінім беріңіз — қолжетімділік мақұлданғаннан кейін ашылады.',
  openCatalog: 'Каталогты ашу',
  requestsTitle: 'Менің өтінімдерім',
  errors: {
    invalid: 'Сұрау қабылданбады. Бетті жаңартып, қайталап көріңіз.',
    conflict: 'Деректер өзгеріп қойған — бетті жаңартыңыз.',
    tooMany: 'Сұраулар тым көп. Бір минут күтіп, қайталап көріңіз.',
  },
  contentError: {
    forbiddenTitle: 'Материал қолжетімсіз',
    forbiddenText: 'Ол сіздің курс нұсқаңызға кірмейді немесе курс уақытша жабық. Курсты «Менің курстарым» бөлімінен ашыңыз.',
    notFoundTitle: 'Материал табылмады',
    notFoundText: 'Сілтеме ескірген болуы мүмкін. Курсты «Менің курстарым» бөлімінен ашыңыз.',
    genericTitle: 'Материалды ашу мүмкін болмады',
    genericText: 'Байланысты тексеріп, қайталап көріңіз.',
  },
};
