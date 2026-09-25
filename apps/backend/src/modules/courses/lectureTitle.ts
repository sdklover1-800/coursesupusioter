/**
 * Проверка и очистка названий лекций (FR-2.9). Название видно публично — в каталоге
 * курсов (программа курса), поэтому служебная «шапка» исходного .docx, склеившаяся
 * с названием при импорте («…Research MethodsCourse: Introduction… Video length:
 * ~20 minutes Format: video lecture…»), не должна попадать в опубликованную версию.
 * Чистые функции — покрыты unit-тестами (lectureTitle.test.ts).
 */

/** Макс. длина названия лекции: длиннее — почти наверняка склеенные метаданные. */
export const LECTURE_TITLE_MAX = 180;

// Метки служебных строк шапки (ru/kk/en). С учётом регистра: в шапке они с заглавной,
// а обычная фраза вроде «введение в курс: цели» не должна считаться метаданными.
const METADATA_MARKER =
  /(?:Course|Video length|Video duration|Duration|Format|Курс|Длительность видео|Длительность|Хронометраж|Формат|Бейне ұзақтығы|Ұзақтығы|Пішімі)\s*:/u;

/** Позиция начала склеенных метаданных (не в самом начале названия) или -1. */
function metadataIndex(title: string): number {
  const m = METADATA_MARKER.exec(title);
  return m && m.index > 0 ? m.index : -1;
}

/** Почему название нельзя публиковать; null — всё в порядке. */
export function lectureTitleProblem(title: string): string | null {
  if (metadataIndex(title) !== -1) return 'в названии служебные метаданные («Course:», «Format:»…) — оставьте только название';
  if (title.trim().length > LECTURE_TITLE_MAX) return `название длиннее ${LECTURE_TITLE_MAX} символов`;
  return null;
}

/** Название без склеенных метаданных (идемпотентно; чистое название не меняется). */
export function cleanLectureTitle(title: string): string {
  const i = metadataIndex(title);
  const head = i === -1 ? title : title.slice(0, i);
  return head.replace(/[\s,;:–—-]+$/u, '').trim();
}
