/**
 * Переносит итоговое практическое задание (охватывает весь курс, FR-2.3) в
 * ПОСЛЕДНИЙ модуль курса. Нужен, когда курс дорос новыми разделами, а
 * практическое осталось в середине с тех времён, когда модулей было три.
 *
 * Для каждой языковой версии:
 *   - модуль-источник (PRACTICAL с заданием) → становится QUIZ (тест сгенерировать отдельно);
 *   - последний модуль → PRACTICAL, coversWholeCourse=true; задание перепривязывается к нему.
 * Сама запись PracticalTask сохраняет id — сессии студентов остаются связанными.
 * После переноса задание стоит перегенерировать (OVERWRITE), чтобы эталон
 * охватывал все лекции, а не только те, что были на момент первой генерации.
 *
 *   node dist/scripts/move-final-practical.js [--course "..."] [--apply]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ci = args.indexOf('--course');
const COURSE_TITLE = ci !== -1 ? String(args[ci + 1]) : 'Введение в политологию';

async function main() {
  const any = await prisma.courseLanguageVersion.findFirst({ where: { title: COURSE_TITLE } });
  if (!any) throw new Error(`Курс «${COURSE_TITLE}» не найден`);

  const versions = await prisma.courseLanguageVersion.findMany({
    where: { courseId: any.courseId },
    include: { modules: { orderBy: { orderIndex: 'asc' }, include: { practicalTask: { select: { id: true, title: true } } } } },
  });

  let moved = 0;
  for (const v of versions) {
    const source = v.modules.find((m) => m.assessmentType === 'PRACTICAL' && m.practicalTask);
    const target = v.modules[v.modules.length - 1];
    if (!source || !target) { console.log(`  [${v.language}] нет практического или модулей — пропуск`); continue; }
    if (source.id === target.id) { console.log(`  [${v.language}] практическое уже в последнем модуле`); continue; }
    if (target.practicalTask) { console.warn(`  ⚠️  [${v.language}] у последнего модуля уже есть задание — пропуск`); continue; }

    console.log(`  [${v.language}] «${source.title.slice(0, 38)}» → «${target.title.slice(0, 38)}»`);
    moved++;
    if (!APPLY) continue;

    // Одной транзакцией: перепривязка + смена типов, чтобы не оставить курс в полусостоянии.
    await prisma.$transaction([
      prisma.practicalTask.update({ where: { id: source.practicalTask!.id }, data: { moduleId: target.id } }),
      prisma.module.update({ where: { id: target.id }, data: { assessmentType: 'PRACTICAL', coversWholeCourse: true } }),
      prisma.module.update({ where: { id: source.id }, data: { assessmentType: 'QUIZ', coversWholeCourse: false } }),
    ]);
  }
  console.log(`\n${APPLY ? '✅ Применено' : 'Предпросмотр (добавьте --apply)'}: перенесено ${moved}`);
  if (APPLY && moved) console.log('   Далее: сгенерировать тест для освободившегося модуля и перегенерировать практическое (OVERWRITE).');
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
