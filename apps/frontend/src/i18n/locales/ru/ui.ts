/** Примитивы дизайн-системы Inquiry 2.0 (components/primitives) — владелец FE0. */
export const ui = {
  // Язык режимов (design_direction §8): одинаковые подписи во всех экранах
  mode: {
    practice: 'Тренировка', graded: 'Оценивание',
    practiceLong: 'не влияет на результат',
    practiceHint: 'Тренировка не влияет на результат',
    gradedHint: 'Засчитывается в итоговую оценку',
  },
  state: {
    NOT_STARTED: 'Не начато', IN_PROGRESS: 'В процессе', DONE: 'Пройдено', PASSED: 'Сдано',
    FAILED: 'Не сдано', LOCKED: 'Недоступно', NEXT: 'Далее',
  },
  kind: {
    LECTURE: 'Лекция', MINI_QUIZ: 'Мини-квиз', MODULE_QUIZ: 'Модульный тест', PRACTICAL: 'Итоговый практикум',
    FINAL_MINI_QUIZ: 'Итоговый мини-квиз', CERTIFICATE: 'Сертификат',
  },
  next: 'Далее', done: 'Пройдено', current: 'Сейчас',
  progress: 'Прогресс', progressValue: 'Прогресс: {{value}}%',
  seekTo: 'Перейти к {{time}}',
  // InquiryMeter — бюджет ответов тьютора
  meter: {
    label: 'Оставшиеся ответы тьютора',
    remaining_one: 'Остался {{count}} из {{max}}', remaining_few: 'Осталось {{count}} из {{max}}',
    remaining_many: 'Осталось {{count}} из {{max}}', remaining_other: 'Осталось {{count}} из {{max}}',
    low: 'Ответов тьютора осталось мало — пора формулировать вывод',
    last: 'Остался последний ответ тьютора',
    none: 'Ответы тьютора закончились',
  },
  rubric: {
    methodicalness: 'Методичность', question_quality: 'Качество вопросов',
    logical_progression: 'Логичность', self_correction: 'Самокоррекция',
    score: '{{score}} из {{max}}',
  },
  breadcrumb: 'Навигационная цепочка', backTo: 'Назад: {{label}}',
  dialog: { close: 'Закрыть', cancel: 'Отмена', confirm: 'Подтвердить' },
  // Жалоба на контент: единственный ответ после отправки — «Спасибо…» (ничего не раскрывает)
  issue: {
    report: 'Сообщить об ошибке',
    hint: 'Сообщение получат авторы курса. Ответ на него не приходит.',
    reasonLabel: 'Что не так?',
    comment: 'Комментарий', commentPlaceholder: 'Необязательно: уточните, что именно не так',
    send: 'Отправить', sent: 'Спасибо, сообщение отправлено',
    failed: 'Не удалось отправить сообщение. Попробуйте позже.',
    tooMany: 'Слишком много сообщений за сегодня. Попробуйте завтра.',
    reasons: {
      NO_CORRECT: 'Нет правильного ответа', TWO_CORRECT: 'Несколько правильных ответов',
      UNCLEAR: 'Непонятная формулировка', TRANSLATION: 'Ошибка перевода', FACT_ERROR: 'Фактическая ошибка',
      GIVES_ANSWER: 'Тьютор дал готовый ответ', TRANSCRIPT_ERROR: 'Ошибка в расшифровке',
      VIDEO: 'Проблема с видео', OTHER: 'Другое',
    },
  },
  toast: { dismiss: 'Скрыть' },
};
