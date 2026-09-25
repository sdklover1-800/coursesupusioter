import {
  passCountFor,
  practicalAttemptState,
  quizAttemptState,
  type AssessmentType,
  type CertificateMissing,
  type CertificateRule,
  type CertificateStatus,
  type EnrollmentStatus,
  type ItemState,
  type Language,
  type LanguageLockReason,
  type LearnLecture,
  type LearnModule,
  type LearnModuleQuiz,
  type LearnPractical,
  type LearnView,
  type LectureNeighbor,
  type MyCourseSummary,
  type NextItem,
  type ProgressBreakdown,
  type PublishStatus,
  type ReviewPolicy,
  type ScoringRule,
  type SessionStatus,
} from '@edu/shared';

/**
 * Карта курса студента (LearnView) — ЧИСТОЕ построение из уже загруженных данных.
 * Здесь нет Prisma: загрузка — в progress.service (loadLearnInputs), правила попыток —
 * общие из @edu/shared (quizAttemptState, practicalAttemptState).
 *
 * USER_DECISIONS §3: порядок изучения СВОБОДНЫЙ. «next» — только рекомендация, а
 * единственная блокировка — окно доступности практикума (LockInfo). Мини-квизы
 * (тренировка) никогда не бывают следующим шагом и не входят в прогресс.
 * Одно правило сертификата (env CERT_RULE) — и для карты, и для recomputeProgress.
 */

type DateLike = Date | string;

/** Лекция версии: мини-квиз — id и число НЕархивных вопросов. */
export interface LearnInputLecture {
  id: string;
  title: string;
  orderIndex: number;
  youtubeVideoId: string;
  durationSec: number | null;
  summary: string | null;
  miniQuizId: string | null;
  miniQuestionCount: number;
}

/** Оцениваемый тест модуля: questionCount — только НЕархивные вопросы. */
export interface LearnInputQuiz {
  id: string;
  title: string;
  passThreshold: number;
  maxAttempts: number;
  reviewPolicy: ReviewPolicy;
  scoringRule: ScoringRule;
  /** null — действует значение по умолчанию (env QUIZ_COOLDOWN_MINUTES) */
  cooldownMinutes: number | null;
  questionCount: number;
}

/** Практическое задание (только то, что видно студенту). */
export interface LearnInputPractical {
  id: string;
  title: string;
  scenarioPrompt: string;
  maxAiMessages: number;
  maxSessions: number;
  estimatedMinutes: number | null;
  availableFrom: DateLike | null;
  availableUntil: DateLike | null;
}

export interface LearnInputModule {
  id: string;
  title: string;
  orderIndex: number;
  assessmentType: AssessmentType;
  coversWholeCourse: boolean;
  lectures: LearnInputLecture[];
  quiz: LearnInputQuiz | null;
  practicalTask: LearnInputPractical | null;
}

export interface LearnInputVersion {
  id: string;
  title: string;
  language: Language;
  description: string | null;
  finalMiniQuizId: string | null;
  modules: LearnInputModule[];
}

export interface LearnInputProgress {
  lectureId: string;
  isCompleted: boolean;
  positionSec: number;
  watchedSec: number;
}

/** Попытка оцениваемого теста: submittedAt = null — в процессе (занимает слот). */
export interface LearnInputAttempt {
  id: string;
  quizId: string;
  startedAt: DateLike;
  submittedAt: DateLike | null;
  score: number;
  passed: boolean;
}

/** Сессия практикума: userMessageCount — число реплик СТУДЕНТА (ChatMessage role=STUDENT). */
export interface LearnInputSession {
  id: string;
  practicalTaskId: string;
  status: SessionStatus;
  startedAt: DateLike;
  endedAt: DateLike | null;
  aiMessageCount: number;
  /** Снимок лимита на момент старта сессии */
  maxAiMessages: number;
  userMessageCount: number;
  excusedAt: DateLike | null;
}

/** Всё, что нужно для карты курса одной записи. */
export interface LearnInput {
  enrollment: {
    id: string;
    status: EnrollmentStatus;
    progressPercent: number;
    languageVersionId: string;
    lastLectureId: string | null;
  };
  version: LearnInputVersion;
  availableLanguages: { id: string; language: Language; title: string }[];
  lectureProgress: LearnInputProgress[];
  attempts: LearnInputAttempt[];
  sessions: LearnInputSession[];
  certificate: { serialNumber: string; issuedAt: DateLike } | null;
  languageLock: { locked: boolean; reason: LanguageLockReason | null };
}

export interface LearnViewOptions {
  /** Условие сертификата (env CERT_RULE) */
  certRule: CertificateRule;
  /** Пауза между попытками по умолчанию, мин (env QUIZ_COOLDOWN_MINUTES) */
  cooldownDefaultMinutes: number;
}

/** Порог «есть что возобновлять» в лекции, сек. */
export const RESUME_MIN_POSITION_SEC = 30;
/** Длина тизера сценария практикума на карте курса. */
export const SCENARIO_TEASER_MAX = 240;

const toIso = (d: DateLike | null): string | null => (d === null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString());
const toMs = (d: DateLike): number => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/** Сумма длительностей; null, если хоть у одной лекции длительность не задана. */
export function sumDurations(values: readonly (number | null)[]): number | null {
  let sum = 0;
  for (const v of values) {
    if (v === null || v === undefined) return null;
    sum += v;
  }
  return sum;
}

/** Доля просмотренного, %: min(100, round(watched / duration × 100)); 0 без длительности. */
export function watchedPercent(watchedSec: number, durationSec: number | null): number {
  if (!durationSec || durationSec <= 0) return 0;
  return Math.min(100, Math.round((Math.max(0, watchedSec) / durationSec) * 100));
}

/**
 * Тизер сценария: первые ≤ 240 символов, обрезка по концу предложения; если
 * предложение слишком длинное — по слову с многоточием.
 */
export function scenarioTeaser(text: string, max = SCENARIO_TEASER_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  let cut = -1;
  for (const m of clean.matchAll(/[.!?…](?=\s|$)/g)) {
    const end = (m.index ?? 0) + 1;
    if (end > max) break;
    cut = end;
  }
  if (cut >= Math.floor(max / 3)) return clean.slice(0, cut);
  const head = clean.slice(0, max - 1);
  const space = head.lastIndexOf(' ');
  return `${(space > 0 ? head.slice(0, space) : head).replace(/[\s,;:–—-]+$/u, '')}…`;
}

function buildQuiz(q: LearnInputQuiz, attempts: LearnInputAttempt[], now: Date, opts: LearnViewOptions): LearnModuleQuiz {
  const cooldownMinutes = q.cooldownMinutes ?? opts.cooldownDefaultMinutes;
  const st = quizAttemptState(attempts, { maxAttempts: q.maxAttempts, cooldownMinutes, scoringRule: q.scoringRule }, now);
  return {
    id: q.id,
    title: q.title,
    questionCount: q.questionCount,
    passThreshold: q.passThreshold,
    passCount: passCountFor(q.passThreshold, q.questionCount),
    maxAttempts: q.maxAttempts,
    attemptsUsed: st.attemptsUsed,
    attemptsLeft: st.attemptsLeft,
    inProgressAttemptId: st.inProgressId,
    bestScore: st.bestScore,
    countedScore: st.countedScore,
    passed: st.passed,
    finalReached: st.finalReached,
    canStart: st.canStart,
    lastAttemptAt: st.lastSubmittedAt,
    cooldownUntil: st.cooldownUntil,
    scoringRule: q.scoringRule,
    reviewPolicy: q.reviewPolicy,
  };
}

function buildPractical(t: LearnInputPractical, sessions: LearnInputSession[], now: Date): LearnPractical {
  // Сортировка по началу — детерминированный статус (раньше «побеждала» последняя строка Map).
  const sorted = [...sessions].sort((a, b) => toMs(a.startedAt) - toMs(b.startedAt));
  const st = practicalAttemptState(
    sorted.map((s) => ({
      id: s.id,
      status: s.status,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      userMessageCount: s.userMessageCount,
      excusedAt: s.excusedAt,
    })),
    { maxSessions: t.maxSessions, availableFrom: t.availableFrom, availableUntil: t.availableUntil },
    now,
  );
  const active = st.activeSessionId ? (sorted.find((s) => s.id === st.activeSessionId) ?? null) : null;
  return {
    id: t.id,
    title: t.title,
    scenarioTeaser: scenarioTeaser(t.scenarioPrompt),
    maxAiMessages: t.maxAiMessages,
    estimatedMinutes: t.estimatedMinutes,
    status: st.status,
    // Последняя завершённая (для «Посмотреть разбор»), иначе активная.
    latestSessionId: st.latestFinishedSessionId ?? st.activeSessionId,
    activeSessionId: st.activeSessionId,
    remainingAiMessages: active ? Math.max(0, active.maxAiMessages - active.aiMessageCount) : null,
    sessionsUsed: st.sessionsUsed,
    maxSessions: t.maxSessions,
    canStart: st.canStart,
    final: st.final,
    availableFrom: toIso(t.availableFrom),
    availableUntil: toIso(t.availableUntil),
    lock: st.lock,
  };
}

/**
 * Состояние модуля. По лекциям: DONE — все, IN_PROGRESS — часть, NOT_STARTED — ни одной.
 * С оцениванием: PASSED — сдано, FAILED — финал без зачёта; пока оценивание не сдано,
 * модуль не DONE (все лекции просмотрены → IN_PROGRESS), а начатое оценивание — IN_PROGRESS.
 */
export function moduleState(
  lecturesDone: number,
  lecturesTotal: number,
  quiz: Pick<LearnModuleQuiz, 'passed' | 'finalReached' | 'attemptsUsed'> | null,
  practical: Pick<LearnPractical, 'status' | 'final' | 'sessionsUsed' | 'activeSessionId'> | null,
): ItemState {
  if (quiz?.passed || practical?.status === 'PASSED') return 'PASSED';
  if ((quiz && quiz.finalReached) || (practical && practical.final)) return 'FAILED';
  const byLectures: ItemState =
    lecturesTotal > 0 && lecturesDone === lecturesTotal ? 'DONE' : lecturesDone > 0 ? 'IN_PROGRESS' : 'NOT_STARTED';
  if (!quiz && !practical) return byLectures;
  const assessmentStarted = (quiz?.attemptsUsed ?? 0) > 0 || (practical?.sessionsUsed ?? 0) > 0 || !!practical?.activeSessionId;
  if (byLectures === 'DONE' || assessmentStarted) return 'IN_PROGRESS';
  return byLectures;
}

/**
 * Статус сертификата по правилу (одно место для карты и recomputeProgress):
 *  - PASS_ALL — все лекции + все тесты модулей СДАНЫ + практикум СДАН;
 *  - COMPLETE_ALL — все лекции + все тесты дошли до финала + практикум завершён (final).
 */
export function certificateStatus(
  modules: readonly LearnModule[],
  rule: CertificateRule,
  certificate: LearnInput['certificate'],
): CertificateStatus {
  const missing: CertificateMissing[] = [];
  let total = 0;
  for (const m of modules) {
    total += m.lecturesTotal;
    if (m.lecturesDone < m.lecturesTotal) {
      missing.push({ kind: 'LECTURES', moduleOrderIndex: m.orderIndex, done: m.lecturesDone, total: m.lecturesTotal });
    }
    if (m.quiz) {
      total++;
      const ok = rule === 'PASS_ALL' ? m.quiz.passed : m.quiz.finalReached;
      if (!ok) missing.push({ kind: 'MODULE_QUIZ', moduleOrderIndex: m.orderIndex });
    }
    if (m.practicalTask) {
      total++;
      const ok = rule === 'PASS_ALL' ? m.practicalTask.status === 'PASSED' : m.practicalTask.final;
      if (!ok) missing.push({ kind: 'PRACTICAL', moduleOrderIndex: m.orderIndex });
    }
  }
  return {
    eligible: total > 0 && missing.length === 0,
    issued: !!certificate,
    serialNumber: certificate?.serialNumber ?? null,
    issuedAt: certificate ? toIso(certificate.issuedAt) : null,
    rule,
    missing,
  };
}

/** Разбивка прогресса: процент = (лекции + сданные тесты + сданный практикум) / всего. */
export function progressBreakdown(modules: readonly LearnModule[]): ProgressBreakdown {
  let lecturesDone = 0;
  let lecturesTotal = 0;
  let quizzesPassed = 0;
  let quizzesTotal = 0;
  let practicalsPassed = 0;
  let practicalTotal = 0;
  const remaining: (number | null)[] = [];
  for (const m of modules) {
    for (const l of m.lectures) {
      lecturesTotal++;
      if (l.completed) lecturesDone++;
      else remaining.push(l.durationSec);
    }
    if (m.quiz) {
      quizzesTotal++;
      if (m.quiz.passed) quizzesPassed++;
    }
    if (m.practicalTask) {
      practicalTotal++;
      if (m.practicalTask.status === 'PASSED') practicalsPassed++;
    }
  }
  // remainingSec — null, если хоть у одной лекции курса нет длительности
  const anyMissing = modules.some((m) => m.lectures.some((l) => l.durationSec === null));
  const total = lecturesTotal + quizzesTotal + practicalTotal;
  return {
    percent: total ? Math.round(((lecturesDone + quizzesPassed + practicalsPassed) / total) * 100) : 0,
    lecturesDone,
    lecturesTotal,
    quizzesPassed,
    quizzesTotal,
    practicalPassed: practicalTotal > 0 && practicalsPassed === practicalTotal,
    practicalTotal,
    remainingSec: anyMissing ? null : sumDurations(remaining),
  };
}

const lectureItem = (m: LearnModule, l: LearnLecture, reason: NextItem['reason']): NextItem => ({
  kind: 'LECTURE',
  id: l.id,
  title: l.title,
  moduleId: m.id,
  moduleOrderIndex: m.orderIndex,
  lectureNumber: l.lectureNumber,
  ...(l.positionSec > 0 ? { positionSec: l.positionSec } : {}),
  reason,
});
const quizItem = (m: LearnModule, q: LearnModuleQuiz, reason: NextItem['reason']): NextItem => ({
  kind: 'MODULE_QUIZ',
  id: q.id,
  title: q.title,
  moduleId: m.id,
  moduleOrderIndex: m.orderIndex,
  reason,
});
const practicalItem = (m: LearnModule, p: LearnPractical, reason: NextItem['reason']): NextItem => ({
  kind: 'PRACTICAL',
  id: p.id,
  title: p.title,
  moduleId: m.id,
  moduleOrderIndex: m.orderIndex,
  reason,
});

/**
 * Рекомендуемый следующий шаг (первое совпадение, критика A15):
 *  1) незавершённая официальная попытка теста → RESUME;
 *  2) активная сессия несданного практикума → RESUME;
 *  3) последняя открытая лекция не завершена и позиция > 30 с → RESUME;
 *  4) по модулям: первая незавершённая лекция → тест модуля, если можно начать
 *     (пауза/финал пропускаются) → практикум, если можно начать;
 *  5) иначе тест на паузе (UI покажет обратный отсчёт);
 *  6) всё пройдено → сертификат (если положен или выдан); 7) иначе null.
 * Мини-квизы — никогда. Порядок не навязывается: это только рекомендация.
 */
export function nextItem(
  modules: readonly LearnModule[],
  lastLectureId: string | null,
  certificate: CertificateStatus,
  cert: { enrollmentId: string; title: string },
): NextItem | null {
  for (const m of modules) {
    if (m.quiz?.inProgressAttemptId) return quizItem(m, m.quiz, 'RESUME');
  }
  for (const m of modules) {
    // Сданный практикум не «возобновляем» (зависшая сессия после сдачи ничего не меняет)
    if (m.practicalTask?.activeSessionId && m.practicalTask.status !== 'PASSED') return practicalItem(m, m.practicalTask, 'RESUME');
  }
  if (lastLectureId) {
    for (const m of modules) {
      const l = m.lectures.find((x) => x.id === lastLectureId);
      if (l && !l.completed && l.positionSec > RESUME_MIN_POSITION_SEC) return lectureItem(m, l, 'RESUME');
    }
  }
  for (const m of modules) {
    const lecture = m.lectures.find((l) => !l.completed);
    if (lecture) return lectureItem(m, lecture, 'NEXT');
    if (m.quiz?.canStart) return quizItem(m, m.quiz, 'NEXT');
    if (m.practicalTask?.canStart) return practicalItem(m, m.practicalTask, 'NEXT');
  }
  for (const m of modules) {
    if (m.quiz?.cooldownUntil) return quizItem(m, m.quiz, 'NEXT');
  }
  if (certificate.eligible || certificate.issued) {
    return { kind: 'CERTIFICATE', id: cert.enrollmentId, title: cert.title, moduleId: null, moduleOrderIndex: null, reason: 'NEXT' };
  }
  return null;
}

/** Строит LearnView из загруженных данных. now — для паузы теста и окна практикума. */
export function buildLearnView(input: LearnInput, now: Date, opts: LearnViewOptions): LearnView {
  const progressByLecture = new Map(input.lectureProgress.map((p) => [p.lectureId, p]));
  const attemptsByQuiz = new Map<string, LearnInputAttempt[]>();
  for (const a of input.attempts) {
    const list = attemptsByQuiz.get(a.quizId) ?? [];
    list.push(a);
    attemptsByQuiz.set(a.quizId, list);
  }
  const sessionsByTask = new Map<string, LearnInputSession[]>();
  for (const s of input.sessions) {
    const list = sessionsByTask.get(s.practicalTaskId) ?? [];
    list.push(s);
    sessionsByTask.set(s.practicalTaskId, list);
  }

  const modulesSorted = [...input.version.modules].sort((a, b) => a.orderIndex - b.orderIndex);
  let lectureNumber = 0;
  const modules: LearnModule[] = modulesSorted.map((m) => {
    const lectures: LearnLecture[] = [...m.lectures]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((l) => {
        lectureNumber++;
        const p = progressByLecture.get(l.id);
        return {
          id: l.id,
          title: l.title,
          orderIndex: l.orderIndex,
          lectureNumber,
          youtubeVideoId: l.youtubeVideoId,
          durationSec: l.durationSec,
          summary: l.summary,
          completed: !!p?.isCompleted,
          positionSec: p?.positionSec ?? 0,
          watchedPercent: watchedPercent(p?.watchedSec ?? 0, l.durationSec),
          miniQuizId: l.miniQuizId,
          miniQuestionCount: l.miniQuestionCount,
        };
      });
    const quiz = m.quiz ? buildQuiz(m.quiz, attemptsByQuiz.get(m.quiz.id) ?? [], now, opts) : null;
    const practicalTask = m.practicalTask ? buildPractical(m.practicalTask, sessionsByTask.get(m.practicalTask.id) ?? [], now) : null;
    const lecturesDone = lectures.filter((l) => l.completed).length;
    return {
      id: m.id,
      title: m.title,
      orderIndex: m.orderIndex,
      assessmentType: m.assessmentType,
      coversWholeCourse: m.coversWholeCourse,
      lectures,
      quiz,
      practicalTask,
      lecturesDone,
      lecturesTotal: lectures.length,
      durationSec: sumDurations(lectures.map((l) => l.durationSec)),
      state: moduleState(lecturesDone, lectures.length, quiz, practicalTask),
    };
  });

  const progress = progressBreakdown(modules);
  const certificate = certificateStatus(modules, opts.certRule, input.certificate);
  const next = nextItem(modules, input.enrollment.lastLectureId, certificate, {
    enrollmentId: input.enrollment.id,
    title: input.version.title,
  });

  return {
    enrollment: {
      id: input.enrollment.id,
      status: input.enrollment.status,
      // Процент считается при чтении (совместимость: старый UI читает progressPercent)
      progressPercent: progress.percent,
      languageVersionId: input.enrollment.languageVersionId,
      languageLocked: input.languageLock.locked,
      languageLockReason: input.languageLock.reason,
    },
    version: {
      id: input.version.id,
      title: input.version.title,
      language: input.version.language,
      description: input.version.description,
      finalMiniQuizId: input.version.finalMiniQuizId,
      modules,
    },
    availableLanguages: input.availableLanguages,
    progress,
    next,
    certificate,
  };
}

/**
 * Учебный путь для навигации: лекции по порядку → тест модуля после последней
 * лекции модуля → практикум в конце своего модуля. Мини-квизы не входят.
 */
export function buildSequence(view: Pick<LearnView, 'version'>): LectureNeighbor[] {
  const items: LectureNeighbor[] = [];
  for (const m of view.version.modules) {
    for (const l of m.lectures) {
      items.push({ kind: 'LECTURE', id: l.id, title: l.title, moduleOrderIndex: m.orderIndex, lectureNumber: l.lectureNumber });
    }
    if (m.quiz) items.push({ kind: 'MODULE_QUIZ', id: m.quiz.id, title: m.quiz.title, moduleOrderIndex: m.orderIndex });
    if (m.practicalTask) items.push({ kind: 'PRACTICAL', id: m.practicalTask.id, title: m.practicalTask.title, moduleOrderIndex: m.orderIndex });
  }
  return items;
}

/** Соседи лекции на учебном пути (через границы модулей). */
export function lectureNeighbors(
  view: Pick<LearnView, 'version'>,
  lectureId: string,
): { prev: LectureNeighbor | null; next: LectureNeighbor | null } {
  const seq = buildSequence(view);
  const i = seq.findIndex((x) => x.kind === 'LECTURE' && x.id === lectureId);
  if (i === -1) return { prev: null, next: null };
  return { prev: seq[i - 1] ?? null, next: seq[i + 1] ?? null };
}

/** Где лекция в курсе: модуль, номер в модуле (с 1), всего лекций в курсе. */
export function locateLecture(
  view: Pick<LearnView, 'version'>,
  lectureId: string,
): { lecture: LearnLecture; module: LearnModule; indexInModule: number; lecturesTotal: number } | null {
  const lecturesTotal = view.version.modules.reduce((n, m) => n + m.lectures.length, 0);
  for (const m of view.version.modules) {
    const idx = m.lectures.findIndex((l) => l.id === lectureId);
    if (idx !== -1) return { lecture: m.lectures[idx]!, module: m, indexInModule: idx + 1, lecturesTotal };
  }
  return null;
}

/** Сводка для карточки «Мои курсы» (StudentEnrollment.summary). */
export function buildCourseSummary(view: LearnView, languageVersionStatus: PublishStatus): MyCourseSummary {
  const modules = view.version.modules;
  return {
    progress: view.progress,
    next: view.next,
    counts: {
      modules: modules.length,
      lectures: modules.reduce((n, m) => n + m.lectures.length, 0),
      durationSec: sumDurations(modules.map((m) => m.durationSec)),
    },
    languageVersionStatus,
    languageLocked: view.enrollment.languageLocked,
    certificate: view.certificate,
  };
}
