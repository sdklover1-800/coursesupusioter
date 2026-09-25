/** Главная студента (StudentDashboard) и общие подписи обучения — владелец FE1. */
export const student = {
  myLearning: 'Моё обучение', progress: 'Прогресс', continueCourse: 'Продолжить', start: 'Начать',
  completed: 'Завершён', inProgress: 'В процессе', certificate: 'Сертификат',
  downloadCertificate: 'Скачать сертификат', noCourses: 'Вы пока не записаны ни на один курс',
  completePercent: '{{percent}}% пройдено',
  // Главная (screen_specs «Student dashboard»)
  pageTitle: 'Главная',
  greeting: 'Здравствуйте, {{name}}',
  resumeHeading: 'Продолжить обучение',
  /** Кнопка героя называет действие */
  cta: {
    LECTURE: 'Продолжить лекцию', LECTURE_START: 'Начать лекцию', MODULE_QUIZ: 'Перейти к тесту',
    PRACTICAL: 'Открыть практикум', CERTIFICATE: 'Получить сертификат',
  },
  resumeAt: 'Продолжить с {{time}}',
  newLecture: 'Новая лекция',
  quizMetaShort: 'Модульный тест · оценивание',
  practicalMeta: 'Итоговый практикум · {{answers}}',
  certificateMeta: 'Все требования выполнены',
  myCourses: 'Мои курсы',
  openCourse: 'Открыть курс',
  courseProgress: 'Прогресс курса: {{value}}%',
  status: {
    ACTIVE: 'В процессе', NOT_STARTED: 'Не начат', COMPLETED: 'Завершён',
    CERTIFICATE: 'Сертификат получен', UNAVAILABLE: 'Временно недоступен',
  },
  unavailableHint: 'Курс временно снят с публикации. Прогресс сохранён.',
  emptyHint: 'Выберите курс в каталоге и подайте заявку — доступ откроется после одобрения.',
  openCatalog: 'Открыть каталог',
  requestsTitle: 'Мои заявки',
  /** Ошибки API для студента — только локализованный текст (сервер пишет по-русски) */
  errors: {
    invalid: 'Запрос не принят. Обновите страницу и попробуйте ещё раз.',
    conflict: 'Данные уже изменились — обновите страницу.',
    tooMany: 'Слишком много запросов. Подождите минуту и попробуйте снова.',
  },
  /** Экран вместо материала курса, когда его не удалось открыть */
  contentError: {
    forbiddenTitle: 'Материал недоступен',
    forbiddenText: 'Он не входит в вашу версию курса или курс временно закрыт. Откройте курс из раздела «Мои курсы».',
    notFoundTitle: 'Материал не найден',
    notFoundText: 'Возможно, ссылка устарела. Откройте курс из раздела «Мои курсы».',
    genericTitle: 'Не удалось открыть материал',
    genericText: 'Проверьте соединение и попробуйте ещё раз.',
  },
};
