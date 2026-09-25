import type { RubricCriterion } from '@edu/shared';

/**
 * ЕДИНЫЕ карты тонов (design_direction §1): один источник для ролей, условий
 * эксперимента, статуса публикации, отметок ИИ/правка и измерений рубрики.
 * Страницы не заводят свои локальные карты — берут отсюда.
 *
 * Роли цвета: ink — оценивание/хром/полномочия, brand — действие и выбор,
 * spark — тьютор/ИИ-помощь, teal — успех, danger — ошибка, muted — нейтрально.
 */
export type Tone = 'brand' | 'ink' | 'spark' | 'teal' | 'danger' | 'muted';

/** Классы по тону: badge — тонированная плашка (*-ink текст), fill — заливка полос/точек, text — текст. */
export const toneClasses: Record<Tone, { badge: string; fill: string; text: string; soft: string }> = {
  brand: { badge: 'bg-brand-soft text-brand', fill: 'bg-brand', text: 'text-brand', soft: 'bg-brand-soft' },
  // «Чернильный» в тёмной теме почти сливается с фоном — заливки берут fg, плашка получает обводку
  ink: { badge: 'bg-ink text-white dark:ring-1 dark:ring-inset dark:ring-border-strong', fill: 'bg-ink dark:bg-fg', text: 'text-fg', soft: 'bg-ink/8' },
  spark: { badge: 'bg-spark/15 text-spark-ink', fill: 'bg-spark', text: 'text-spark-ink', soft: 'bg-spark/15' },
  teal: { badge: 'bg-teal/12 text-teal-ink', fill: 'bg-teal', text: 'text-teal-ink', soft: 'bg-teal/12' },
  danger: { badge: 'bg-danger/12 text-danger-ink', fill: 'bg-danger', text: 'text-danger-ink', soft: 'bg-danger/12' },
  // Нейтральный статус — текст fg-2 (§12: статусы и мета не бледнее fg-2; muted — только необязательные подсказки)
  muted: { badge: 'bg-border/60 text-fg-2', fill: 'bg-muted', text: 'text-fg-2', soft: 'bg-border/60' },
};

/** Роли пользователей. */
export const roleTone: Record<string, Tone> = {
  STUDENT: 'muted',
  COURSE_MANAGER: 'brand',
  ADMIN: 'ink',
};

/** Условия эксперимента когорт (подписи — только t('conditions.*')). */
export const conditionTone: Record<string, Tone> = {
  AI_ASSISTED: 'spark',
  WITH_TEACHER: 'brand',
  CONTROL: 'muted',
};

/** Статус публикации курса/языковой версии. */
export const publishStatusTone: Record<string, Tone> = {
  DRAFT: 'muted',
  PUBLISHED: 'teal',
  ARCHIVED: 'ink',
};

/** Отметки происхождения контента: сгенерировано ИИ / отредактировано человеком. */
export const authorshipTone: Record<'ai' | 'edited', Tone> = {
  ai: 'brand',
  edited: 'muted',
};

/** Статус жалобы на контент. */
export const issueStatusTone: Record<string, Tone> = {
  OPEN: 'spark',
  RESOLVED: 'teal',
  DISMISSED: 'muted',
};

/** Измерения рубрики хода рассуждений (§5.5) — фиксированные цвета во всех графиках. */
export const rubricTone: Record<RubricCriterion, Tone> = {
  methodicalness: 'brand',
  question_quality: 'spark',
  logical_progression: 'teal',
  self_correction: 'ink',
};

/** Порядок измерений рубрики в интерфейсе. */
export const RUBRIC_ORDER: RubricCriterion[] = ['methodicalness', 'question_quality', 'logical_progression', 'self_correction'];

/** Тон по ключу с запасным вариантом (неизвестное значение → muted). */
export function toneOf(map: Record<string, Tone>, key: string | null | undefined, fallback: Tone = 'muted'): Tone {
  return (key && map[key]) || fallback;
}

/** Все карты одним объектом: tones.role.ADMIN, tones.rubric.methodicalness … */
export const tones = {
  role: roleTone,
  condition: conditionTone,
  publishStatus: publishStatusTone,
  authorship: authorshipTone,
  issueStatus: issueStatusTone,
  rubric: rubricTone,
  classes: toneClasses,
} as const;
