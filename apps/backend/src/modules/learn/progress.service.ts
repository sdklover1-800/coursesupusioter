import type { Prisma } from '@prisma/client';
import { ADMITTED_ENROLLMENT_STATUSES, type Language, type LearnView, type ReviewPolicy, type ScoringRule } from '@edu/shared';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { issueCertificateIfAbsent } from '../certificates/certificate.service.js';
import { isAdmitted } from '../enrollments/policy.js';
import { buildLearnView, type LearnInput, type LearnViewOptions } from './learn.view.js';
import { lockFromActivity } from './language.js';

/** Параметры карты курса из окружения (правило сертификата, пауза теста по умолчанию). */
export function learnViewOptions(): LearnViewOptions {
  return { certRule: env.CERT_RULE, cooldownDefaultMinutes: env.QUIZ_COOLDOWN_MINUTES };
}

const activeQuestions = { where: { archivedAt: null } } as const;

/**
 * Структура версии для карты курса: только поля, видимые студенту (без эталона и
 * рубрики практикума, без вопросов тестов — лишь число НЕархивных вопросов).
 */
export const learnVersionSelect = {
  id: true,
  courseId: true,
  title: true,
  language: true,
  description: true,
  status: true,
  finalMiniQuiz: { select: { id: true } },
  modules: {
    orderBy: { orderIndex: 'asc' },
    select: {
      id: true,
      title: true,
      orderIndex: true,
      assessmentType: true,
      coversWholeCourse: true,
      lectures: {
        orderBy: { orderIndex: 'asc' },
        select: {
          id: true,
          title: true,
          orderIndex: true,
          youtubeVideoId: true,
          durationSec: true,
          summary: true,
          miniQuiz: { select: { id: true, _count: { select: { questions: activeQuestions } } } },
        },
      },
      quiz: {
        select: {
          id: true,
          title: true,
          passThreshold: true,
          maxAttempts: true,
          reviewPolicy: true,
          scoringRule: true,
          cooldownMinutes: true,
          _count: { select: { questions: activeQuestions } },
        },
      },
      practicalTask: {
        select: {
          id: true,
          title: true,
          scenarioPrompt: true,
          maxAiMessages: true,
          maxSessions: true,
          estimatedMinutes: true,
          availableFrom: true,
          availableUntil: true,
        },
      },
    },
  },
} satisfies Prisma.CourseLanguageVersionSelect;

type VersionRow = Prisma.CourseLanguageVersionGetPayload<{ select: typeof learnVersionSelect }>;

function toInputVersion(v: VersionRow): LearnInput['version'] {
  return {
    id: v.id,
    title: v.title,
    language: v.language as Language,
    description: v.description,
    finalMiniQuizId: v.finalMiniQuiz?.id ?? null,
    modules: v.modules.map((m) => ({
      id: m.id,
      title: m.title,
      orderIndex: m.orderIndex,
      assessmentType: m.assessmentType,
      coversWholeCourse: m.coversWholeCourse,
      lectures: m.lectures.map((l) => ({
        id: l.id,
        title: l.title,
        orderIndex: l.orderIndex,
        youtubeVideoId: l.youtubeVideoId,
        durationSec: l.durationSec,
        summary: l.summary,
        miniQuizId: l.miniQuiz?.id ?? null,
        miniQuestionCount: l.miniQuiz?._count.questions ?? 0,
      })),
      quiz: m.quiz
        ? {
            id: m.quiz.id,
            title: m.quiz.title,
            passThreshold: m.quiz.passThreshold,
            maxAttempts: m.quiz.maxAttempts,
            reviewPolicy: m.quiz.reviewPolicy as ReviewPolicy,
            scoringRule: m.quiz.scoringRule as ScoringRule,
            cooldownMinutes: m.quiz.cooldownMinutes,
            questionCount: m.quiz._count.questions,
          }
        : null,
      practicalTask: m.practicalTask,
    })),
  };
}

/**
 * Пакетная загрузка данных карты курса для нескольких записей — фиксированное число
 * запросов независимо от числа записей и лекций (без N+1): записи, версии, языки,
 * прогресс лекций, попытки, сессии, счётчики реплик студента.
 * activity=false — без попыток/сессий (для страницы лекции: нужна лишь структура и прогресс).
 */
export async function loadLearnInputs(enrollmentIds: readonly string[], opts: { activity?: boolean } = {}): Promise<Map<string, LearnInput>> {
  const ids = [...new Set(enrollmentIds)];
  const result = new Map<string, LearnInput>();
  if (!ids.length) return result;
  const withActivity = opts.activity !== false;

  const enrollments = await prisma.enrollment.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      courseId: true,
      status: true,
      progressPercent: true,
      languageVersionId: true,
      lastLectureId: true,
      certificate: { select: { serialNumber: true, issuedAt: true } },
    },
  });
  if (!enrollments.length) return result;
  const versionIds = [...new Set(enrollments.map((e) => e.languageVersionId))];
  const courseIds = [...new Set(enrollments.map((e) => e.courseId))];

  const [versions, languages, progress, attempts, sessions] = await Promise.all([
    prisma.courseLanguageVersion.findMany({ where: { id: { in: versionIds } }, select: learnVersionSelect }),
    prisma.courseLanguageVersion.findMany({
      where: { courseId: { in: courseIds }, status: 'PUBLISHED' },
      select: { id: true, courseId: true, language: true, title: true },
      orderBy: { language: 'asc' },
    }),
    prisma.lectureProgress.findMany({
      where: { enrollmentId: { in: ids } },
      select: { enrollmentId: true, lectureId: true, isCompleted: true, positionSec: true, watchedSec: true },
    }),
    withActivity
      ? prisma.quizAttempt.findMany({
          where: { enrollmentId: { in: ids } },
          select: { id: true, enrollmentId: true, quizId: true, startedAt: true, submittedAt: true, score: true, passed: true, quiz: { select: { isGraded: true } } },
        })
      : Promise.resolve([]),
    withActivity
      ? prisma.practicalSession.findMany({
          where: { enrollmentId: { in: ids } },
          select: {
            id: true, enrollmentId: true, practicalTaskId: true, status: true, startedAt: true, endedAt: true,
            aiMessageCount: true, maxAiMessages: true, excusedAt: true,
          },
        })
      : Promise.resolve([]),
  ]);

  // Реплики СТУДЕНТА по сессиям — одним groupBy (засчитанная попытка A7 + блокировка языка).
  const replyCounts = new Map<string, number>();
  if (sessions.length) {
    const rows = await prisma.chatMessage.groupBy({
      by: ['sessionId'],
      where: { sessionId: { in: sessions.map((s) => s.id) }, role: 'STUDENT' },
      _count: { _all: true },
    });
    for (const r of rows) replyCounts.set(r.sessionId, r._count._all);
  }

  const versionById = new Map(versions.map((v) => [v.id, toInputVersion(v)]));
  const group = <T extends { enrollmentId: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const r of rows) {
      const list = map.get(r.enrollmentId) ?? [];
      list.push(r);
      map.set(r.enrollmentId, list);
    }
    return map;
  };
  const progressBy = group(progress);
  const attemptsBy = group(attempts);
  const sessionsBy = group(sessions);

  for (const e of enrollments) {
    const version = versionById.get(e.languageVersionId);
    if (!version) continue;
    const eAttempts = attemptsBy.get(e.id) ?? [];
    const eSessions = (sessionsBy.get(e.id) ?? []).map((s) => ({ ...s, userMessageCount: replyCounts.get(s.id) ?? 0 }));
    result.set(e.id, {
      enrollment: {
        id: e.id,
        status: e.status,
        progressPercent: e.progressPercent,
        languageVersionId: e.languageVersionId,
        lastLectureId: e.lastLectureId,
      },
      version,
      availableLanguages: languages
        .filter((l) => l.courseId === e.courseId)
        .map((l) => ({ id: l.id, language: l.language as Language, title: l.title })),
      lectureProgress: progressBy.get(e.id) ?? [],
      attempts: eAttempts,
      sessions: eSessions,
      certificate: e.certificate,
      // Блокировка языка (USER_DECISIONS §3) — из уже загруженной активности, без запросов
      languageLock: withActivity
        ? lockFromActivity(
            {
              gradedAttempt: eAttempts.some((a) => a.quiz.isGraded),
              practicalReply: eSessions.some((s) => s.userMessageCount > 0),
            },
            env.LANGUAGE_LOCK,
          )
        : { locked: false, reason: null },
    });
  }
  return result;
}

/** Данные карты курса одной записи (null — записи нет). */
export async function loadLearnInput(enrollmentId: string, opts: { activity?: boolean } = {}): Promise<LearnInput | null> {
  return (await loadLearnInputs([enrollmentId], opts)).get(enrollmentId) ?? null;
}

/**
 * Пересчёт с картой курса (для ответа POST /lectures/:id/complete).
 * Правило завершения — то же, что у карты (certificateStatus по env CERT_RULE):
 *  - оценки и зачёт — только по ОТПРАВЛЕННЫМ попыткам (quizAttemptState);
 *  - COMPLETED с выданным сертификатом НИКОГДА не понижается;
 *  - completedAt ставится один раз (не перезаписывается при каждом пересчёте).
 */
export async function recomputeProgressWithView(
  enrollmentId: string,
): Promise<{ percent: number; completed: boolean; view: LearnView | null }> {
  const e = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { status: true, progressPercent: true, completedAt: true, certificate: { select: { id: true } } },
  });
  if (!e) return { percent: 0, completed: false, view: null };
  // Неодобренная заявка (PENDING/REJECTED/WITHDRAWN): статус НЕ трогаем — иначе
  // пересчёт (напр. после смены языка заявки) перевёл бы её в ACTIVE и открыл
  // доступ к контенту в обход решения менеджера; сертификат тоже не выдаём.
  if (!isAdmitted(e.status)) return { percent: e.progressPercent, completed: false, view: null };

  const input = await loadLearnInput(enrollmentId);
  if (!input) return { percent: e.progressPercent, completed: false, view: null };
  const view = buildLearnView(input, new Date(), learnViewOptions());
  const percent = view.progress.percent;
  const keepCompleted = e.status === 'COMPLETED' && !!e.certificate;
  const completed = view.certificate.eligible || keepCompleted;

  // Условие по допуску: запись могли параллельно отозвать — не «воскрешаем» её.
  await prisma.enrollment.updateMany({
    where: { id: enrollmentId, status: { in: [...ADMITTED_ENROLLMENT_STATUSES] } },
    data: {
      progressPercent: percent,
      status: completed ? 'COMPLETED' : 'ACTIVE',
      completedAt: completed ? (e.completedAt ?? new Date()) : null,
    },
  });

  if (completed) {
    await issueCertificateIfAbsent(enrollmentId); // FR-9.1
    const cert = await prisma.certificate.findUnique({ where: { enrollmentId }, select: { serialNumber: true, issuedAt: true } });
    if (cert) {
      view.certificate = { ...view.certificate, issued: true, serialNumber: cert.serialNumber, issuedAt: cert.issuedAt.toISOString() };
      if (!view.next) view.next = { kind: 'CERTIFICATE', id: enrollmentId, title: view.version.title, moduleId: null, moduleOrderIndex: null, reason: 'NEXT' };
    }
  }
  view.enrollment.status = completed ? 'COMPLETED' : 'ACTIVE';
  return { percent, completed, view };
}

/**
 * Пересчёт прогресса записи на курс (FR-8.2, FR-8.3) и выдача сертификата (FR-9.1).
 * Сигнатура стабильна: вызывается из тестов (BE2) и практикума (BE3).
 */
export async function recomputeProgress(enrollmentId: string): Promise<{ percent: number; completed: boolean }> {
  const { percent, completed } = await recomputeProgressWithView(enrollmentId);
  return { percent, completed };
}
