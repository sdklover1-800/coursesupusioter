/**
 * Ставит задачи ИИ-генерации материалов курса и ждёт их завершения (FR-7.1).
 *
 * Для каждой языковой версии курса ставит фоновые задачи:
 *   QUIZ      — тесты модулей, у которых их ещё нет (стратегия KEEP);
 *   MINI      — мини-квизы лекций + итоговый по курсу, только недостающие (KEEP);
 *   PRACTICAL — с флагом --regen-practical: перегенерация итогового практического
 *               (OVERWRITE) — нужна после добавления лекций, чтобы эталон охватывал весь курс.
 *
 * KEEP не трогает готовые материалы и ручные правки менеджера (FR-7.5), поэтому
 * скрипт можно перезапускать: он догенерирует только то, чего не хватает.
 * Требует запущенный воркер очереди (в dev — встроен в сервер; на проде — сервис worker)
 * и рабочий ключ провайдера LLM.
 *
 *   node dist/scripts/generate-materials.js [--course "..."] [--lang ru] [--regen-practical] [--no-wait]
 *
 * --lang ограничивает одной языковой версией (например, чтобы повторить упавшую задачу).
 */
import { PrismaClient } from '@prisma/client';
import { enqueueGeneration } from '../generation/enqueue.js';
import { generationQueue } from '../queue/queues.js';
import { redis } from '../lib/redis.js';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const ci = args.indexOf('--course');
const COURSE_TITLE = ci !== -1 ? String(args[ci + 1]) : 'Введение в политологию';
const li = args.indexOf('--lang');
const ONLY_LANG = li !== -1 ? String(args[li + 1]) : undefined;
const REGEN_PRACTICAL = args.includes('--regen-practical');
const WAIT = !args.includes('--no-wait');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const any = await prisma.courseLanguageVersion.findFirst({ where: { title: COURSE_TITLE }, include: { course: true } });
  if (!any) throw new Error(`Курс «${COURSE_TITLE}» не найден`);
  const versions = await prisma.courseLanguageVersion.findMany({
    where: { courseId: any.courseId, ...(ONLY_LANG ? { language: ONLY_LANG } : {}) },
    orderBy: { language: 'asc' },
  });
  if (!versions.length) throw new Error(`Нет языковой версии «${ONLY_LANG}» у курса «${COURSE_TITLE}»`);
  const createdById = any.course.createdById; // автор курса — от его имени и генерируем

  const jobs: { label: string; id: string }[] = [];
  for (const v of versions) {
    const plan: { type: 'QUIZ' | 'MINI' | 'PRACTICAL'; strategy: 'KEEP' | 'OVERWRITE' }[] = [
      { type: 'QUIZ', strategy: 'KEEP' },
      { type: 'MINI', strategy: 'KEEP' },
    ];
    if (REGEN_PRACTICAL) plan.push({ type: 'PRACTICAL', strategy: 'OVERWRITE' });
    for (const p of plan) {
      const { id } = await enqueueGeneration({
        courseLanguageVersionId: v.id,
        type: p.type,
        params: { regenStrategy: p.strategy, singleChoiceCount: 4, trueFalseCount: 2 },
        createdById,
      });
      jobs.push({ label: `${v.language}/${p.type}`, id });
    }
  }
  console.log(`Поставлено задач: ${jobs.length}` + (WAIT ? ' — ждём…' : ''));
  if (!WAIT) return;

  // Ждём завершения всех задач; печатаем итог по каждой.
  const done = new Set<string>();
  let failed = 0;
  for (let tick = 0; done.size < jobs.length && tick < 360; tick++) {
    await sleep(10_000);
    for (const j of jobs) {
      if (done.has(j.id)) continue;
      const row = await prisma.generationJob.findUnique({ where: { id: j.id } });
      if (!row || (row.status !== 'DONE' && row.status !== 'ERROR')) continue;
      done.add(j.id);
      if (row.status === 'ERROR') { failed++; console.log(`  ❌ ${j.label}: ${(row.error ?? '').slice(0, 80)}`); }
      else {
        const r = (row.result ?? {}) as Record<string, unknown>;
        console.log(`  ✅ ${j.label}: тестов=${r.quizzes ?? 0} мини=${r.minis ?? 0} практ=${r.practicals ?? 0}`);
      }
    }
  }
  const pending = jobs.length - done.size;
  console.log(`\nГотово: ${done.size - failed} ✓, ошибок ${failed}${pending ? `, не дождались ${pending}` : ''}`);
  if (failed || pending) process.exitCode = 1;
}

main()
  .catch((e) => { console.error('❌', e.message); process.exitCode = 1; })
  .finally(async () => {
    // BullMQ/ioredis держат открытые соединения и без принудительного выхода
    // процесс висит после завершения работы — закрываем с таймаутом и выходим.
    await Promise.race([
      Promise.all([generationQueue.close(), redis.quit(), prisma.$disconnect()]),
      new Promise((r) => setTimeout(r, 5000)),
    ]).catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });
