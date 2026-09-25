import type { Prisma } from '@prisma/client';
import {
  AssessmentType,
  LANGUAGES,
  type CatalogCourseDetail,
  type CatalogCourseSummary,
} from '@edu/shared';

/**
 * Публичный каталог курсов: выборки и отображение в DTO.
 * Безопасность: и select (БД), и маппинг (API) — явные белые списки. Видео
 * (youtubeVideoId), расшифровки, тесты/вопросы и скрытые части практического
 * задания (сценарий, эталон, рубрика) в каталог не попадают НИКОГДА.
 */

const published = { status: 'PUBLISHED' as const };

/** Выборка для карточек каталога (GET /catalog). */
export const catalogListSelect = {
  id: true,
  defaultLanguage: true,
  languageVersions: {
    where: published,
    select: {
      id: true,
      language: true,
      title: true,
      description: true,
      modules: { select: { assessmentType: true, _count: { select: { lectures: true } } } },
    },
  },
} satisfies Prisma.CourseSelect;

/** Выборка для страницы курса (GET /catalog/:courseId) — программа без контента. */
export const catalogDetailSelect = {
  id: true,
  defaultLanguage: true,
  languageVersions: {
    where: published,
    select: {
      id: true,
      language: true,
      title: true,
      description: true,
      modules: {
        orderBy: { orderIndex: 'asc' },
        select: {
          id: true,
          orderIndex: true,
          title: true,
          assessmentType: true,
          lectures: { orderBy: { orderIndex: 'asc' }, select: { id: true, orderIndex: true, title: true } },
        },
      },
    },
  },
} satisfies Prisma.CourseSelect;

/** Курс виден в каталоге, если у него есть хотя бы одна опубликованная версия. */
export const hasPublishedVersion = { languageVersions: { some: published } } satisfies Prisma.CourseWhereInput;

/**
 * Порядок версий: сначала базовый язык курса (клиент берёт первую как fallback,
 * если нет версии на языке интерфейса), затем — по перечню LANGUAGES.
 */
export function sortVersions<V extends { language: string }>(versions: V[], defaultLanguage: string): V[] {
  const rank = (lang: string) => {
    if (lang === defaultLanguage) return -1;
    const i = (LANGUAGES as readonly string[]).indexOf(lang);
    return i === -1 ? LANGUAGES.length : i;
  };
  return [...versions].sort((a, b) => rank(a.language) - rank(b.language));
}

type ListRow = Prisma.CourseGetPayload<{ select: typeof catalogListSelect }>;
type DetailRow = Prisma.CourseGetPayload<{ select: typeof catalogDetailSelect }>;

export function toCatalogSummary(course: ListRow): CatalogCourseSummary {
  return {
    id: course.id,
    versions: sortVersions(course.languageVersions, course.defaultLanguage).map((v) => ({
      id: v.id,
      language: v.language,
      title: v.title,
      description: v.description,
      moduleCount: v.modules.length,
      lectureCount: v.modules.reduce((sum, m) => sum + m._count.lectures, 0),
      hasPractical: v.modules.some((m) => m.assessmentType === AssessmentType.PRACTICAL),
    })),
  };
}

export function toCatalogDetail(course: DetailRow): CatalogCourseDetail {
  return {
    id: course.id,
    versions: sortVersions(course.languageVersions, course.defaultLanguage).map((v) => ({
      id: v.id,
      language: v.language,
      title: v.title,
      description: v.description,
      modules: v.modules.map((m) => ({
        id: m.id,
        orderIndex: m.orderIndex,
        title: m.title,
        assessmentType: m.assessmentType,
        lectures: m.lectures.map((l) => ({ id: l.id, orderIndex: l.orderIndex, title: l.title })),
      })),
    })),
  };
}
