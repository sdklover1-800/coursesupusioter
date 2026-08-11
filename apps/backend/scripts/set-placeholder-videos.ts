/**
 * Проставляет заглушку YouTube-ID лекциям без видео, чтобы разблокировать
 * публикацию версии (валидация FR-2.9 требует видео у каждой лекции), пока
 * заказчик не предоставил реальные ссылки. Идемпотентно.
 *
 * Запуск: npx tsx scripts/set-placeholder-videos.ts [--revert]
 */
import { PrismaClient } from '@prisma/client';
import { PLACEHOLDER_VIDEO_ID } from '@edu/shared';

const prisma = new PrismaClient();
const REVERT = process.argv.includes('--revert');

async function main() {
  if (REVERT) {
    const { count } = await prisma.lecture.updateMany({
      where: { youtubeVideoId: PLACEHOLDER_VIDEO_ID },
      data: { youtubeVideoId: '' },
    });
    console.log(`↩️  Заглушки сняты: ${count}`);
    return;
  }

  const { count } = await prisma.lecture.updateMany({
    where: { OR: [{ youtubeVideoId: '' }, { youtubeVideoId: { equals: undefined } }] },
    data: { youtubeVideoId: PLACEHOLDER_VIDEO_ID },
  });
  const left = await prisma.lecture.count({ where: { youtubeVideoId: '' } });
  console.log(`✅ Заглушек проставлено: ${count}; лекций без видео осталось: ${left}`);
  console.log('   Замените на реальные ссылки в редакторе курса (PATCH /lectures/:id).');
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
