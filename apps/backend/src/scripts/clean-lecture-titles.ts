/**
 * Очистка названий лекций от склеенной «шапки» исходного .docx (одноразовая, идемпотентная).
 *
 * При импорте служебные строки («Course: …», «Video length: ~20 minutes», «Format: …»)
 * приклеились к названию. Название видно публично — в программе курса в каталоге,
 * поэтому оставляем только само название (правила — modules/courses/lectureTitle).
 *
 * Запуск: npx tsx scripts/clean-lecture-titles.ts [--apply]
 *         node dist/scripts/clean-lecture-titles.js [--apply]   (на сервере)
 */
import { PrismaClient } from '@prisma/client';
import { cleanLectureTitle, lectureTitleProblem } from '../modules/courses/lectureTitle.js';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const lectures = await prisma.lecture.findMany({
    select: { id: true, title: true, module: { select: { languageVersion: { select: { language: true } } } } },
  });

  let changed = 0;
  let left = 0;
  for (const l of lectures) {
    const lang = l.module.languageVersion.language;
    const title = cleanLectureTitle(l.title);
    if (title !== l.title && title) {
      changed++;
      console.log(`  [${lang}] «${l.title.slice(0, 60)}…» → «${title}»`);
      if (APPLY) await prisma.lecture.update({ where: { id: l.id }, data: { title } });
    }
    const problem = lectureTitleProblem(title || l.title);
    if (problem) {
      left++;
      console.log(`  ⚠ [${lang}] «${l.title.slice(0, 60)}…» — ${problem}: исправьте вручную в редакторе курса`);
    }
  }
  console.log(`\n${APPLY ? '✅ Применено' : 'Предпросмотр (без --apply)'}: изменено лекций ${changed} из ${lectures.length}${left ? `, требуют ручной правки: ${left}` : ''}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
