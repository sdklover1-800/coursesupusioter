/**
 * Перечень типов событий телеметрии (Приложение E, FR-R.2).
 * Единый журнал EventLog: каждое событие → userId, enrollmentId?, sessionId?, cohortId?, timestamp, payload.
 */
export const EventType = {
  USER_LOGIN: 'USER_LOGIN',
  USER_LOGOUT: 'USER_LOGOUT',
  CONSENT_ACCEPTED: 'CONSENT_ACCEPTED',
  LECTURE_VIEWED: 'LECTURE_VIEWED',
  LECTURE_COMPLETED: 'LECTURE_COMPLETED',
  QUIZ_STARTED: 'QUIZ_STARTED',
  QUIZ_SUBMITTED: 'QUIZ_SUBMITTED',
  QUIZ_QUESTION_ANSWERED: 'QUIZ_QUESTION_ANSWERED',
  PRACTICAL_SESSION_STARTED: 'PRACTICAL_SESSION_STARTED',
  PRACTICAL_MESSAGE_SENT: 'PRACTICAL_MESSAGE_SENT',
  PRACTICAL_ASSESSMENT_RECORDED: 'PRACTICAL_ASSESSMENT_RECORDED',
  PRACTICAL_SESSION_RESUMED: 'PRACTICAL_SESSION_RESUMED',
  PRACTICAL_INTEGRITY_FLAG: 'PRACTICAL_INTEGRITY_FLAG',
  PRACTICAL_SESSION_VERDICT: 'PRACTICAL_SESSION_VERDICT',
  TEACHER_SESSION_LOGGED: 'TEACHER_SESSION_LOGGED',
  CERTIFICATE_ISSUED: 'CERTIFICATE_ISSUED',
  GENERATION_JOB_STARTED: 'GENERATION_JOB_STARTED',
  GENERATION_JOB_FINISHED: 'GENERATION_JOB_FINISHED',
  /** Аудит админ/менеджер действий (NFR-2.9) */
  ADMIN_ACTION: 'ADMIN_ACTION',
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

/** Виды сигналов целостности (FR-6.11) — не блокируют сдачу, сохраняются для анализа */
export const IntegrityFlagType = {
  /** Верный ответ первой же репликой */
  CORRECT_ON_FIRST_MESSAGE: 'CORRECT_ON_FIRST_MESSAGE',
  /** Аномально быстрый ввод длинного текста */
  FAST_LONG_PASTE: 'FAST_LONG_PASTE',
  /** Сообщение у верхней границы длины */
  NEAR_MAX_LENGTH: 'NEAR_MAX_LENGTH',
} as const;
export type IntegrityFlagType = (typeof IntegrityFlagType)[keyof typeof IntegrityFlagType];
