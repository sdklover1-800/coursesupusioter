/**
 * Инкрементально добавляет лекции в СУЩЕСТВУЮЩИЙ курс (разделы IV–V, лекции 11–15).
 *
 * В отличие от import-lectures.ts (создаёт курс с нуля) ничего не пересоздаёт:
 * существующие лекции, видео, тесты, мини-квизы и прогресс студентов не трогаются.
 * Идемпотентно — повторный запуск не плодит дубли.
 *
 *   npx tsx scripts/add-lectures.ts <lectures.json> --from 11 [--course "..."] [--apply]
 */
import { readFileSync } from 'node:fs';
import { PrismaClient, type AssessmentType } from '@prisma/client';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const file = args.find((a) => !a.startsWith('--'));
const numAfter = (flag: string, def: number) => {
  const i = args.indexOf(flag);
  return i !== -1 ? Number(args[i + 1]) : def;
};
const strAfter = (flag: string, def: string) => {
  const i = args.indexOf(flag);
  return i !== -1 ? String(args[i + 1]) : def;
};
const FROM = numAfter('--from', 11);
const COURSE_TITLE = strAfter('--course', 'Введение в политологию');

interface Payload {
  sections: { lectures: number[]; titles: Record<string, string> }[];
  lectures: { number: number; sectionIndex: number | null; titles: Record<string, string>; transcripts: Record<string, string> }[];
}

async function main() {
  if (!file) throw new Error('Укажите lectures.json');
  const data = JSON.parse(readFileSync(file, 'utf8')) as Payload;

  const anyVersion = await prisma.courseLanguageVersion.findFirst({ where: { title: COURSE_TITLE } });
  if (!anyVersion) throw new Error(`Курс «${COURSE_TITLE}» не найден`);

  const versions = await prisma.courseLanguageVersion.findMany({
    where: { courseId: anyVersion.courseId },
    include: { modules: { orderBy: { orderIndex: 'asc' }, include: { lectures: { orderBy: { orderIndex: 'asc' } } } } },
  });

  const added: string[] = [];

  for (const version of versions) {
    const lang = version.language;
    const newLectures = data.lectures
      .filter((l) => l.number >= FROM && l.transcripts[lang])
      .sort((a, b) => a.number - b.number);

    // Новые лекции группируем по разделу — раздел становится модулем платформы.
    const bySection = new Map<number, typeof newLectures>();
    for (const l of newLectures) {
      if (l.sectionIndex == null) continue;
      (bySection.get(l.sectionIndex) ?? bySection.set(l.sectionIndex, []).get(l.sectionIndex)!).push(l);
    }

    for (const [sectionIndex, lects] of [...bySection.entries()].sort((a, b) => a[0] - b[0])) {
      const section = data.sections[sectionIndex];
      if (!section) continue;
      const title = section.titles[lang] ?? section.titles.ru!;

      let mod = version.modules.find((m) => m.title === title);
      if (!mod) {
        // Новые разделы — с тестом в конце; итоговое практическое уже есть в курсе.
        const orderIndex = Math.max(-1, ...version.modules.map((m) => m.orderIndex)) + 1 + [...bySection.keys()].sort().indexOf(sectionIndex);
        added.push(`[${lang}] новый модуль «${title}» (orderIndex ${orderIndex})`);
        if (APPLY) {
          mod = (await prisma.module.create({
            data: { courseLanguageVersionId: version.id, orderIndex, title, assessmentType: 'QUIZ' as AssessmentType, coversWholeCourse: false },
            include: { lectures: true },
          })) as never;
        }
      }

      for (const [i, l] of lects.entries()) {
        const lecTitle = `${l.number}. ${l.titles[lang] ?? l.titles.ru}`;
        const exists = mod && (mod as { lectures: { title: string }[] }).lectures?.some((x) => x.title === lecTitle);
        if (exists) continue;
        added.push(`  [${lang}] лекция ${l.number}: ${(l.titles[lang] ?? '').slice(0, 46)} (${Math.round(l.transcripts[lang]!.length / 1000)}k)`);
        if (APPLY && mod) {
          await prisma.lecture.create({
            data: {
              moduleId: (mod as { id: string }).id,
              orderIndex: i,
              title: lecTitle,
              youtubeVideoId: '', // ссылки проставит set-lecture-videos.ts
              transcriptText: l.transcripts[lang]!,
            },
          });
        }
      }
    }
  }

  for (const a of added) console.log(a);
  console.log(`\n${APPLY ? '✅ Применено' : 'Предпросмотр (добавьте --apply)'}: записей ${added.length}`);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
