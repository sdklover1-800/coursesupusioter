/**
 * Фаза 1c: названия. Желаемое состояние вычисляется из данных (идемпотентно):
 *  - лекции: cleanLectureTitle (en L1/L3 — «шапка» .docx), kk «ретинде» → «ретінде»,
 *    L12 — метка семинара «(практическое занятие)» / «(практикалық сабақ)» / «(Practical Session)»;
 *  - мини-квизы: localizedTitle('LECTURE_MINI', язык, <название лекции>);
 *  - тесты модулей: localizedTitle('MODULE_FINAL', язык, <модуль>) — без русских «Тест:» в kk/en;
 *  - итоговый мини-квиз: localizedTitle('COURSE_FINAL', язык);
 *  - итоговое практическое (весь курс): localizedTitle('PRACTICAL', язык) — ru «Итоговое практическое задание».
 * Каждое название проходит lectureTitleProblem. Если после применения название поменяли
 * вручную — скрипт его не трогает (без --force).
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/fix-titles.ts [--lang kk,en] [--apply --i-have-a-backup] [--force]
 */
import type { Language } from '@edu/shared';
import { localizedTitle } from '../../generation/drafts.js';
import { cleanLectureTitle, lectureTitleProblem } from '../../modules/courses/lectureTitle.js';
import { type Db, Report, applyKkLexicon, lectureCode, ledgerGet, ledgerKey, ledgerPut, loadCourse, parseArgs, prisma, run, writePreview } from './lib.js';

const SCRIPT = 'fix-titles';

/** Метка семинара лекции 12 (в расшифровке: «Лекция 12 (практическое занятие)»). */
const SEMINAR: Record<Language, string> = {
  ru: '(практическое занятие)',
  kk: '(практикалық сабақ)',
  en: '(Practical Session)',
};
const SEMINAR_LECTURES = new Set([12]);

function lectureTitleFor(lang: Language, number: number, title: string): string {
  let t = cleanLectureTitle(title);
  if (lang === 'kk') t = applyKkLexicon(t).text;
  if (SEMINAR_LECTURES.has(number) && !t.includes(SEMINAR[lang])) t = `${t} ${SEMINAR[lang]}`;
  return t;
}

interface Unit {
  unit: string;
  model: 'lecture' | 'quiz' | 'practicalTask';
  id: string;
  current: string;
  desired: string;
}

async function writeTitle(db: Db, u: Unit): Promise<void> {
  if (u.model === 'lecture') await db.lecture.update({ where: { id: u.id }, data: { title: u.desired } });
  else if (u.model === 'quiz') await db.quiz.update({ where: { id: u.id }, data: { title: u.desired } });
  else await db.practicalTask.update({ where: { id: u.id }, data: { title: u.desired } });
}

async function readTitle(db: Db, u: Unit): Promise<string> {
  if (u.model === 'lecture') return (await db.lecture.findUniqueOrThrow({ where: { id: u.id }, select: { title: true } })).title;
  if (u.model === 'quiz') return (await db.quiz.findUniqueOrThrow({ where: { id: u.id }, select: { title: true } })).title;
  return (await db.practicalTask.findUniqueOrThrow({ where: { id: u.id }, select: { title: true } })).title;
}

async function main(): Promise<number> {
  const args = parseArgs(SCRIPT);
  const report = new Report(SCRIPT, args.apply);
  const course = await loadCourse();
  const units: Unit[] = [];

  for (const lang of args.langs) {
    const v = course.versions[lang];
    if (!v) continue;
    for (const l of v.lectures) {
      const code = lectureCode(lang, l.number);
      const title = lectureTitleFor(lang, l.number, l.title);
      units.push({ unit: `lecture:${code}`, model: 'lecture', id: l.id, current: l.title, desired: title });
      if (l.miniQuiz) {
        units.push({ unit: `mini:${code}`, model: 'quiz', id: l.miniQuiz.id, current: l.miniQuiz.title, desired: localizedTitle('LECTURE_MINI', lang, title) });
      }
    }
    for (const m of v.modules) {
      if (m.quiz && m.quiz.kind === 'MODULE_FINAL') {
        units.push({ unit: `module-quiz:${lang}:M${m.orderIndex + 1}`, model: 'quiz', id: m.quiz.id, current: m.quiz.title, desired: localizedTitle('MODULE_FINAL', lang, m.title) });
      }
      if (m.practicalTask) {
        // Итоговое практическое по всему курсу — только метка; практикум обычного модуля — с названием модуля.
        const desired = m.coversWholeCourse ? localizedTitle('PRACTICAL', lang) : localizedTitle('PRACTICAL', lang, m.title);
        units.push({ unit: `practical:${lang}`, model: 'practicalTask', id: m.practicalTask.id, current: m.practicalTask.title, desired });
      }
    }
    if (v.finalMiniQuiz) {
      units.push({ unit: `course-final:${lang}`, model: 'quiz', id: v.finalMiniQuiz.id, current: v.finalMiniQuiz.title, desired: localizedTitle('COURSE_FINAL', lang) });
    }
  }

  const preview: unknown[] = [];
  for (const u of units) {
    const problem = lectureTitleProblem(u.desired);
    if (problem) {
      report.line(u.unit, 'error', `${problem}: «${u.desired}»`);
      continue;
    }
    if (u.current === u.desired) {
      report.line(u.unit, 'skip', 'название уже верное');
      continue;
    }
    const key = ledgerKey(SCRIPT, u.unit);
    const applied = await ledgerGet(prisma, key);
    if (applied && !args.force) {
      report.line(u.unit, 'skip', `применено ранее, затем изменено вручную («${u.current.slice(0, 60)}») — не трогаю без --force`);
      continue;
    }
    preview.push({ unit: u.unit, from: u.current, to: u.desired });
    if (!args.apply) {
      report.line(u.unit, 'would-change', `«${u.current.slice(0, 70)}» → «${u.desired.slice(0, 90)}»`);
      continue;
    }
    const done = await prisma.$transaction(async (tx) => {
      if ((await readTitle(tx, u)) !== u.current) return false;
      await writeTitle(tx, u);
      if (applied) await tx.contentMigration.update({ where: { key }, data: { detail: { from: u.current, to: u.desired, forced: true } } });
      else await ledgerPut(tx, key, { from: u.current, to: u.desired });
      return true;
    });
    report.line(u.unit, done ? 'changed' : 'skip', done ? `→ «${u.desired.slice(0, 90)}»` : 'название изменилось во время работы');
  }

  console.log(`\n${report.summary()}`);
  if (!args.apply) console.log(`Предпросмотр: ${writePreview(args, preview)}`);
  return report.errors ? 1 : 0;
}

run(main);
