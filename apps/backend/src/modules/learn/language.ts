import type { Prisma } from '@prisma/client';
import type { LanguageLockReason } from '@edu/shared';

/**
 * Язык прохождения курса (USER_DECISIONS §3, FR-3.4).
 * Язык ЗАКРЕПЛЯЕТСЯ после первой оцениваемой активности: первой попытки
 * оцениваемого теста (отправленной или в процессе) или первой реплики студента
 * в практикуме. До этого студент может сменить язык — пройденные лекции
 * переносятся на параллельные лекции другой версии. Блокировка не хранится,
 * а вычисляется по активности. env LANGUAGE_LOCK=never — смена всегда разрешена.
 */

export type LanguageLockMode = 'after_first_graded' | 'never';

export interface LanguageLockState {
  locked: boolean;
  reason: LanguageLockReason | null;
}

const UNLOCKED: LanguageLockState = { locked: false, reason: null };

/** Чистое правило по фактам активности (общее для одиночной и пакетной проверки). */
export function lockFromActivity(
  activity: { gradedAttempt: boolean; practicalReply: boolean },
  mode: LanguageLockMode,
): LanguageLockState {
  if (mode === 'never') return UNLOCKED;
  if (activity.gradedAttempt) return { locked: true, reason: 'GRADED_QUIZ' };
  if (activity.practicalReply) return { locked: true, reason: 'PRACTICAL_REPLY' };
  return UNLOCKED;
}

/** Клиент БД или транзакция — нужны только попытки и реплики. */
export type LanguageLockDb = Pick<Prisma.TransactionClient, 'quizAttempt' | 'chatMessage'>;

/**
 * Закреплён ли язык записи. Любая попытка оцениваемого теста (isGraded) этой записи —
 * GRADED_QUIZ; иначе любая реплика студента (ChatMessage STUDENT) в её сессиях — PRACTICAL_REPLY.
 */
export async function languageLockState(db: LanguageLockDb, enrollmentId: string, mode: LanguageLockMode): Promise<LanguageLockState> {
  if (mode === 'never') return UNLOCKED;
  const attempt = await db.quizAttempt.findFirst({ where: { enrollmentId, quiz: { isGraded: true } }, select: { id: true } });
  if (attempt) return lockFromActivity({ gradedAttempt: true, practicalReply: false }, mode);
  const reply = await db.chatMessage.findFirst({ where: { role: 'STUDENT', session: { enrollmentId } }, select: { id: true } });
  return lockFromActivity({ gradedAttempt: false, practicalReply: !!reply }, mode);
}

/** Модуль с лекциями — вход сопоставления параллельных версий. */
export interface ParallelModule {
  orderIndex: number;
  lectures: { id: string; orderIndex: number }[];
}

/**
 * Параллельные лекции двух языковых версий: сопоставление по
 * (module.orderIndex, lecture.orderIndex). Результат: id лекции «откуда» → id «куда».
 * Лекции без пары (разная структура версий) в карту не попадают.
 */
export function matchParallelLectures(from: readonly ParallelModule[], to: readonly ParallelModule[]): Map<string, string> {
  const target = new Map<string, string>();
  for (const m of to) for (const l of m.lectures) target.set(`${m.orderIndex}:${l.orderIndex}`, l.id);
  const result = new Map<string, string>();
  for (const m of from) {
    for (const l of m.lectures) {
      const pair = target.get(`${m.orderIndex}:${l.orderIndex}`);
      if (pair) result.set(l.id, pair);
    }
  }
  return result;
}
