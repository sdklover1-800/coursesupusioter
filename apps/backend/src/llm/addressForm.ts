import type { Language } from '@edu/shared';

/**
 * Детерминированная проверка фиксированной формы обращения (калибровка A.2) в тексте,
 * который увидит студент: ru «вы», kk «Сіз», en — нейтрально. Возвращает найденные
 * неформальные формы (пусто — нарушений нет).
 *
 * Проверка намеренно простая: ложное срабатывание лишь выбрасывает строку отзыва
 * (её заменяет нейтральная строка), а пропуск показывает студенту «ты»/«сен».
 */

const L = '\\p{L}';
const words = (alts: string) => new RegExp(`(?<!${L})(?:${alts})(?!${L})`, 'giu');

const RU_TY = words('ты|тебе|тебя|тобой|твой|твоя|твоё|твое|твои|твоего|твоей|твоему|твоим|твоих|твою');
const RU_TY_VERB = new RegExp(`(?<!${L})${L}{2,}(?:ешь|ёшь|ишь)(?!${L})`, 'giu');
const RU_TY_VERB_OK = new Set(['лишь', 'тишь', 'мышь', 'глушь', 'кишь']);
const RU_TY_IMPERATIVE = words(
  'подумай|скажи|попробуй|назови|объясни|посмотри|вспомни|сформулируй|опиши|определи|сравни|приведи|уточни|представь|ответь|обрати|проверь|свяжи|раздели|выдели|покажи|реши|напиши|продолжи|начни|разбери|оцени|перечисли|учти',
);

const KK_SEN = words('сен|сенің|саған|сені|сенде|сенен|сенімен|сендер|сендерге|өзің|өзіңе|өзіңді|өзіңнің|өзіңде');
const KK_SEN_VERB = new RegExp(`(?<!${L})${L}{2,}(?:сың|сің|сыңдар|сіңдер)(?!${L})`, 'giu');
/**
 * Притяжательная форма на «сен» с падежом: «репликаңда», «жауабыңды», «ойыңа», «пікіріңнен».
 * Форма на «Сіз» («репликаңызда», «жауабыңызды») сюда не попадает: между «ң» и падежом — «ыз/із».
 * Основа должна быть не короче трёх букв — так не задеваются «таңда», «теңге», «мыңда», «жаңа».
 */
const KK_VOWELS = 'аәеиоөуұүыіэюя';
const KK_CASE = 'да|де|та|те|ды|ді|ты|ті|ға|ге|қа|ке|а|е|нан|нен|дан|ден|тан|тен|мен|ның|нің';
const KK_SEN_POSSESSIVE = new RegExp(
  `(?<!${L})(?:${L}{2,}[${KK_VOWELS}]ң|${L}+[^${KK_VOWELS}\\P{L}](?:ың|ің))(?:${KK_CASE})(?!${L})`,
  'giu',
);
/** Корни, где «ң» — часть основы, а не притяжательный показатель («кезеңде», «көлеңке»). */
const KK_NG_STEMS = ['кезең', 'көлең', 'бәсең', 'керең', 'сараң', 'жалаң', 'ашаң'];

const EN_INFORMAL = /\b(?:thou|thee|thy|u|ya|dude|buddy|mate)\b/gi;

function collect(text: string, re: RegExp, skip: (w: string) => boolean = () => false): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(re)) if (!skip(m[0].toLowerCase())) hits.push(m[0]);
  return hits;
}

/** Неформальные формы обращения в тексте на языке сессии. */
export function informalAddress(text: string, language: Language): string[] {
  if (language === 'ru') {
    return [...collect(text, RU_TY), ...collect(text, RU_TY_VERB, (w) => RU_TY_VERB_OK.has(w)), ...collect(text, RU_TY_IMPERATIVE)];
  }
  if (language === 'kk') {
    return [
      ...collect(text, KK_SEN),
      ...collect(text, KK_SEN_VERB),
      ...collect(text, KK_SEN_POSSESSIVE, (w) => KK_NG_STEMS.some((s) => w.startsWith(s))),
    ];
  }
  return collect(text, EN_INFORMAL);
}
