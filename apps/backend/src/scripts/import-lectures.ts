/**
 * Импорт курса «Введение в политологию» из JSON (результат scripts/extract_lectures.py).
 *
 * Создаёт Course + 3 языковые версии (ru/kk/en), в каждой — модули по разделам
 * курса и лекции с расшифровками. Тип оценивания по умолчанию ТЗ (FR-2.2):
 * модуль 1 → тест, модуль 2 → тест, последний модуль → практическое задание,
 * охватывающее весь курс (FR-2.3).
 *
 * Видео (youtubeVideoId) остаётся пустым — ссылки заказчиком не предоставлены;
 * версия остаётся DRAFT, публикация заблокируется валидацией (FR-2.9), пока
 * видео не будут заданы. Это ожидаемое поведение, а не ошибка.
 *
 * Запуск:  npx tsx scripts/import-lectures.ts <lectures.json> [--replace]
 */
import { readFileSync } from 'node:fs';
import { PrismaClient, type AssessmentType } from '@prisma/client';

const prisma = new PrismaClient();

interface Payload {
  course: Record<string, string>;
  sections: { lectures: number[]; titles: Record<string, string> }[];
  lectures: {
    number: number;
    sectionIndex: number | null;
    titles: Record<string, string>;
    transcripts: Record<string, string>;
  }[];
}

const LANGS = ['ru', 'kk', 'en'] as const;

async function main() {
  const file = process.argv[2];
  const replace = process.argv.includes('--replace');
  if (!file) throw new Error('Укажите путь к lectures.json');

  const data = JSON.parse(readFileSync(file, 'utf8')) as Payload;
  const courseTitleRu = data.course.ru!;

  // Автор курса: первый менеджер/админ
  const author =
    (await prisma.user.findFirst({ where: { role: 'COURSE_MANAGER' } })) ??
    (await prisma.user.findFirst({ where: { role: 'ADMIN' } }));
  if (!author) throw new Error('Не найден пользователь COURSE_MANAGER/ADMIN — сначала выполните сид');

  // Идемпотентность: удаляем прежний импорт этого курса, если просили
  const existing = await prisma.courseLanguageVersion.findFirst({
    where: { title: courseTitleRu },
    include: { course: true },
  });
  if (existing) {
    if (!replace) {
      console.log(`⚠️  Курс «${courseTitleRu}» уже импортирован (${existing.courseId}). Запустите с --replace для перезаписи.`);
      return;
    }
    await prisma.course.delete({ where: { id: existing.courseId } });
    console.log('🗑  Прежняя версия курса удалена');
  }

  const course = await prisma.course.create({
    data: { defaultLanguage: 'ru', status: 'DRAFT', createdById: author.id },
  });

  for (const lang of LANGS) {
    const version = await prisma.courseLanguageVersion.create({
      data: {
        courseId: course.id,
        language: lang,
        title: data.course[lang] ?? courseTitleRu,
        description:
          lang === 'ru'
            ? 'Базовый курс политологии: теория, власть и политическая система, институты и акторы политики.'
            : lang === 'kk'
              ? 'Саясаттанудың негізгі курсы: теория, билік және саяси жүйе, саясат институттары.'
              : 'Foundational political science course: theory, power and the political system, institutions and actors.',
        status: 'DRAFT',
      },
    });

    for (const [i, section] of data.sections.entries()) {
      const isLast = i === data.sections.length - 1;
      const assessmentType: AssessmentType = isLast ? 'PRACTICAL' : 'QUIZ';

      const mod = await prisma.module.create({
        data: {
          courseLanguageVersionId: version.id,
          orderIndex: i,
          title: section.titles[lang] ?? section.titles.ru!,
          assessmentType,
          coversWholeCourse: isLast, // практическое охватывает весь курс (FR-2.3)
        },
      });

      const lectures = data.lectures
        .filter((l) => l.sectionIndex === i)
        .sort((a, b) => a.number - b.number);

      for (const [j, lec] of lectures.entries()) {
        const transcript = lec.transcripts[lang];
        if (!transcript) {
          console.warn(`   ⚠️  л.${lec.number} — нет расшифровки на ${lang}, пропуск`);
          continue;
        }
        await prisma.lecture.create({
          data: {
            moduleId: mod.id,
            orderIndex: j,
            title: `${lec.number}. ${lec.titles[lang] ?? lec.titles.ru}`,
            youtubeVideoId: '', // видео пока не предоставлены
            transcriptText: transcript,
          },
        });
      }
    }

    const count = await prisma.lecture.count({ where: { module: { courseLanguageVersionId: version.id } } });
    console.log(`✅ ${lang}: «${version.title}» — модулей: ${data.sections.length}, лекций: ${count}`);
  }

  console.log(`\n🎓 Курс создан: ${course.id} (статус DRAFT — нужны ссылки на видео для публикации)`);
}

main()
  .catch((e) => {
    console.error('❌', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
