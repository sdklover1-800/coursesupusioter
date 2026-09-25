/**
 * Фаза 1g: Lecture.durationSec (оценка оставшегося времени на карте курса и в каталоге).
 * Источник по приоритету:
 *  1) шапка расшифровки: «Хронометраж: 24:00» / «Runtime: 21:00» (мм:сс) или «~22 минуты»,
 *     «approximately 22–25 minutes», «шамамен 23–25 минут» (нижняя граница диапазона).
 *     Шапку чистит fix-transcripts, поэтому удалённые строки читаются из его журнала;
 *  2) иначе — конец последнего таймкода расшифровки.
 * Пишется только пустое durationSec (заданное менеджером не трогается без --force).
 * Печатается каждое значение и расхождение с концом таймкодов.
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/backfill-durations.ts [--apply --i-have-a-backup] [--force]
 */
import { parseTranscript } from '../../generation/drafts.js';
import { Report, isMetaLine, isTimecodeLine, lectureCode, ledgerGet, ledgerKey, ledgerPut, loadCourse, parseArgs, prisma, run, writePreview } from './lib.js';

const SCRIPT = 'backfill-durations';

const CLOCK_RE = /(?:Хронометраж|Runtime|Duration|ұзақтығы)[^0-9]{0,20}(\d{1,2}):(\d{2})(?!\d)/iu;
const MINUTES_RE = /(\d{1,3})\s*(?:[–—-]\s*\d{1,3}\s*)?(?:мин|minut|min\b)/iu;

/** Длительность из строк шапки: мм:сс или «N минут» (нижняя граница). */
function durationFromHeader(lines: string[]): { sec: number; from: string } | null {
  for (const l of lines) {
    const m = CLOCK_RE.exec(l);
    if (m) return { sec: Number(m[1]) * 60 + Number(m[2]), from: l.trim() };
  }
  for (const l of lines) {
    const m = MINUTES_RE.exec(l);
    if (m) return { sec: Number(m[1]) * 60, from: l.trim() };
  }
  return null;
}

/** Конец последнего таймкода, сек (как generation/common transcriptEndSeconds). */
function transcriptEndSeconds(text: string): number | null {
  const { sections } = parseTranscript(text);
  return sections.length ? Math.max(...sections.map((s) => s.end)) : null;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

async function main(): Promise<number> {
  const args = parseArgs(SCRIPT);
  const report = new Report(SCRIPT, args.apply);
  const course = await loadCourse();
  const preview: unknown[] = [];
  for (const lang of args.langs) {
    const v = course.versions[lang];
    if (!v) continue;
    for (const l of v.lectures) {
      const code = lectureCode(lang, l.number);
      const lines = l.transcriptText.split('\n');
      const first = lines.findIndex(isTimecodeLine);
      const header = (first === -1 ? [] : lines.slice(0, first)).filter(isMetaLine);
      const repaired = await ledgerGet(prisma, ledgerKey('fix-transcripts', code));
      const removedMeta = ((repaired?.detail as { removedMeta?: string[] } | null)?.removedMeta ?? []).filter((x) => typeof x === 'string');
      const fromHeader = durationFromHeader([...header, ...removedMeta]);
      const end = transcriptEndSeconds(l.transcriptText);
      const sec = fromHeader?.sec ?? end;
      const source = fromHeader ? `шапка «${fromHeader.from.slice(0, 60)}»` : 'конец последнего таймкода';
      const note = `${fmt(sec ?? 0)} (${sec} с) · ${source}${end !== null && fromHeader ? ` · конец таймкодов ${fmt(end)}` : ''}`;
      preview.push({ code, durationSec: sec, source, timecodeEnd: end, current: l.durationSec });
      if (sec === null) {
        report.line(code, 'error', 'длительность не определить: нет шапки и таймкодов');
        continue;
      }
      if (l.durationSec === sec) {
        report.line(code, 'skip', `уже ${note}`);
        continue;
      }
      if (l.durationSec !== null && !args.force) {
        report.line(code, 'skip', `уже задано ${l.durationSec} с (оценка ${note}) — не трогаю без --force`);
        continue;
      }
      if (!args.apply) {
        report.line(code, 'would-change', note);
        continue;
      }
      const key = ledgerKey(SCRIPT, code);
      const done = await prisma.$transaction(async (tx) => {
        const cur = await tx.lecture.findUniqueOrThrow({ where: { id: l.id }, select: { durationSec: true } });
        if (cur.durationSec !== l.durationSec) return false;
        await tx.lecture.update({ where: { id: l.id }, data: { durationSec: sec } });
        if (await ledgerGet(tx, key)) await tx.contentMigration.update({ where: { key }, data: { detail: { durationSec: sec, source, forced: true } } });
        else await ledgerPut(tx, key, { durationSec: sec, source, previous: l.durationSec });
        return true;
      });
      report.line(code, done ? 'changed' : 'skip', done ? note : 'значение изменилось во время работы');
    }
  }
  console.log(`\n${report.summary()}`);
  if (!args.apply) console.log(`Предпросмотр: ${writePreview(args, preview)}`);
  return report.errors ? 1 : 0;
}

run(main);
