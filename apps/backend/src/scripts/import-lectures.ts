/**
 * Импорт курса из JSON: «Введение в политологию» (scripts/extract_lectures.py →
 * docs/media/lectures15.json), «Введение в философию» (scripts/extract_philosophy.py →
 * docs/media/philosophy15.json). Курс определяется по названию ru-версии из JSON
 * (course.ru); другие курсы не затрагиваются.
 *
 * Создаёт Course + 3 языковые версии (ru/kk/en), в каждой — модули по разделам
 * курса и лекции с расшифровками. Тип оценивания по умолчанию ТЗ (FR-2.2):
 * модуль 1 → тест, модуль 2 → тест, последний модуль → практическое задание,
 * охватывающее весь курс (FR-2.3).
 *
 * Необязательные поля JSON (в lectures15.json их нет — для политологии всё как прежде):
 *  - descriptions {ru,kk,en} — описание языковой версии (иначе — текст политологии);
 *  - lectures[].durations {lang: сек} — Lecture.durationSec (хронометраж из шапки .docx).
 * Нет расшифровки на языке, но есть название — лекция создаётся с ПУСТОЙ расшифровкой
 * (автор пришлёт позже): публикация этой версии заблокирована валидацией (FR-2.9).
 *
 * Видео (youtubeVideoId) остаётся пустым — ссылки проставит set-lecture-videos.ts;
 * версия остаётся DRAFT, публикация заблокируется валидацией (FR-2.9), пока
 * видео не будут заданы. Это ожидаемое поведение, а не ошибка.
 *
 * Повторный запуск ничего не меняет (курс уже есть). Режимы для существующего курса:
 *   --sync     дозаполнить курс по JSON, ничего не удаляя и не перезаписывая: недостающие
 *              версии/модули/лекции, ПУСТЫЕ расшифровки (автор прислал) и незаданная
 *              длительность. Предпросмотр; запись — с --apply. Идемпотентно.
 *   --replace  удалить курс ЦЕЛИКОМ (со всеми данными студентов!) и импортировать заново.
 *
 * Запуск:  npx tsx scripts/import-lectures.ts <lectures.json> [--sync [--apply] | --replace]
 */
import { readFileSync } from 'node:fs';
import { PrismaClient, type AssessmentType } from '@prisma/client';

const prisma = new PrismaClient();

interface PayloadLecture {
  number: number;
  sectionIndex: number | null;
  titles: Record<string, string>;
  transcripts: Record<string, string>;
  /** Длительность видео по языкам, сек (необязательно). */
  durations?: Record<string, number>;
}

interface Payload {
  course: Record<string, string>;
  /** Описание языковой версии курса (необязательно). */
  descriptions?: Record<string, string>;
  sections: { lectures: number[]; titles: Record<string, string> }[];
  lectures: PayloadLecture[];
}

const LANGS = ['ru', 'kk', 'en'] as const;
type Lang = (typeof LANGS)[number];

/** Описания политологии — для JSON без descriptions (lectures15.json). */
const DEFAULT_DESCRIPTIONS: Record<Lang, string> = {
  ru: 'Базовый курс политологии: теория, власть и политическая система, институты и акторы политики.',
  kk: 'Саясаттанудың негізгі курсы: теория, билік және саяси жүйе, саясат институттары.',
  en: 'Foundational political science course: theory, power and the political system, institutions and actors.',
};

async function main() {
  const file = process.argv[2];
  const replace = process.argv.includes('--replace');
  const sync = process.argv.includes('--sync');
  const apply = process.argv.includes('--apply');
  if (!file) throw new Error('Укажите путь к lectures.json');
  if (sync && replace) throw new Error('--sync и --replace несовместимы');

  const data = JSON.parse(readFileSync(file, 'utf8')) as Payload;
  const courseTitleRu = data.course.ru!;

  // Автор курса: первый менеджер/админ
  const author =
    (await prisma.user.findFirst({ where: { role: 'COURSE_MANAGER' } })) ??
    (await prisma.user.findFirst({ where: { role: 'ADMIN' } }));
  if (!author) throw new Error('Не найден пользователь COURSE_MANAGER/ADMIN — сначала выполните сид');

  // Идемпотентность: курс ищется по названию ru-версии
  const existing = await prisma.courseLanguageVersion.findFirst({
    where: { title: courseTitleRu, language: 'ru' },
    include: { course: true },
  });
  if (sync) {
    if (!existing) throw new Error(`Курс «${courseTitleRu}» не найден — первый импорт запускается без --sync`);
    await syncCourse(data, existing.courseId, apply);
    return;
  }
  if (existing) {
    if (!replace) {
      console.log(
        `⚠️  Курс «${courseTitleRu}» уже импортирован (${existing.courseId}). Дозаполнить — --sync, перезаписать — --replace.`,
      );
      return;
    }
    await prisma.course.delete({ where: { id: existing.courseId } });
    console.log('🗑  Прежняя версия курса удалена');
  }

  const course = await prisma.course.create({
    data: { defaultLanguage: 'ru', status: 'DRAFT', createdById: author.id },
  });

  for (const lang of LANGS) {
    const version = await createVersion(data, course.id, lang);
    const count = await prisma.lecture.count({ where: { module: { courseLanguageVersionId: version.id } } });
    console.log(`✅ ${lang}: «${version.title}» — модулей: ${data.sections.length}, лекций: ${count}`);
  }

  console.log(`\n🎓 Курс создан: ${course.id} (статус DRAFT — нужны ссылки на видео для публикации)`);
}

/** Языковая версия со всеми модулями и лекциями. */
async function createVersion(data: Payload, courseId: string, lang: Lang) {
  const version = await prisma.courseLanguageVersion.create({
    data: {
      courseId,
      language: lang,
      title: data.course[lang] ?? data.course.ru!,
      description: data.descriptions?.[lang] ?? DEFAULT_DESCRIPTIONS[lang],
      status: 'DRAFT',
    },
  });
  for (const i of data.sections.keys()) await createModule(data, version.id, lang, i);
  return version;
}

/** Модуль раздела i с его лекциями. */
async function createModule(data: Payload, versionId: string, lang: Lang, i: number) {
  const section = data.sections[i]!;
  const isLast = i === data.sections.length - 1;
  const assessmentType: AssessmentType = isLast ? 'PRACTICAL' : 'QUIZ';

  const mod = await prisma.module.create({
    data: {
      courseLanguageVersionId: versionId,
      orderIndex: i,
      title: section.titles[lang] ?? section.titles.ru!,
      assessmentType,
      coversWholeCourse: isLast, // практическое охватывает весь курс (FR-2.3)
    },
  });

  for (const [j, lec] of sectionLectures(data, i).entries()) {
    const row = lectureRow(lec, lang, mod.id, j);
    if (!row) {
      console.warn(`   ⚠️  л.${lec.number} — нет расшифровки на ${lang}, пропуск`);
      continue;
    }
    if (!row.transcriptText) console.warn(`   ⚠️  л.${lec.number} — нет расшифровки на ${lang}: лекция с пустой расшифровкой (публикация ${lang} заблокирована до её загрузки)`);
    await prisma.lecture.create({ data: row });
  }
}

/** Лекции раздела по номеру; позиция в списке — orderIndex в модуле. */
function sectionLectures(data: Payload, i: number): PayloadLecture[] {
  return data.lectures.filter((l) => l.sectionIndex === i).sort((a, b) => a.number - b.number);
}

/**
 * Строка новой лекции. null — языка у лекции нет вовсе (ни расшифровки, ни названия);
 * есть название без расшифровки — лекция с пустой расшифровкой.
 */
function lectureRow(lec: PayloadLecture, lang: Lang, moduleId: string, orderIndex: number) {
  const transcript = lec.transcripts[lang] ?? '';
  if (!transcript && !lec.titles[lang]) return null;
  const durationSec = lec.durations?.[lang];
  return {
    moduleId,
    orderIndex,
    title: `${lec.number}. ${lec.titles[lang] ?? lec.titles.ru}`,
    youtubeVideoId: '', // видео пока не предоставлены
    transcriptText: transcript,
    ...(durationSec ? { durationSec } : {}),
  };
}

/**
 * --sync: дозаполнить существующий курс. Модули — по orderIndex, лекции — по (модуль,
 * позиция) со сверкой номера в названии «N. …». Заполняются только пустые расшифровки и
 * незаданная длительность; названия, видео, тесты и прогресс студентов не трогаются.
 */
async function syncCourse(data: Payload, courseId: string, apply: boolean) {
  const versions = await prisma.courseLanguageVersion.findMany({
    where: { courseId },
    include: { modules: { orderBy: { orderIndex: 'asc' }, include: { lectures: { orderBy: { orderIndex: 'asc' } } } } },
  });
  let changes = 0;
  let errors = 0;
  const change = (s: string) => {
    changes++;
    console.log(`${apply ? '✔' : '→'} ${s}`);
  };

  for (const lang of LANGS) {
    const v = versions.find((x) => x.language === lang);
    if (!v) {
      change(`[${lang}] языковая версия «${data.course[lang] ?? data.course.ru}» — создать целиком`);
      if (apply) await createVersion(data, courseId, lang);
      continue;
    }
    for (const [i, section] of data.sections.entries()) {
      const mod = v.modules.find((m) => m.orderIndex === i);
      if (!mod) {
        change(`[${lang}] модуль ${i + 1} «${section.titles[lang] ?? section.titles.ru}» — создать с лекциями`);
        if (apply) await createModule(data, v.id, lang, i);
        continue;
      }
      for (const [j, lec] of sectionLectures(data, i).entries()) {
        const code = `[${lang}] л.${lec.number}`;
        const row = mod.lectures.find((l) => l.orderIndex === j);
        if (!row) {
          const created = lectureRow(lec, lang, mod.id, j);
          if (!created) continue;
          change(`${code} «${created.title.slice(0, 60)}» — создать`);
          if (apply) await prisma.lecture.create({ data: created });
          continue;
        }
        // Позиция могла смениться вручную: пишем только в «свою» лекцию.
        if (!row.title.startsWith(`${lec.number}.`)) {
          errors++;
          console.log(`✖ ${code}: на позиции модуль ${i + 1} / лекция ${j + 1} — «${row.title.slice(0, 60)}», пропуск`);
          continue;
        }
        const transcript = lec.transcripts[lang] ?? '';
        const durationSec = lec.durations?.[lang];
        const patch: { transcriptText?: string; durationSec?: number } = {};
        if (!row.transcriptText.trim() && transcript.trim()) patch.transcriptText = transcript;
        if (row.durationSec === null && durationSec) patch.durationSec = durationSec;
        if (!Object.keys(patch).length) continue;
        const what = [patch.transcriptText ? `расшифровка (${transcript.length} симв.)` : '', patch.durationSec ? `длительность ${patch.durationSec} с` : '']
          .filter(Boolean)
          .join(', ');
        if (!apply) {
          change(`${code}: ${what}`);
          continue;
        }
        // Только если поля всё ещё пусты: менеджер мог заполнить их в редакторе за это время.
        const done = await prisma.lecture.updateMany({
          where: {
            id: row.id,
            ...(patch.transcriptText ? { transcriptText: row.transcriptText } : {}),
            ...(patch.durationSec ? { durationSec: null } : {}),
          },
          data: patch,
        });
        if (done.count) change(`${code}: ${what}`);
        else {
          errors++;
          console.log(`✖ ${code}: лекция изменилась во время работы — повторите`);
        }
      }
    }
  }
  console.log(`\n${apply ? '✅ Применено' : 'Предпросмотр (добавьте --apply)'}: изменений ${changes}${errors ? `, ошибок ${errors}` : ''}`);
  if (errors) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('❌', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
