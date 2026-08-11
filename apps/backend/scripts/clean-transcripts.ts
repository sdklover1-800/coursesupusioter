/**
 * Очистка расшифровок от артефактов исходных .docx (одноразовая, идемпотентная).
 *
 * Что чистим:
 *  1) UI-мусор и оставленные автором инструкции («Show more», «переведи на казахский»);
 *  2) «хвосты» на чужом языке — последние абзацы, попавшие в версию другого языка
 *     при разборе чередующихся языковых блоков.
 *
 * Расшифровки — вход ИИ-генерации (§5.2), поэтому мусор в них портит материалы.
 * Запуск: npx tsx scripts/clean-transcripts.ts [--apply]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const ARTIFACTS: RegExp[] = [
  /^\s*Show (more|less)\s*$/gim,
  /\bShow (more|less)\b/gi,
  /^.*\bпереведи\s+на\s+(казахский|английский|русский)\b.*$/gim,
  /^.*\btranslate\s+(to|into)\s+\w+\b.*$/gim,
];

const KK = /[әғқңөұүһі]/g;

/** Доминирующий язык абзаца (грубо, для отсечения хвостов). */
function paraLang(s: string): 'kk' | 'ru' | 'en' | null {
  const kk = (s.match(KK) || []).length;
  const ru = (s.match(/[а-яё]/gi) || []).length;
  const en = (s.match(/[a-z]/gi) || []).length;
  if (en > (ru + kk) * 1.2 && en > 8) return 'en';
  if (kk >= 2) return 'kk';
  if (ru > 4) return 'ru';
  return null; // цифры/таймкоды — не считаем
}

/**
 * Срезает хвост из абзацев на чужом языке.
 *
 * Тонкость: в конце русских версий встречаются казахские глоссарии терминов, где
 * часть строк («Неоинституционализм», «Постмодернизм») орфографически одинакова в
 * обоих языках. Такие короткие термины не должны останавливать обрезку, поэтому
 * они считаются «неоднозначными» и пропускаются. Останавливаемся только на связном
 * тексте своего языка. Режем лишь если в хвосте есть хотя бы один ЯВНО чужой абзац —
 * иначе легитимная концовка из коротких строк осталась бы нетронутой.
 */
const AMBIGUOUS_MAX = 40; // короткая строка-термин: язык определить нельзя

function trimAlienTail(text: string, lang: string): string {
  const paras = text.split('\n');
  let end = paras.length;
  let sawAlien = false;

  for (let i = paras.length - 1; i >= 0; i--) {
    const p = paras[i]!.trim();
    if (!p) { end = i; continue; }
    const l = paraLang(p);

    if (l && l !== lang) { sawAlien = true; end = i; continue; }          // явно чужой
    if (p.length <= AMBIGUOUS_MAX) { end = i; continue; }                  // короткий термин — пропускаем
    break;                                                                 // связный текст своего языка
  }
  return sawAlien ? paras.slice(0, end).join('\n').trimEnd() : text;
}

async function main() {
  const lectures = await prisma.lecture.findMany({
    include: { module: { include: { languageVersion: { select: { language: true, title: true } } } } },
  });

  let changed = 0;
  for (const l of lectures) {
    const lang = l.module.languageVersion.language;
    let text = l.transcriptText;
    const before = text.length;

    for (const re of ARTIFACTS) text = text.replace(re, '');
    text = trimAlienTail(text, lang);
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    if (text !== l.transcriptText) {
      changed++;
      const delta = before - text.length;
      console.log(`  [${lang}] ${l.title.slice(0, 46)} — снято ${delta} симв.`);
      if (APPLY) await prisma.lecture.update({ where: { id: l.id }, data: { transcriptText: text } });
    }
  }
  console.log(`\n${APPLY ? '✅ Применено' : 'Предпросмотр (без --apply)'}: изменено лекций ${changed} из ${lectures.length}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
