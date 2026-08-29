/**
 * Проставляет YouTube-ссылки лекциям (FR-4.1, FR-4.3).
 *
 * Вход — CSV. Колонка language необязательна: без неё ссылка применяется ко ВСЕМ
 * языковым версиям курса (удобно, когда видео одно на все языки), с ней — только
 * к указанной. Номер лекции сквозной: модули по orderIndex, внутри — лекции.
 *
 *   lecture,language,url
 *   1,ru,https://youtu.be/XXXXXXXXXXX
 *   1,kk,https://www.youtube.com/watch?v=YYYYYYYYYYY
 *
 *   # или без языка — на все версии:
 *   lecture,url
 *   1,https://youtu.be/XXXXXXXXXXX
 *
 * Запуск (по умолчанию — предпросмотр, ничего не пишет):
 *   npx tsx scripts/set-lecture-videos.ts links.csv [--course "Введение в политологию"] [--apply]
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { extractYoutubeId } from '../lib/youtube.js';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const file = args.find((a) => !a.startsWith('--'));
const courseIdx = args.indexOf('--course');
const COURSE_TITLE = courseIdx !== -1 ? args[courseIdx + 1] : 'Введение в политологию';

interface Row { lecture: number; language: string | null; url: string }

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0) throw new Error('Файл пуст');

  const header = lines[0]!.toLowerCase().split(',').map((h) => h.trim());
  const hasHeader = header.includes('lecture') || header.includes('url');
  const cols = hasHeader ? header : ['lecture', 'url'];
  const iLec = cols.indexOf('lecture');
  const iLang = cols.indexOf('language');
  const iUrl = cols.indexOf('url');
  if (iLec === -1 || iUrl === -1) throw new Error('Нужны колонки lecture и url');

  return lines.slice(hasHeader ? 1 : 0).map((line, n) => {
    const parts = line.split(',').map((p) => p.trim());
    const lecture = Number(parts[iLec]);
    if (!Number.isInteger(lecture) || lecture < 1) throw new Error(`Строка ${n + 1}: некорректный номер лекции «${parts[iLec]}»`);
    const url = parts[iUrl] ?? '';
    if (!url) throw new Error(`Строка ${n + 1}: пустой url`);
    return { lecture, language: iLang !== -1 ? (parts[iLang] || null) : null, url };
  });
}

async function main() {
  if (!file) throw new Error('Укажите CSV-файл со ссылками. См. комментарий в начале скрипта.');
  const rows = parseCsv(readFileSync(file, 'utf8'));

  // Валидируем ссылки ДО записи: одна битая строка не должна оставить курс полуобновлённым.
  const resolved = rows.map((r) => ({ ...r, videoId: extractYoutubeId(r.url) }));

  const version0 = await prisma.courseLanguageVersion.findFirst({ where: { title: COURSE_TITLE } });
  if (!version0) throw new Error(`Курс «${COURSE_TITLE}» не найден`);

  const versions = await prisma.courseLanguageVersion.findMany({
    where: { courseId: version0.courseId },
    include: { modules: { orderBy: { orderIndex: 'asc' }, include: { lectures: { orderBy: { orderIndex: 'asc' } } } } },
  });

  let updated = 0;
  const missing: string[] = [];

  for (const v of versions) {
    // Сквозная нумерация лекций: 1..N по порядку модулей и лекций внутри них.
    const ordered = v.modules.flatMap((m) => m.lectures);
    for (const r of resolved) {
      if (r.language && r.language !== v.language) continue;
      const lec = ordered[r.lecture - 1];
      if (!lec) { missing.push(`${v.language}: нет лекции №${r.lecture}`); continue; }
      if (lec.youtubeVideoId === r.videoId) continue;
      console.log(`  [${v.language}] №${r.lecture} ${lec.title.slice(0, 44)} → ${r.videoId}`);
      updated++;
      if (APPLY) await prisma.lecture.update({ where: { id: lec.id }, data: { youtubeVideoId: r.videoId } });
    }
  }

  for (const m of [...new Set(missing)]) console.warn(`  ⚠️  ${m}`);
  console.log(`\n${APPLY ? '✅ Применено' : 'Предпросмотр (добавьте --apply)'}: обновлений ${updated}`);

  if (APPLY) {
    const left = await prisma.lecture.count({
      where: { module: { languageVersion: { courseId: version0.courseId } }, youtubeVideoId: 'PLACEHOLDER' },
    });
    console.log(`   Лекций всё ещё с заглушкой: ${left}`);
  }
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
