/**
 * Общие подписи и правила отображения учебного пути (FE1): римские номера модулей,
 * короткие имена элементов, ссылки «Продолжить», статусы тестов/практикума, правило
 * сертификата и список недостающего. Только чистые функции от t() — без запросов.
 *
 * Порядок изучения свободный (USER_DECISIONS §3): «заблокировано» бывает только окно
 * практикума (lock), всё прочее — лишь рекомендация next.
 */
import type { TFunction } from 'i18next';
import { PLACEHOLDER_VIDEO_ID } from '@edu/shared';
import type {
  CertificateMissing, CertificateStatus, LearnModule, LearnModuleQuiz, LearnPractical, NextItem,
} from '../../lib/learn';
import { routes } from '../../lib/learn';
import type { StatusState } from '../ui';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** 0 → I, 1 → II … (номер модуля по orderIndex; за пределами таблицы — арабская цифра). */
export function romanOf(orderIndex: number | null | undefined): string {
  if (orderIndex === null || orderIndex === undefined || orderIndex < 0) return '';
  return ROMAN[orderIndex] ?? String(orderIndex + 1);
}

/** Диапазон модулей «I–IV» по списку индексов (по порядку). Один — «II», пусто — ''. */
export function romanRange(indexes: number[]): string {
  const sorted = [...indexes].sort((a, b) => a - b);
  if (!sorted.length) return '';
  const first = romanOf(sorted[0]);
  const last = romanOf(sorted[sorted.length - 1]);
  return first === last ? first : `${first}–${last}`;
}

/**
 * Заголовки лекций в контенте начинаются с номера («7. Политические режимы…»):
 * рядом с нашим номером «Лекция 7» он дублируется — убираем ведущий «7.»/«7)».
 */
export function cleanTitle(title: string | null | undefined): string {
  return (title ?? '').replace(/^\s*\d{1,3}\s*[.)]\s+/, '').trim();
}

/** Превью YouTube (hqdefault) или null для заглушки/пустого id. */
export function ytThumb(videoId: string | null | undefined): string | null {
  if (!videoId || videoId === PLACEHOLDER_VIDEO_ID || !/^[\w-]{6,20}$/.test(videoId)) return null;
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** Название языка обучения: «Русский» / «Қазақша» / «English». */
export function languageName(t: TFunction, lang: string | null | undefined): string {
  return lang ? t(`languages.${lang}`, { defaultValue: lang.toUpperCase() }) : '';
}

/** Балл 0..1 (или уже проценты) → «83%». */
export function scorePercent(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return '—';
  const v = score <= 1 ? score * 100 : score;
  return `${Math.round(v)}%`;
}

/** Короткое имя элемента: «Лекция 7», «Модульный тест II», «Итоговый практикум». */
export function itemShortName(t: TFunction, item: Pick<NextItem, 'kind' | 'lectureNumber' | 'moduleOrderIndex'>): string {
  switch (item.kind) {
    case 'LECTURE':
      return t('course.itemName.LECTURE', { n: item.lectureNumber ?? '' });
    case 'MODULE_QUIZ':
      return t('course.itemName.MODULE_QUIZ', { roman: romanOf(item.moduleOrderIndex) });
    case 'PRACTICAL':
      return t('course.itemName.PRACTICAL');
    case 'CERTIFICATE':
      return t('course.itemName.CERTIFICATE');
    default:
      return t(`ui.kind.${item.kind}`);
  }
}

/** Имя для кнопки «Продолжить: …»: у лекции — «Лекция 7 — Политические режимы». */
export function itemLongName(t: TFunction, item: NextItem): string {
  const short = itemShortName(t, item);
  if (item.kind === 'LECTURE') {
    const title = cleanTitle(item.title);
    return title ? `${short} — ${title}` : short;
  }
  return short;
}

/**
 * Ссылка на рекомендуемый шаг: лекция — с ?t= (возобновление), тест — лобби,
 * практикум — бриф/диалог, сертификат — раздел «Сертификаты».
 */
export function nextHref(courseId: string, enrollmentId: string, item: NextItem): string {
  switch (item.kind) {
    case 'LECTURE':
      return routes.lecture(courseId, enrollmentId, item.id, item.positionSec && item.positionSec > 0 ? { t: item.positionSec } : {});
    case 'MODULE_QUIZ':
      return routes.quiz(courseId, enrollmentId, item.id);
    case 'PRACTICAL':
      return routes.practical(courseId, enrollmentId, item.id);
    case 'CERTIFICATE':
      return routes.certificates();
    default:
      return routes.course(courseId, enrollmentId);
  }
}

/* ── Статусы оцениваний ─────────────────────────────────────────────── */

/** Пауза между попытками ещё идёт (USER_DECISIONS §1). */
export function quizInCooldown(q: Pick<LearnModuleQuiz, 'cooldownUntil' | 'passed' | 'finalReached'>, now = Date.now()): boolean {
  if (!q.cooldownUntil || q.passed || q.finalReached) return false;
  const until = new Date(q.cooldownUntil).getTime();
  return Number.isFinite(until) && until > now;
}

/** Состояние теста для карты: попытки есть, но не сдан и не исчерпан — «ATTEMPTED». */
export type QuizMapState = 'NOT_STARTED' | 'ATTEMPTED' | 'IN_PROGRESS' | 'PASSED' | 'FAILED';
export function quizMapState(q: LearnModuleQuiz): QuizMapState {
  if (q.passed) return 'PASSED';
  if (q.inProgressAttemptId) return 'IN_PROGRESS';
  if (q.finalReached) return 'FAILED';
  if ((q.attemptsUsed ?? 0) > 0) return 'ATTEMPTED';
  return 'NOT_STARTED';
}

/** Строка статуса теста + глиф: «Не начат» / «Не сдан · осталась 1 попытка» / «Сдан · 83%». */
export function quizStatus(t: TFunction, q: LearnModuleQuiz): { state: StatusState; text: string } {
  const s = quizMapState(q);
  switch (s) {
    case 'PASSED':
      return { state: 'PASSED', text: t('course.quiz.status.passed', { score: scorePercent(q.countedScore ?? q.bestScore) }) };
    case 'IN_PROGRESS':
      return { state: 'IN_PROGRESS', text: t('course.quiz.status.inProgress', { n: q.attemptsUsed || 1 }) };
    case 'FAILED':
      return { state: 'FAILED', text: t('course.quiz.status.exhausted') };
    case 'ATTEMPTED':
      return { state: 'IN_PROGRESS', text: t('course.quiz.status.failedLeft', { count: q.attemptsLeft }) };
    default:
      return { state: 'NOT_STARTED', text: t('course.quiz.status.notStarted') };
  }
}

/** Состояние практикума для карты. */
export type PracticalMapState = 'NOT_STARTED' | 'IN_PROGRESS' | 'ATTEMPTED' | 'PASSED' | 'FAILED' | 'LOCKED';
export function practicalMapState(p: LearnPractical): PracticalMapState {
  if (p.status === 'PASSED') return 'PASSED';
  if (p.activeSessionId || p.status === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (p.lock) return 'LOCKED';
  if (p.status === 'FAILED') return p.final ? 'FAILED' : 'ATTEMPTED';
  return 'NOT_STARTED';
}

/** Строка статуса практикума: «Попытка 1 из 2 · осталось 5 ответов» / «Сдан» / … */
export function practicalStatus(t: TFunction, p: LearnPractical): { state: StatusState; text: string } {
  const max = p.maxSessions || 2;
  switch (practicalMapState(p)) {
    case 'PASSED':
      return { state: 'PASSED', text: t('course.practical.status.passed') };
    case 'IN_PROGRESS': {
      const k = Math.min(max, (p.sessionsUsed ?? 0) + 1);
      return p.remainingAiMessages !== null && p.remainingAiMessages !== undefined
        ? { state: 'IN_PROGRESS', text: t('course.practical.status.inProgress', { k, max, count: p.remainingAiMessages }) }
        : { state: 'IN_PROGRESS', text: t('course.practical.status.attempt', { k, max }) };
    }
    case 'FAILED':
      return { state: 'FAILED', text: t('course.practical.status.exhausted') };
    case 'ATTEMPTED':
      return { state: 'IN_PROGRESS', text: t('course.practical.status.failedLeft', { count: Math.max(0, max - (p.sessionsUsed ?? 0)) }) };
    case 'LOCKED':
      return { state: 'LOCKED', text: '' };
    default:
      return { state: 'NOT_STARTED', text: t('course.practical.status.notStarted', { count: max }) };
  }
}

/* ── Сертификат ─────────────────────────────────────────────────────── */

/** Строка недостающего: «Лекции модуля II · 0 из 4», «Модульный тест I», «Итоговый практикум». */
export function missingLabel(t: TFunction, m: CertificateMissing): string {
  const roman = romanOf(m.moduleOrderIndex);
  if (m.kind === 'LECTURES') return t('course.certificate.missing.LECTURES', { roman, done: m.done ?? 0, total: m.total ?? 0 });
  if (m.kind === 'MODULE_QUIZ') return t('course.certificate.missing.MODULE_QUIZ', { roman });
  return t('course.certificate.missing.PRACTICAL');
}

/**
 * Правило сертификата одной фразой (edX/FutureLearn — правило заранее):
 * PASS_ALL — «Пройдите 15 лекций, сдайте модульные тесты I–IV и итоговый практикум»;
 * COMPLETE_ALL — «Пройдите все лекции и выполните все оценивания».
 */
export function certificateRule(
  t: TFunction,
  rule: CertificateStatus['rule'] | undefined,
  facts: { lectures: number; quizModuleIndexes: number[]; hasPractical: boolean },
): string {
  if (rule === 'COMPLETE_ALL') return t('course.certificate.ruleCompleteAll');
  const lectures = t('course.count.lecturesAcc', { count: facts.lectures });
  const range = romanRange(facts.quizModuleIndexes);
  if (!range) return t('course.certificate.rulePassAllOnlyLectures', { lectures });
  return facts.hasPractical
    ? t('course.certificate.rulePassAll', { lectures, range })
    : t('course.certificate.rulePassAllNoPractical', { lectures, range });
}

/** Факты для правила сертификата из модулей карты курса. */
export function certificateFacts(modules: Pick<LearnModule, 'orderIndex' | 'lectures' | 'quiz' | 'practicalTask'>[]) {
  return {
    lectures: modules.reduce((n, m) => n + m.lectures.length, 0),
    quizModuleIndexes: modules.filter((m) => m.quiz).map((m) => m.orderIndex),
    hasPractical: modules.some((m) => m.practicalTask),
  };
}

/** Модуль завершён: все лекции пройдены и оценивание модуля закрыто (сдано или исчерпано). */
export function moduleCompleted(m: LearnModule): boolean {
  const lecturesDone = m.lectures.every((l) => l.completed);
  const quizDone = !m.quiz || m.quiz.passed || m.quiz.finalReached;
  const practicalDone = !m.practicalTask || m.practicalTask.status === 'PASSED' || m.practicalTask.final;
  return lecturesDone && quizDone && practicalDone && m.lectures.length > 0;
}

/** Сумма длительностей (null, если хотя бы одна неизвестна). */
export function totalDuration(modules: Pick<LearnModule, 'durationSec'>[]): number | null {
  let sum = 0;
  for (const m of modules) {
    if (m.durationSec === null || m.durationSec === undefined) return null;
    sum += m.durationSec;
  }
  return modules.length ? sum : null;
}

/** Оставшееся время паузы: «23 ч 41 мин» (без «≈»). Меньше минуты → null. */
export function humanLeft(ms: number, lng: string): string | null {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 1) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const u = lng === 'kk' ? { h: 'сағ', m: 'мин' } : lng === 'en' ? { h: 'h', m: 'min' } : { h: 'ч', m: 'мин' };
  return [h > 0 ? `${h} ${u.h}` : '', m > 0 ? `${m} ${u.m}` : ''].filter(Boolean).join(' ');
}

/**
 * Заголовок модуля без префикса «Раздел I.» / «I бөлім.» / «Section I.» — там, где рядом
 * уже стоит римская цифра (карта курса, программа). Если префикса нет — как есть.
 */
export function cleanModuleTitle(title: string | null | undefined): string {
  const s = (title ?? '').trim();
  const cleaned = s.replace(/^(?:(?:Раздел|Модуль|Section|Module)\s+[IVXLC\d]+|[IVXLC\d]+\s*(?:бөлім|модуль|-бөлім))\s*[.:]?\s*/i, '');
  return cleaned || s;
}
