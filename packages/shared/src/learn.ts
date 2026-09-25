import type {
  AssessmentType,
  ContentIssueTarget,
  EnrollmentStatus,
  Language,
  PublishStatus,
  QuestionType,
  QuizKind,
  SessionStatus,
  VerdictCode,
} from './enums.js';

/**
 * Контракт API для всего студенческого UI (обучение, тесты, практикум, жалобы,
 * проверка сертификата) + чистые правила попыток, общие для backend и frontend.
 * Даты приходят строками ISO (JSON). Правила — без Prisma: принимают Date или ISO.
 */

/* ── Карта курса и прогресс ─────────────────────────────────────────── */

/** Вид элемента учебного пути. */
export type LearnItemKind = 'LECTURE' | 'MINI_QUIZ' | 'MODULE_QUIZ' | 'PRACTICAL' | 'FINAL_MINI_QUIZ' | 'CERTIFICATE';
/** Состояние элемента на карте курса. */
export type ItemState = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'PASSED' | 'FAILED' | 'LOCKED';
/** Политика показа разбора попытки (см. QuizReviewPolicy в enums). */
export type ReviewPolicy = 'FULL_AFTER_FINAL' | 'SCORE_UNTIL_FINAL' | 'SCORE_ONLY';
/** Какая попытка идёт в зачёт (см. QuizScoringRule в enums). */
export type ScoringRule = 'BEST' | 'FIRST';
/** Что заблокировало смену языка курса (USER_DECISIONS §3). */
export type LanguageLockReason = 'GRADED_QUIZ' | 'PRACTICAL_REPLY';
/** Условие выдачи сертификата (env CERT_RULE). */
export type CertificateRule = 'PASS_ALL' | 'COMPLETE_ALL';
/** Только окно доступности практикума: порядок изучения свободный (USER_DECISIONS §3). */
export interface LockInfo {
  code: 'NOT_YET_AVAILABLE' | 'CLOSED';
  until: string | null;
}
/** Лекция на карте курса. */
export interface LearnLecture {
  id: string;
  title: string;
  orderIndex: number;
  lectureNumber: number;
  youtubeVideoId: string;
  durationSec: number | null;
  summary: string | null;
  completed: boolean;
  positionSec: number;
  watchedPercent: number;
  miniQuizId: string | null;
  miniQuestionCount: number;
}
/** Оцениваемый тест модуля на карте курса. */
export interface LearnModuleQuiz {
  id: string;
  title: string;
  questionCount: number;
  passThreshold: number;
  passCount: number;
  maxAttempts: number;
  attemptsUsed: number;
  attemptsLeft: number;
  inProgressAttemptId: string | null;
  bestScore: number | null;
  countedScore: number | null;
  passed: boolean;
  finalReached: boolean;
  canStart: boolean;
  lastAttemptAt: string | null;
  cooldownUntil: string | null;
  scoringRule: ScoringRule;
  reviewPolicy: ReviewPolicy;
}
/** Практическое задание на карте курса. */
export interface LearnPractical {
  id: string;
  title: string;
  scenarioTeaser: string;
  maxAiMessages: number;
  estimatedMinutes: number | null;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'PASSED' | 'FAILED';
  latestSessionId: string | null;
  activeSessionId: string | null;
  remainingAiMessages: number | null;
  sessionsUsed: number;
  maxSessions: number;
  canStart: boolean;
  final: boolean;
  availableFrom: string | null;
  availableUntil: string | null;
  lock: LockInfo | null;
}
/** Модуль на карте курса. */
export interface LearnModule {
  id: string;
  title: string;
  orderIndex: number;
  assessmentType: AssessmentType;
  coversWholeCourse: boolean;
  lectures: LearnLecture[];
  quiz: LearnModuleQuiz | null;
  practicalTask: LearnPractical | null;
  lecturesDone: number;
  lecturesTotal: number;
  durationSec: number | null;
  state: ItemState;
}
/** Разбивка прогресса по курсу. */
export interface ProgressBreakdown {
  percent: number;
  lecturesDone: number;
  lecturesTotal: number;
  quizzesPassed: number;
  quizzesTotal: number;
  practicalPassed: boolean;
  practicalTotal: number;
  remainingSec: number | null;
}
/** Рекомендуемый следующий шаг («Продолжить»): только рекомендация, без жёсткого порядка. */
export interface NextItem {
  kind: LearnItemKind;
  id: string;
  title: string;
  moduleId: string | null;
  moduleOrderIndex: number | null;
  lectureNumber?: number;
  positionSec?: number;
  reason: 'RESUME' | 'NEXT';
}
/** Чего не хватает до сертификата. */
export interface CertificateMissing {
  kind: 'LECTURES' | 'MODULE_QUIZ' | 'PRACTICAL';
  moduleOrderIndex?: number;
  done?: number;
  total?: number;
}
/** Статус сертификата по записи на курс. */
export interface CertificateStatus {
  eligible: boolean;
  issued: boolean;
  serialNumber: string | null;
  issuedAt: string | null;
  rule: CertificateRule;
  missing: CertificateMissing[];
}
/** Карта курса студента (GET /courses/:id/learn). */
export interface LearnView {
  enrollment: {
    id: string;
    status: EnrollmentStatus;
    progressPercent: number;
    languageVersionId: string;
    languageLocked: boolean;
    languageLockReason: LanguageLockReason | null;
  };
  version: {
    id: string;
    title: string;
    language: Language;
    description: string | null;
    finalMiniQuizId: string | null;
    modules: LearnModule[];
  };
  availableLanguages: { id: string; language: Language; title: string }[];
  progress: ProgressBreakdown;
  next: NextItem | null;
  certificate: CertificateStatus;
}
/** Соседний элемент пути для навигации «назад/далее» в плеере лекции. */
export interface LectureNeighbor {
  kind: LearnItemKind;
  id: string;
  title: string;
  moduleOrderIndex: number | null;
  lectureNumber?: number;
}
/** Страница лекции (плеер + расшифровка + позиция возобновления). */
export interface LectureView {
  id: string;
  title: string;
  youtubeVideoId: string;
  transcriptText: string;
  durationSec: number | null;
  summary: string | null;
  completed: boolean;
  positionSec: number;
  watchedSec: number;
  miniQuizId: string | null;
  lectureNumber: number;
  lecturesTotal: number;
  module: { id: string; title: string; orderIndex: number; indexInModule: number; lecturesInModule: number };
  prev: LectureNeighbor | null;
  next: LectureNeighbor | null;
}
/** Сводка по курсу для карточки «Мои курсы» (StudentEnrollment.summary). */
export interface MyCourseSummary {
  progress: ProgressBreakdown;
  next: NextItem | null;
  counts: { modules: number; lectures: number; durationSec: number | null };
  languageVersionStatus: PublishStatus;
  languageLocked: boolean;
  certificate: CertificateStatus;
}
/** Предпросмотр смены языка курса: можно ли и что перенесётся (USER_DECISIONS §3). */
export interface LanguageSwitchPreview {
  allowed: boolean;
  reason: 'LOCKED_AFTER_GRADED' | 'SAME_LANGUAGE' | 'NOT_AVAILABLE' | 'COMPLETED' | null;
  lockReason: LanguageLockReason | null;
  carriedLectures: number;
  targetTitle: string;
}

/* ── Тесты ──────────────────────────────────────────────────────────── */

/** Вопрос без ключа (тренировка): id варианта = индекс в options. */
export interface PublicQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  options: string[];
  orderIndex: number;
}
/** Вариант ответа в попытке: id = канонический индекс варианта. */
export interface AttemptOption {
  id: number;
  text: string;
}
/** Вопрос официальной попытки: position — порядок показа в этой попытке. */
export interface AttemptQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  options: AttemptOption[];
  position: number;
}
/** Краткие итоги одной попытки (история в лобби теста). */
export interface AttemptSummary {
  id: string;
  attemptNumber: number;
  startedAt: string;
  submittedAt: string | null;
  durationSec: number | null;
  score: number;
  passed: boolean;
  correctCount: number;
  total: number;
  autoSubmitted: boolean;
  counted: boolean;
}
/** Лобби теста: правила, попытки, пауза, история (GET /quizzes/:id/lobby). */
export interface QuizLobby {
  id: string;
  title: string;
  kind: QuizKind;
  isGraded: boolean;
  moduleId: string | null;
  moduleOrderIndex: number | null;
  questionCount: number;
  passThreshold: number;
  passCount: number;
  maxAttempts: number;
  attemptsUsed: number;
  attemptsLeft: number;
  canStart: boolean;
  scoringRule: ScoringRule;
  reviewPolicy: ReviewPolicy;
  cooldownMinutes: number;
  cooldownUntil: string | null;
  bestScore: number | null;
  countedScore: number | null;
  passed: boolean;
  finalReached: boolean;
  practiceAllowed: boolean;
  inProgressAttempt: { id: string; startedAt: string; answeredCount: number; flaggedCount: number } | null;
  history: AttemptSummary[];
  questions?: PublicQuestion[];
}
/** Начатая (или возобновлённая) официальная попытка. */
export interface AttemptStart {
  attemptId: string;
  attemptNumber: number;
  startedAt: string;
  questions: AttemptQuestion[];
  answers: Record<string, number[]>;
  flagged: string[];
  lastSavedAt: string | null;
  resumed: boolean;
}
/** Уровень разбора, который сервер отдал по политике и состоянию попыток. */
export type ReviewLevel = 'FULL' | 'CORRECTNESS' | 'SCORE';
/** Источник вопроса в лекции (ссылка «пересмотреть фрагмент»). */
export interface ReviewSource {
  lectureId: string;
  title: string;
  lectureNumber: number | null;
  timecode: string | null;
  seconds: number | null;
}
/** CORRECTNESS: только {questionId, position, prompt, type, isCorrect}. Остальные поля — лишь при FULL. */
export interface ReviewItem {
  questionId: string;
  position: number;
  prompt: string;
  type: QuestionType;
  isCorrect: boolean;
  options?: AttemptOption[];
  selected?: number[];
  correctOptionIds?: number[];
  explanation?: string | null;
  optionRationales?: (string | null)[] | null;
  source?: ReviewSource | null;
}
/** Результат отправленной попытки с разбором допустимого уровня. */
export interface AttemptResult {
  attempt: AttemptSummary;
  reviewLevel: ReviewLevel;
  reviewPolicy: ReviewPolicy;
  review: ReviewItem[];
  attemptsLeft: number;
  canStart: boolean;
  cooldownUntil: string | null;
  passed: boolean;
  finalReached: boolean;
}
/** Проверка ответа в тренировке (не пишет попыток и оценочной телеметрии). */
export interface PracticeCheck {
  isCorrect: boolean;
  correctOptionIds: number[];
  explanation: string | null;
  optionRationales: (string | null)[] | null;
}
/** Вопрос набора для тренировки к тесту модуля. */
export interface PracticeSetItem {
  quizId: string;
  source: 'MINI' | 'GRADED';
  lectureId: string | null;
  question: PublicQuestion;
}
/** Набор для тренировки: мини-квизы модуля, оцениваемые — только после завершения теста (USER_DECISIONS §2). */
export interface PracticeSet {
  moduleId: string;
  includesGraded: boolean;
  items: PracticeSetItem[];
}

/* ── Практикум ──────────────────────────────────────────────────────── */

/** Лекция, к которой студент может обратиться во время диалога (USER_DECISIONS §4). */
export interface PracticalLectureRef {
  id: string;
  title: string;
  lectureNumber: number;
  moduleOrderIndex: number;
}
/** Бриф практического задания (без эталона и рубрики). */
export interface PracticalBrief {
  id: string;
  title: string;
  scenario: string;
  agenda: string[];
  estimatedMinutes: number | null;
  maxAiMessages: number;
  maxSessions: number;
  language: Language;
  moduleTitles: string[];
  lectures: PracticalLectureRef[];
}
/** Строка списка сессий практикума. */
export interface PracticalSessionSummary {
  id: string;
  status: SessionStatus;
  verdictCode: VerdictCode | null;
  startedAt: string;
  endedAt: string | null;
  aiMessageCount: number;
  maxAiMessages: number;
  counted: boolean;
}
/** Страница практикума: бриф, сессии, возможность начать. */
export interface PracticalSessionsView {
  brief: PracticalBrief;
  items: PracticalSessionSummary[];
  status: LearnPractical['status'];
  sessionsUsed: number;
  maxSessions: number;
  canStart: boolean;
  final: boolean;
  activeSessionId: string | null;
  latestFinishedSessionId: string | null;
  lock: LockInfo | null;
}
/** Реплика чата практикума, видимая студенту. */
export interface ChatMessageView {
  id: string;
  role: 'AI' | 'STUDENT' | 'SYSTEM';
  content: string;
  createdAt: string;
}
/** Состояние сессии практикума для студента (без вывода судьи). */
export interface PracticalSessionView {
  id: string;
  status: SessionStatus;
  verdictCode: VerdictCode | null;
  aiMessageCount: number;
  maxAiMessages: number;
  remainingAiMessages: number;
  startedAt: string;
  endedAt: string | null;
  summaryStatus: 'PENDING' | 'READY' | 'FAILED' | null;
  final: boolean;
}
/** Критерий рубрики хода рассуждений (§5.5). */
export type RubricCriterion = 'methodicalness' | 'question_quality' | 'logical_progression' | 'self_correction';
/** toDevelop/highlights = null, пока у студента остаётся попытка (A6). */
export interface SessionEvaluation {
  criteria: { key: RubricCriterion; score: number; line: string | null }[];
  strengths: string[];
  toDevelop: string[] | null;
  highlights: { messageId: string; criterion: RubricCriterion; polarity: 'plus' | 'minus'; note: string }[] | null;
}
/** Завершённая сессия целиком: состояние, реплики, итоговая оценка. */
export interface SessionDetail {
  session: PracticalSessionView;
  messages: ChatMessageView[];
  evaluation: SessionEvaluation | null;
}
/** SSE 'done' — ЕДИНСТВЕННАЯ форма (allowlist, A1): никакого вывода судьи. */
export interface TurnDone {
  tutorMessage: string;
  tutorMessageId: string;
  userMessageId: string;
  remaining: number;
  status: SessionStatus;
  verdictCode: VerdictCode | null;
}
/** Причина завершения сессии от студента (TECH_ISSUE — пауза, не итог). */
export type SessionEndInputReason = 'DONE' | 'TECH_ISSUE' | 'OTHER';

/* ── Жалобы и проверка сертификата ──────────────────────────────────── */

/** Тело жалобы на контент (POST /content-issues). */
export interface ContentIssueInput {
  targetType: ContentIssueTarget;
  targetId: string;
  reason: string;
  comment?: string;
  context: string;
  enrollmentId?: string;
}
/** Публичная проверка сертификата по серийному номеру. */
export type VerifyResult =
  | {
      valid: true;
      serialNumber: string;
      holderName: string;
      courseTitle: string;
      language: Language;
      issuedAt: string;
      moduleTitles: string[];
      issuer: string;
    }
  | { valid: false };

/* ── Чистые правила (общие для backend и frontend) ──────────────────── */

type DateInput = Date | string;

const toMs = (d: DateInput): number => (d instanceof Date ? d.getTime() : new Date(d).getTime());
const toIso = (ms: number): string => new Date(ms).toISOString();

/**
 * Сколько верных ответов нужно для зачёта: ceil(порог × число вопросов).
 * Эпсилон гасит погрешность float (0.7 × 10 = 7.000000000000001 → 7, а не 8).
 */
export function passCountFor(threshold: number, total: number): number {
  return Math.ceil(threshold * total - 1e-9);
}

/**
 * Таймкод 'mm:ss' или 'h:mm:ss' (пробелы вокруг ':' допускаются) → секунды.
 * Некорректный ввод → null. Минуты без часов могут быть > 59 ('75:10').
 */
export function timecodeToSeconds(tc: string | null | undefined): number | null {
  if (typeof tc !== 'string') return null;
  const m = /^\s*(?:(\d{1,2})\s*:\s*)?(\d{1,3})\s*:\s*(\d{1,2})\s*$/.exec(tc);
  if (!m) return null;
  const hours = m[1] === undefined ? null : Number(m[1]);
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  if (seconds > 59) return null;
  if (hours !== null && minutes > 59) return null;
  return (hours ?? 0) * 3600 + minutes * 60 + seconds;
}

/** Попытка теста — вход правила (строка QuizAttempt). */
export interface QuizAttemptInput {
  id: string;
  startedAt: DateInput;
  /** null — попытка в процессе: занимает слот попытки */
  submittedAt: DateInput | null;
  score: number;
  passed: boolean;
}

/** Параметры теста — вход правила. cooldownMinutes — ЭФФЕКТИВНОЕ значение (Quiz ?? env). */
export interface QuizRulesInput {
  maxAttempts: number;
  cooldownMinutes: number;
  scoringRule: ScoringRule;
}

/** Состояние попыток теста для студента. Даты — ISO. */
export interface QuizAttemptState {
  /** Все попытки, включая незавершённую */
  attemptsUsed: number;
  attemptsLeft: number;
  inProgressId: string | null;
  passed: boolean;
  bestScore: number | null;
  /** BEST — лучший балл отправленных; FIRST — балл первой отправленной */
  countedScore: number | null;
  countedAttemptId: string | null;
  /** Номера попыток по порядку начала; counted — попытка, идущая в зачёт */
  numbered: { id: string; attemptNumber: number; counted: boolean }[];
  lastSubmittedAt: string | null;
  cooldownUntil: string | null;
  canStart: boolean;
  /** Сдан или попытки исчерпаны (и нет незавершённой) — открывается полный разбор */
  finalReached: boolean;
}

/**
 * Правило попыток оцениваемого теста (USER_DECISIONS §1): 2 попытки, в зачёт лучшая,
 * пауза между попытками. После зачёта новых попыток нет — поэтому «лучшая из двух»
 * безопасна: полный ключ открывается при сдаче.
 */
export function quizAttemptState(
  attempts: readonly QuizAttemptInput[],
  quiz: QuizRulesInput,
  now: DateInput = new Date(),
): QuizAttemptState {
  const sorted = [...attempts].sort((a, b) => toMs(a.startedAt) - toMs(b.startedAt));
  const submitted = sorted.filter((a) => a.submittedAt !== null);
  const inProgress = [...sorted].reverse().find((a) => a.submittedAt === null) ?? null;

  const attemptsUsed = sorted.length;
  const attemptsLeft = Math.max(0, quiz.maxAttempts - attemptsUsed);
  const passed = submitted.some((a) => a.passed);

  let best: QuizAttemptInput | null = null;
  for (const a of submitted) if (!best || a.score > best.score) best = a;
  const counted = quiz.scoringRule === 'FIRST' ? (submitted[0] ?? null) : best;

  let lastSubmittedMs: number | null = null;
  for (const a of submitted) {
    const ms = toMs(a.submittedAt as DateInput);
    if (lastSubmittedMs === null || ms > lastSubmittedMs) lastSubmittedMs = ms;
  }

  const cooldownMs = Number.isFinite(quiz.cooldownMinutes) && quiz.cooldownMinutes > 0 ? quiz.cooldownMinutes * 60_000 : 0;
  let cooldownUntil: string | null = null;
  if (!passed && !inProgress && attemptsLeft > 0 && cooldownMs > 0 && lastSubmittedMs !== null) {
    const until = lastSubmittedMs + cooldownMs;
    if (until > toMs(now)) cooldownUntil = toIso(until);
  }

  return {
    attemptsUsed,
    attemptsLeft,
    inProgressId: inProgress?.id ?? null,
    passed,
    bestScore: best?.score ?? null,
    countedScore: counted?.score ?? null,
    countedAttemptId: counted?.id ?? null,
    numbered: sorted.map((a, i) => ({ id: a.id, attemptNumber: i + 1, counted: a.id === counted?.id })),
    lastSubmittedAt: lastSubmittedMs === null ? null : toIso(lastSubmittedMs),
    cooldownUntil,
    canStart: !passed && !inProgress && attemptsLeft > 0 && !cooldownUntil,
    finalReached: passed || (attemptsLeft === 0 && !inProgress),
  };
}

/** Сессия практикума — вход правила. userMessageCount — число реплик СТУДЕНТА. */
export interface PracticalSessionInput {
  id: string;
  status: SessionStatus;
  startedAt: DateInput;
  endedAt: DateInput | null;
  userMessageCount: number;
  excusedAt: DateInput | null;
}

/** Параметры практического задания — вход правила. */
export interface PracticalRulesInput {
  maxSessions: number;
  availableFrom: DateInput | null;
  availableUntil: DateInput | null;
}

/** Состояние попыток практикума для студента. */
export interface PracticalAttemptState {
  /** Сессии, засчитанные как попытка */
  countedIds: string[];
  sessionsUsed: number;
  activeSessionId: string | null;
  passed: boolean;
  status: LearnPractical['status'];
  latestFinishedSessionId: string | null;
  lock: LockInfo | null;
  canStart: boolean;
  /** Сдан или (нет активной сессии и попытки исчерпаны) */
  final: boolean;
}

/**
 * Засчитывается ли сессия как попытка (A7): завершена, студент написал хотя бы одну
 * реплику и сотрудник её не освободил. Пауза/техсбой без реплик попыткой не считаются.
 */
export function isPracticalSessionCounted(s: Pick<PracticalSessionInput, 'status' | 'userMessageCount' | 'excusedAt'>): boolean {
  return s.status !== 'IN_PROGRESS' && s.userMessageCount > 0 && !s.excusedAt;
}

/**
 * Правило попыток практикума (USER_DECISIONS §4): maxSessions зачётных сессий,
 * после PASSED новых нет; окно доступности — единственная блокировка.
 */
export function practicalAttemptState(
  sessions: readonly PracticalSessionInput[],
  task: PracticalRulesInput,
  now: DateInput = new Date(),
): PracticalAttemptState {
  const sorted = [...sessions].sort((a, b) => toMs(a.startedAt) - toMs(b.startedAt));
  const counted = sorted.filter(isPracticalSessionCounted);
  const active = [...sorted].reverse().find((s) => s.status === 'IN_PROGRESS') ?? null;
  const passed = sorted.some((s) => s.status === 'PASSED');
  const failed = counted.some((s) => s.status === 'FAILED' || s.status === 'ABANDONED');

  const status: LearnPractical['status'] = passed ? 'PASSED' : active ? 'IN_PROGRESS' : failed ? 'FAILED' : 'NOT_STARTED';

  const finished = sorted.filter((s) => s.status !== 'IN_PROGRESS');
  const latestFinished = counted[counted.length - 1] ?? finished[finished.length - 1] ?? null;

  const nowMs = toMs(now);
  let lock: LockInfo | null = null;
  if (task.availableFrom !== null && nowMs < toMs(task.availableFrom)) {
    lock = { code: 'NOT_YET_AVAILABLE', until: toIso(toMs(task.availableFrom)) };
  } else if (task.availableUntil !== null && nowMs > toMs(task.availableUntil)) {
    lock = { code: 'CLOSED', until: null };
  }

  const sessionsUsed = counted.length;
  return {
    countedIds: counted.map((s) => s.id),
    sessionsUsed,
    activeSessionId: active?.id ?? null,
    passed,
    status,
    latestFinishedSessionId: latestFinished?.id ?? null,
    lock,
    canStart: !passed && !active && sessionsUsed < task.maxSessions && !lock,
    final: passed || (!active && sessionsUsed >= task.maxSessions),
  };
}
