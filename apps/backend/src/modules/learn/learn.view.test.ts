import { describe, it, expect } from 'vitest';
import {
  buildLearnView,
  buildSequence,
  buildCourseSummary,
  lectureNeighbors,
  locateLecture,
  moduleState,
  scenarioTeaser,
  type LearnInput,
  type LearnInputAttempt,
  type LearnInputModule,
  type LearnInputSession,
  type LearnViewOptions,
} from './learn.view.js';

/**
 * Карта курса (LearnView): нумерация, «Продолжить», пропуски тестов на паузе/финале,
 * приоритет практикума, сертификат по двум правилам, окно практикума, соседи лекции.
 * USER_DECISIONS §1 (2 попытки, лучшая, пауза 24 ч), §3 (свободный порядок), §4 (2 сессии).
 */

const T0 = new Date('2026-09-10T10:00:00.000Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const NOW = at(0);
const OPTS: LearnViewOptions = { certRule: 'PASS_ALL', cooldownDefaultMinutes: 1440 };
const HOUR = 60;

/** Структура «как политология»: модули I–IV с тестами (3/4/3/3 лекции), V — практикум (2 лекции). */
function modules(opts: { durations?: boolean } = {}): LearnInputModule[] {
  const sizes = [3, 4, 3, 3, 2];
  return sizes.map((n, mi) => ({
    id: `m${mi}`,
    title: `Раздел ${mi + 1}`,
    orderIndex: mi,
    assessmentType: mi === 4 ? 'PRACTICAL' : 'QUIZ',
    coversWholeCourse: mi === 4,
    lectures: Array.from({ length: n }, (_, li) => ({
      id: `l${mi}-${li}`,
      title: `Лекция ${mi}.${li}`,
      orderIndex: li,
      youtubeVideoId: 'abcdefghijk',
      durationSec: opts.durations === false ? null : 1200,
      summary: null,
      miniQuizId: `mini${mi}-${li}`,
      miniQuestionCount: 3,
    })),
    quiz:
      mi === 4
        ? null
        : {
            id: `q${mi}`,
            title: `Тест ${mi + 1}`,
            passThreshold: 0.7,
            maxAttempts: 2,
            reviewPolicy: 'FULL_AFTER_FINAL',
            scoringRule: 'BEST',
            cooldownMinutes: null,
            questionCount: 8,
          },
    practicalTask:
      mi === 4
        ? {
            id: 'p1',
            title: 'Итоговый практикум',
            scenarioPrompt: 'Полисия — вымышленное государство. Вам предстоит разобраться в кризисе.',
            maxAiMessages: 22,
            maxSessions: 2,
            estimatedMinutes: 25,
            availableFrom: null,
            availableUntil: null,
          }
        : null,
  }));
}

const ALL_LECTURES = modules().flatMap((m) => m.lectures.map((l) => l.id));

function input(over: Partial<LearnInput> = {}, mods: LearnInputModule[] = modules()): LearnInput {
  return {
    enrollment: { id: 'e1', status: 'ACTIVE', progressPercent: 0, languageVersionId: 'v1', lastLectureId: null },
    version: { id: 'v1', title: 'Введение в политологию', language: 'ru', description: null, finalMiniQuizId: 'fm1', modules: mods },
    availableLanguages: [{ id: 'v1', language: 'ru', title: 'Введение в политологию' }],
    lectureProgress: [],
    attempts: [],
    sessions: [],
    certificate: null,
    languageLock: { locked: false, reason: null },
    ...over,
  };
}

const done = (...ids: string[]) => ids.map((lectureId) => ({ lectureId, isCompleted: true, positionSec: 0, watchedSec: 1200 }));
const lecturesOf = (...moduleIdx: number[]) => ALL_LECTURES.filter((id) => moduleIdx.includes(Number(id.slice(1, id.indexOf('-')))));
function attempt(quizId: string, startMin: number, submitMin: number | null, score: number, passed: boolean, id = `${quizId}-a${startMin}`): LearnInputAttempt {
  return { id, quizId, startedAt: at(startMin), submittedAt: submitMin === null ? null : at(submitMin), score, passed };
}
function session(id: string, status: LearnInputSession['status'], startMin: number, userMessageCount = 3, aiMessageCount = 5): LearnInputSession {
  return {
    id, practicalTaskId: 'p1', status, startedAt: at(startMin), endedAt: status === 'IN_PROGRESS' ? null : at(startMin + 30),
    aiMessageCount, maxAiMessages: 22, userMessageCount, excusedAt: null,
  };
}
/** Все тесты I–IV сданы (давно). */
const passedQuizzes = [0, 1, 2, 3].map((i) => attempt(`q${i}`, -10 * HOUR, -10 * HOUR + 20, 0.875, true));

describe('карта курса: лекции и прогресс', () => {
  it('сквозная нумерация лекций 1..N по модулям, даже если вход не отсортирован', () => {
    const mods = modules().reverse().map((m) => ({ ...m, lectures: [...m.lectures].reverse() }));
    const view = buildLearnView(input({}, mods), NOW, OPTS);
    const numbers = view.version.modules.flatMap((m) => m.lectures.map((l) => [l.id, l.lectureNumber]));
    expect(numbers[0]).toEqual(['l0-0', 1]);
    expect(numbers[3]).toEqual(['l1-0', 4]);
    expect(numbers[14]).toEqual(['l4-1', 15]);
    expect(view.version.modules.map((m) => m.orderIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it('watchedPercent: округление, потолок 100, 0 без длительности', () => {
    const progress = [
      { lectureId: 'l0-0', isCompleted: false, positionSec: 300, watchedSec: 600 },
      { lectureId: 'l0-1', isCompleted: false, positionSec: 10, watchedSec: 5000 },
    ];
    const view = buildLearnView(input({ lectureProgress: progress }), NOW, OPTS);
    const [a, b, c] = view.version.modules[0]!.lectures;
    expect([a!.watchedPercent, b!.watchedPercent, c!.watchedPercent]).toEqual([50, 100, 0]);
    expect(a!.positionSec).toBe(300);
    const noDur = buildLearnView(input({ lectureProgress: progress }, modules({ durations: false })), NOW, OPTS);
    expect(noDur.version.modules[0]!.lectures[0]!.watchedPercent).toBe(0);
  });

  it('длительность модуля и оставшееся время: число — если заданы все, null — если нет', () => {
    const view = buildLearnView(input({ lectureProgress: done('l0-0', 'l0-1') }), NOW, OPTS);
    expect(view.version.modules[0]!.durationSec).toBe(3600);
    expect(view.progress.remainingSec).toBe(13 * 1200);
    const mods = modules();
    mods[3]!.lectures[1]!.durationSec = null;
    const partial = buildLearnView(input({}, mods), NOW, OPTS);
    expect(partial.version.modules[0]!.durationSec).toBe(3600);
    expect(partial.version.modules[3]!.durationSec).toBeNull();
    expect(partial.progress.remainingSec).toBeNull();
  });

  it('процент = (лекции + сданные тесты + сданный практикум) / всего; незавершённая попытка не даёт зачёта', () => {
    const view = buildLearnView(
      input({
        lectureProgress: done(...lecturesOf(0)),
        attempts: [attempt('q0', -3 * HOUR, -3 * HOUR + 10, 0.875, true), attempt('q1', -5, null, 1, true)],
      }),
      NOW,
      OPTS,
    );
    expect(view.progress).toMatchObject({ lecturesDone: 3, lecturesTotal: 15, quizzesPassed: 1, quizzesTotal: 4, practicalPassed: false, practicalTotal: 1 });
    expect(view.progress.percent).toBe(Math.round((4 / 20) * 100));
    expect(view.enrollment.progressPercent).toBe(view.progress.percent);
    expect(view.version.modules[1]!.quiz).toMatchObject({ passed: false, bestScore: null, attemptsUsed: 1, inProgressAttemptId: 'q1-a-5' });
  });

  it('поля теста: passCount 6 из 8, пауза из quiz.cooldownMinutes важнее значения по умолчанию', () => {
    const mods = modules();
    mods[1]!.quiz!.cooldownMinutes = 0;
    const view = buildLearnView(
      input({ attempts: [attempt('q0', -60, -30, 0.5, false), attempt('q1', -60, -30, 0.5, false)] }, mods),
      NOW,
      OPTS,
    );
    const q0 = view.version.modules[0]!.quiz!;
    const q1 = view.version.modules[1]!.quiz!;
    expect(q0.passCount).toBe(6);
    expect(q0.canStart).toBe(false);
    expect(q0.cooldownUntil).toBe(at(-30 + 1440).toISOString());
    expect(q0.lastAttemptAt).toBe(at(-30).toISOString());
    expect(q1.canStart).toBe(true);
    expect(q1.cooldownUntil).toBeNull();
  });

  it('состояние модуля: без начала, в процессе, лекции пройдены а тест не сдан, сдан, провален', () => {
    expect(moduleState(0, 3, null, null)).toBe('NOT_STARTED');
    expect(moduleState(3, 3, null, null)).toBe('DONE');
    const quiz = { passed: false, finalReached: false, attemptsUsed: 0 };
    expect(moduleState(1, 3, quiz, null)).toBe('IN_PROGRESS');
    expect(moduleState(3, 3, quiz, null)).toBe('IN_PROGRESS');
    expect(moduleState(0, 3, { ...quiz, attemptsUsed: 1 }, null)).toBe('IN_PROGRESS');
    expect(moduleState(1, 3, { ...quiz, passed: true, finalReached: true }, null)).toBe('PASSED');
    expect(moduleState(3, 3, { ...quiz, finalReached: true, attemptsUsed: 2 }, null)).toBe('FAILED');
  });
});

describe('рекомендуемый шаг (next): свободный порядок, первое совпадение', () => {
  it('новый студент — первая лекция курса (NEXT)', () => {
    const view = buildLearnView(input(), NOW, OPTS);
    expect(view.next).toMatchObject({ kind: 'LECTURE', id: 'l0-0', lectureNumber: 1, moduleOrderIndex: 0, reason: 'NEXT' });
  });

  it('возобновление по lastLectureId: позиция > 30 с → RESUME с positionSec; ≤ 30 с или завершена — нет', () => {
    const progress = [{ lectureId: 'l2-1', isCompleted: false, positionSec: 754, watchedSec: 800 }];
    const view = buildLearnView(input({ lectureProgress: progress, enrollment: { ...input().enrollment, lastLectureId: 'l2-1' } }), NOW, OPTS);
    expect(view.next).toMatchObject({ kind: 'LECTURE', id: 'l2-1', reason: 'RESUME', positionSec: 754, lectureNumber: 9 });

    const short = [{ lectureId: 'l2-1', isCompleted: false, positionSec: 30, watchedSec: 30 }];
    const v2 = buildLearnView(input({ lectureProgress: short, enrollment: { ...input().enrollment, lastLectureId: 'l2-1' } }), NOW, OPTS);
    expect(v2.next).toMatchObject({ id: 'l0-0', reason: 'NEXT' });

    const completed = [{ lectureId: 'l2-1', isCompleted: true, positionSec: 900, watchedSec: 1200 }];
    const v3 = buildLearnView(input({ lectureProgress: completed, enrollment: { ...input().enrollment, lastLectureId: 'l2-1' } }), NOW, OPTS);
    expect(v3.next).toMatchObject({ id: 'l0-0', reason: 'NEXT' });
  });

  it('незавершённая официальная попытка — важнее всего (RESUME)', () => {
    const progress = [{ lectureId: 'l0-1', isCompleted: false, positionSec: 500, watchedSec: 500 }];
    const view = buildLearnView(
      input({
        lectureProgress: progress,
        enrollment: { ...input().enrollment, lastLectureId: 'l0-1' },
        attempts: [attempt('q2', -20, null, 0, false)],
        sessions: [session('s1', 'IN_PROGRESS', -10)],
      }),
      NOW,
      OPTS,
    );
    expect(view.next).toMatchObject({ kind: 'MODULE_QUIZ', id: 'q2', moduleOrderIndex: 2, reason: 'RESUME' });
  });

  it('незавершённая ПОСЛЕДНЯЯ попытка (попыток не осталось) — всё равно RESUME (A15)', () => {
    const view = buildLearnView(
      input({ attempts: [attempt('q0', -2000, -1990, 0.5, false), attempt('q0', -30, null, 0, false)] }),
      NOW,
      OPTS,
    );
    const q = view.version.modules[0]!.quiz!;
    expect(q).toMatchObject({ attemptsLeft: 0, finalReached: false, canStart: false });
    expect(view.next).toMatchObject({ kind: 'MODULE_QUIZ', id: 'q0', reason: 'RESUME' });
  });

  it('активная сессия практикума важнее возобновления лекции', () => {
    const progress = [{ lectureId: 'l1-2', isCompleted: false, positionSec: 400, watchedSec: 400 }];
    const view = buildLearnView(
      input({ lectureProgress: progress, enrollment: { ...input().enrollment, lastLectureId: 'l1-2' }, sessions: [session('s1', 'IN_PROGRESS', -15, 2, 6)] }),
      NOW,
      OPTS,
    );
    expect(view.next).toMatchObject({ kind: 'PRACTICAL', id: 'p1', reason: 'RESUME', moduleOrderIndex: 4 });
    expect(view.version.modules[4]!.practicalTask).toMatchObject({ status: 'IN_PROGRESS', activeSessionId: 's1', remainingAiMessages: 16 });
  });

  it('лекции модуля пройдены → тест модуля, если его можно начать', () => {
    const view = buildLearnView(input({ lectureProgress: done(...lecturesOf(0)) }), NOW, OPTS);
    expect(view.next).toMatchObject({ kind: 'MODULE_QUIZ', id: 'q0', reason: 'NEXT' });
  });

  it('тест на паузе пропускается — рекомендуется следующий модуль', () => {
    const view = buildLearnView(
      input({ lectureProgress: done(...lecturesOf(0)), attempts: [attempt('q0', -60, -40, 0.5, false)] }),
      NOW,
      OPTS,
    );
    expect(view.version.modules[0]!.quiz!.cooldownUntil).not.toBeNull();
    expect(view.next).toMatchObject({ kind: 'LECTURE', id: 'l1-0', reason: 'NEXT' });
  });

  it('исчерпанный тест (финал без зачёта) пропускается', () => {
    const view = buildLearnView(
      input({
        lectureProgress: done(...lecturesOf(0)),
        attempts: [attempt('q0', -4000, -3990, 0.5, false), attempt('q0', -2000, -1990, 0.625, false)],
      }),
      NOW,
      OPTS,
    );
    expect(view.version.modules[0]!.quiz).toMatchObject({ finalReached: true, passed: false, bestScore: 0.625 });
    expect(view.version.modules[0]!.state).toBe('FAILED');
    expect(view.next).toMatchObject({ kind: 'LECTURE', id: 'l1-0' });
  });

  it('остался только тест на паузе — рекомендуется он (UI покажет обратный отсчёт)', () => {
    const attempts = [...passedQuizzes.filter((a) => a.quizId !== 'q1'), attempt('q1', -60, -40, 0.5, false)];
    const view = buildLearnView(
      input({ lectureProgress: done(...ALL_LECTURES), attempts, sessions: [session('s1', 'PASSED', -300)] }),
      NOW,
      OPTS,
    );
    expect(view.next).toMatchObject({ kind: 'MODULE_QUIZ', id: 'q1', reason: 'NEXT' });
    expect(view.version.modules[1]!.quiz!.cooldownUntil).toBe(at(-40 + 1440).toISOString());
  });

  it('всё кроме практикума сдано → практикум (NEXT); мини-квизы не бывают следующим шагом', () => {
    const view = buildLearnView(input({ lectureProgress: done(...ALL_LECTURES), attempts: passedQuizzes }), NOW, OPTS);
    expect(view.next).toMatchObject({ kind: 'PRACTICAL', id: 'p1', reason: 'NEXT' });
    const kinds = buildSequence(view).map((i) => i.kind);
    expect(kinds).not.toContain('MINI_QUIZ');
    expect(kinds).not.toContain('FINAL_MINI_QUIZ');
  });

  it('всё сдано → сертификат; выданный — с номером и датой', () => {
    const issuedAt = at(-5);
    const view = buildLearnView(
      input({
        lectureProgress: done(...ALL_LECTURES),
        attempts: passedQuizzes,
        sessions: [session('s1', 'PASSED', -300)],
        certificate: { serialNumber: 'EDU-2026-ABC', issuedAt },
      }),
      NOW,
      OPTS,
    );
    expect(view.next).toMatchObject({ kind: 'CERTIFICATE', id: 'e1', moduleId: null, reason: 'NEXT' });
    expect(view.certificate).toMatchObject({ eligible: true, issued: true, serialNumber: 'EDU-2026-ABC', issuedAt: issuedAt.toISOString(), missing: [] });
    expect(view.progress.percent).toBe(100);
  });

  it('нет «жёсткого» порядка: тест модуля можно начать до лекций, лекции не блокируются', () => {
    const view = buildLearnView(input(), NOW, OPTS);
    for (const m of view.version.modules.slice(0, 4)) expect(m.quiz!.canStart).toBe(true);
    expect(view.version.modules[4]!.practicalTask).toMatchObject({ canStart: true, lock: null });
  });
});

describe('практикум', () => {
  it('PASSED + IN_PROGRESS — статус PASSED независимо от порядка строк (детерминизм)', () => {
    const a = [session('s1', 'PASSED', -120), session('s2', 'IN_PROGRESS', -10, 0, 1)];
    const v1 = buildLearnView(input({ sessions: a }), NOW, OPTS).version.modules[4]!.practicalTask!;
    const v2 = buildLearnView(input({ sessions: [...a].reverse() }), NOW, OPTS).version.modules[4]!.practicalTask!;
    expect(v1).toEqual(v2);
    expect(v1).toMatchObject({ status: 'PASSED', canStart: false, final: true, latestSessionId: 's1' });
  });

  it('окно доступности — единственная блокировка: ещё не открыто / закрыто', () => {
    const early = modules();
    early[4]!.practicalTask!.availableFrom = at(3 * HOUR);
    const v1 = buildLearnView(input({ lectureProgress: done(...ALL_LECTURES), attempts: passedQuizzes }, early), NOW, OPTS);
    const p1 = v1.version.modules[4]!.practicalTask!;
    expect(p1.lock).toEqual({ code: 'NOT_YET_AVAILABLE', until: at(3 * HOUR).toISOString() });
    expect(p1.canStart).toBe(false);
    expect(v1.next).toBeNull();

    const late = modules();
    late[4]!.practicalTask!.availableUntil = at(-HOUR);
    const p2 = buildLearnView(input({}, late), NOW, OPTS).version.modules[4]!.practicalTask!;
    expect(p2.lock).toEqual({ code: 'CLOSED', until: null });
    expect(p2.availableUntil).toBe(at(-HOUR).toISOString());
  });

  it('две зачётные сессии без сдачи — финал; сессия без реплик студента не считается', () => {
    const p = buildLearnView(
      input({ sessions: [session('s1', 'FAILED', -500), session('s0', 'ABANDONED', -600, 0), session('s2', 'FAILED', -200)] }),
      NOW,
      OPTS,
    ).version.modules[4]!.practicalTask!;
    expect(p).toMatchObject({ sessionsUsed: 2, final: true, canStart: false, status: 'FAILED', latestSessionId: 's2', remainingAiMessages: null });
  });

  it('тизер сценария: ≤ 240 символов, обрезка по концу предложения, иначе по слову с многоточием', () => {
    const sentence = 'Полисия переживает острый политический кризис после выборов. ';
    const teaser = scenarioTeaser(sentence.repeat(8));
    expect(teaser.length).toBeLessThanOrEqual(240);
    expect(teaser.endsWith('выборов.')).toBe(true);
    const noStops = scenarioTeaser('слово '.repeat(80));
    expect(noStops.length).toBeLessThanOrEqual(240);
    expect(noStops.endsWith('…')).toBe(true);
    expect(scenarioTeaser('  Коротко.  ')).toBe('Коротко.');
  });
});

describe('сертификат: что не хватает по двум правилам', () => {
  const partial = () =>
    input({
      lectureProgress: done(...ALL_LECTURES.filter((id) => id !== 'l1-3' && id !== 'l1-2')),
      attempts: [
        ...passedQuizzes.filter((a) => a.quizId !== 'q2'),
        attempt('q2', -4000, -3990, 0.5, false),
        attempt('q2', -2000, -1990, 0.5, false),
      ],
      sessions: [session('s1', 'FAILED', -900), session('s2', 'FAILED', -600)],
    });

  it('PASS_ALL: недобор лекций по модулю, несданный тест и практикум', () => {
    const view = buildLearnView(partial(), NOW, OPTS);
    expect(view.certificate).toMatchObject({ eligible: false, issued: false, rule: 'PASS_ALL' });
    expect(view.certificate.missing).toEqual([
      { kind: 'LECTURES', moduleOrderIndex: 1, done: 2, total: 4 },
      { kind: 'MODULE_QUIZ', moduleOrderIndex: 2 },
      { kind: 'PRACTICAL', moduleOrderIndex: 4 },
    ]);
  });

  it('COMPLETE_ALL: исчерпанный тест и практикум засчитываются как пройденные; не хватает только лекций', () => {
    const view = buildLearnView(partial(), NOW, { ...OPTS, certRule: 'COMPLETE_ALL' });
    expect(view.certificate.rule).toBe('COMPLETE_ALL');
    expect(view.certificate.missing).toEqual([{ kind: 'LECTURES', moduleOrderIndex: 1, done: 2, total: 4 }]);
    const all = partial();
    all.lectureProgress = done(...ALL_LECTURES);
    const full = buildLearnView(all, NOW, { ...OPTS, certRule: 'COMPLETE_ALL' });
    expect(full.certificate.eligible).toBe(true);
    expect(full.next).toMatchObject({ kind: 'CERTIFICATE' });
    expect(buildLearnView(all, NOW, OPTS).certificate.eligible).toBe(false);
    expect(buildLearnView(all, NOW, OPTS).next).toBeNull();
  });
});

describe('навигация и сводка', () => {
  it('учебный путь: лекции → тест модуля после последней лекции I–IV → практикум в конце V', () => {
    const seq = buildSequence(buildLearnView(input(), NOW, OPTS));
    expect(seq).toHaveLength(15 + 4 + 1);
    expect(seq.slice(2, 5).map((i) => [i.kind, i.id])).toEqual([['LECTURE', 'l0-2'], ['MODULE_QUIZ', 'q0'], ['LECTURE', 'l1-0']]);
    expect(seq.at(-1)).toMatchObject({ kind: 'PRACTICAL', id: 'p1', moduleOrderIndex: 4 });
  });

  it('соседи лекции через границу модуля', () => {
    const view = buildLearnView(input(), NOW, OPTS);
    expect(lectureNeighbors(view, 'l0-0')).toEqual({ prev: null, next: { kind: 'LECTURE', id: 'l0-1', title: 'Лекция 0.1', moduleOrderIndex: 0, lectureNumber: 2 } });
    expect(lectureNeighbors(view, 'l0-2').next).toMatchObject({ kind: 'MODULE_QUIZ', id: 'q0', moduleOrderIndex: 0 });
    expect(lectureNeighbors(view, 'l1-0').prev).toMatchObject({ kind: 'MODULE_QUIZ', id: 'q0' });
    expect(lectureNeighbors(view, 'l4-1').next).toMatchObject({ kind: 'PRACTICAL', id: 'p1' });
    expect(lectureNeighbors(view, 'unknown')).toEqual({ prev: null, next: null });
  });

  it('положение лекции: номер в модуле (с 1), всего лекций', () => {
    const view = buildLearnView(input(), NOW, OPTS);
    const place = locateLecture(view, 'l1-2')!;
    expect(place.indexInModule).toBe(3);
    expect(place.lecturesTotal).toBe(15);
    expect(place.module.id).toBe('m1');
    expect(place.lecture.lectureNumber).toBe(6);
  });

  it('сводка «Мои курсы»: счётчики, блокировка языка, сертификат', () => {
    const view = buildLearnView(input({ languageLock: { locked: true, reason: 'PRACTICAL_REPLY' } }), NOW, OPTS);
    const summary = buildCourseSummary(view, 'PUBLISHED');
    expect(summary.counts).toEqual({ modules: 5, lectures: 15, durationSec: 15 * 1200 });
    expect(summary).toMatchObject({ languageVersionStatus: 'PUBLISHED', languageLocked: true, next: { id: 'l0-0' } });
    expect(view.enrollment).toMatchObject({ languageLocked: true, languageLockReason: 'PRACTICAL_REPLY' });
    const noDur = buildCourseSummary(buildLearnView(input({}, modules({ durations: false })), NOW, OPTS), 'PUBLISHED');
    expect(noDur.counts.durationSec).toBeNull();
  });
});
