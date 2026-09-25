/**
 * Публикация всех языковых версий курса с той же валидацией, что и в API (FR-2.9):
 * у каждой лекции — видео и расшифровка, у каждого модуля — готовое оценивание.
 * Нужна на сервере, где нет пароля менеджера для вызова POST /language-versions/:id/publish.
 *
 * По умолчанию — предпросмотр (что готово, что мешает). Запись — с флагом --apply.
 * В аудит пишется COURSE_PUBLISHED от имени автора курса с пометкой via=cli.
 *
 *   node dist/scripts/publish-course.js [--course "..."] [--apply]
 */
import { PrismaClient } from '@prisma/client';
import { publishCheckInclude, publishProblems } from '../modules/courses/publishValidation.js';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ci = args.indexOf('--course');
const COURSE_TITLE = ci !== -1 ? String(args[ci + 1]) : 'Введение в политологию';

async function main() {
  const any = await prisma.courseLanguageVersion.findFirst({ where: { title: COURSE_TITLE }, include: { course: true } });
  if (!any) throw new Error(`Курс «${COURSE_TITLE}» не найден`);
  const versions = await prisma.courseLanguageVersion.findMany({
    where: { courseId: any.courseId },
    include: publishCheckInclude,
    orderBy: { language: 'asc' },
  });

  let blocked = 0;
  for (const v of versions) {
    const problems = publishProblems(v);
    if (problems.length) {
      blocked++;
      console.log(`❌ ${v.language} «${v.title}» — не готова:`);
      for (const p of problems) console.log(`     • ${p}`);
      continue;
    }
    if (v.status === 'PUBLISHED') {
      console.log(`✓  ${v.language} «${v.title}» — уже опубликована`);
      continue;
    }
    if (!APPLY) {
      console.log(`→  ${v.language} «${v.title}» — готова, будет опубликована с --apply`);
      continue;
    }
    await prisma.$transaction([
      prisma.courseLanguageVersion.update({ where: { id: v.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
      prisma.course.update({ where: { id: v.courseId }, data: { status: 'PUBLISHED' } }),
      prisma.auditLog.create({
        data: { actorId: any.course.createdById, action: 'COURSE_PUBLISHED', targetType: 'CourseLanguageVersion', targetId: v.id, detail: { via: 'cli' } },
      }),
    ]);
    console.log(`✅ ${v.language} «${v.title}» — опубликована`);
  }
  if (blocked) process.exitCode = 1;
  if (!APPLY) console.log('\nПредпросмотр. Для публикации запустите с --apply.');
}

main()
  .catch((e) => { console.error('❌', (e as Error).message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
