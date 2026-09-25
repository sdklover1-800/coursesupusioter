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
/** Только НЕархивные вопросы — счётчик без содержимого вопросов. */
const activeQuestionCount = { _count: { select: { questions: { where: { archivedAt: null } } } } } as const;

/**
 * Выборка для карточек каталога (GET /catalog). Из лекций — только длительность,
 * из теста модуля — только факт наличия (id).
 */
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
      modules: {
        select: {
          assessmentType: true,
          lectures: { select: { durationSec: true } },
          quiz: { select: { id: true } },
        },
      },
    },
  },
} satisfies Prisma.CourseSelect;

/**
 * Выборка для страницы курса (GET /catalog/:courseId) — программа без контента:
 * названия и длительности лекций, число вопросов тестов (счётчик, не вопросы),
 * наличие мини-квизов и практикума (id, без сценария/эталона/рубрики).
 */
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
      finalMiniQuiz: { select: activeQuestionCount },
      modules: {
        orderBy: { orderIndex: 'asc' },
        select: {
          id: true,
          orderIndex: true,
          title: true,
          assessmentType: true,
          quiz: { select: activeQuestionCount },
          practicalTask: { select: { id: true } },
          lectures: {
            orderBy: { orderIndex: 'asc' },
            select: { id: true, orderIndex: true, title: true, durationSec: true, miniQuiz: { select: activeQuestionCount } },
          },
        },
      },
    },
  },
} satisfies Prisma.CourseSelect;

/** Сумма длительностей; null, если у какой-то лекции длительность не задана. */
function totalDuration(values: readonly (number | null)[]): number | null {
  let sum = 0;
  for (const v of values) {
    if (v === null) return null;
    sum += v;
  }
  return sum;
}

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
      lectureCount: v.modules.reduce((sum, m) => sum + m.lectures.length, 0),
      hasPractical: v.modules.some((m) => m.assessmentType === AssessmentType.PRACTICAL),
      durationSec: totalDuration(v.modules.flatMap((m) => m.lectures.map((l) => l.durationSec))),
      moduleQuizCount: v.modules.filter((m) => !!m.quiz).length,
      // Сертификат выдаётся по завершении любого опубликованного курса (FR-9.1)
      hasCertificate: true,
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
      durationSec: totalDuration(v.modules.flatMap((m) => m.lectures.map((l) => l.durationSec))),
      hasFinalMiniQuiz: (v.finalMiniQuiz?._count.questions ?? 0) > 0,
      modules: v.modules.map((m) => ({
        id: m.id,
        orderIndex: m.orderIndex,
        title: m.title,
        assessmentType: m.assessmentType,
        quizQuestionCount: m.quiz ? m.quiz._count.questions : null,
        hasPractical: !!m.practicalTask,
        lectures: m.lectures.map((l) => ({
          id: l.id,
          orderIndex: l.orderIndex,
          title: l.title,
          durationSec: l.durationSec,
          hasMiniQuiz: (l.miniQuiz?._count.questions ?? 0) > 0,
        })),
      })),
    })),
  };
}
