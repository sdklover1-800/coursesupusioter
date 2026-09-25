/**
 * Санитизация реплики тьютора ДО сохранения и отправки (калибровка A.2, находки e, h; A22).
 * Чистые функции без env/БД — покрыты тестами.
 *
 * 1) Снимаем markdown (жирный, заголовки, маркеры списков, обратные кавычки, ссылки):
 *    промпт требует простой текст, но модель иногда его нарушает.
 * 2) Схлопываем пробелы: реплика — один абзац.
 * 3) Ограничиваем длину по предложениям: ВСЕГДА сохраняем последнее вопросительное
 *    предложение (единственный наводящий вопрос), сначала выбрасываем более ранние
 *    предложения и никогда не режем внутри предложения.
 */

/** Снимает markdown-разметку; возвращает текст и признак, что разметка была. */
export function stripMarkdown(input: string): { text: string; hadMarkdown: boolean } {
  let hadMarkdown = false;
  const mark = (re: RegExp, s: string) => {
    if (re.test(s)) hadMarkdown = true;
    re.lastIndex = 0;
  };
  let s = input.replace(/\r\n?/g, '\n');

  // Огороженный код: оставляем содержимое без ```
  mark(/```/, s);
  s = s.replace(/```[a-zA-Z0-9_-]*\n?/g, '');
  // Ссылки [текст](url) → текст
  mark(/\[([^\]]+)\]\(([^)]+)\)/, s);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');

  const lines = s.split('\n').map((line) => {
    let l = line;
    // Заголовки и цитаты в начале строки
    if (/^\s{0,3}#{1,6}\s*/.test(l) || /^\s{0,3}>\s?/.test(l)) hadMarkdown = true;
    l = l.replace(/^\s{0,3}#{1,6}\s*/, '').replace(/^\s{0,3}>\s?/, '');
    // Маркеры списков: -, *, +, •, ·, –, — и нумерация 1. / 1)
    if (/^\s*(?:[-*+•·–—]|\d{1,2}[.)])\s+/.test(l)) hadMarkdown = true;
    l = l.replace(/^\s*(?:[-*+•·–—]|\d{1,2}[.)])\s+/, '');
    return l;
  });
  s = lines.filter((l) => l.trim() !== '').join('\n');

  // Жирный/курсив и код в строке
  mark(/\*\*|__|`/, s);
  s = s.replace(/\*\*/g, '').replace(/__/g, '').replace(/`/g, '');
  // Одиночные звёздочки (курсив *…*) в простом тексте смысла не несут
  mark(/\*/, s);
  s = s.replace(/\*/g, '');

  return { text: s, hadMarkdown };
}

/** Схлопывает переносы и пробелы в один абзац; строка без знака конца получает точку. */
export function collapseWhitespace(input: string): string {
  const lines = input
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean);
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!out) {
      out = line;
      continue;
    }
    // Бывшие пункты списка без знака препинания склеиваем через «;», чтобы не слиплись слова.
    const prevEndsSentence = /[.!?…:;,»")\]]$/.test(out);
    out += prevEndsSentence ? ` ${line}` : `; ${line}`;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Разбивка на предложения; знак конца (и закрывающая кавычка/скобка) остаются в предложении. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…]+["»”')\]]*)\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

const isQuestion = (s: string) => /\?["»”')\]]*$/u.test(s);

export interface ClampResult {
  text: string;
  /** Предложения выброшены ради лимита */
  clamped: boolean;
  /** Даже одно вопросительное предложение длиннее лимита (вызывающий решает, что делать) */
  overLimit: boolean;
}

/**
 * Ограничение длины по предложениям (A22). Сохраняет последнее вопросительное
 * предложение, выбрасывает хвост после него (например, оборванный текст) и самые
 * ранние предложения; внутри предложения не режет никогда.
 */
export function clampSentenceAware(text: string, maxChars: number): ClampResult {
  const t = text.trim();
  if (t.length <= maxChars) return { text: t, clamped: false, overLimit: false };

  const sentences = splitSentences(t);
  let q = -1;
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (isQuestion(sentences[i]!)) {
      q = i;
      break;
    }
  }
  // Вопроса нет — опорным считаем последнее законченное предложение.
  if (q === -1) {
    q = sentences.length - 1;
    for (let i = sentences.length - 1; i >= 0; i--) {
      if (/[.!?…]["»”')\]]*$/u.test(sentences[i]!)) {
        q = i;
        break;
      }
    }
  }
  const anchor = sentences[q]!;
  if (anchor.length > maxChars) return { text: anchor, clamped: true, overLimit: true };

  const kept = [anchor];
  let len = anchor.length;
  for (let i = q - 1; i >= 0; i--) {
    const s = sentences[i]!;
    if (len + 1 + s.length > maxChars) break;
    kept.unshift(s);
    len += 1 + s.length;
  }
  return { text: kept.join(' '), clamped: true, overLimit: false };
}

export interface SanitizeResult extends ClampResult {
  hadMarkdown: boolean;
}

/** Полная санитизация реплики тьютора: markdown → один абзац → лимит по предложениям. */
export function sanitizeTutorReply(raw: string, maxChars: number): SanitizeResult {
  const { text, hadMarkdown } = stripMarkdown(raw);
  const collapsed = collapseWhitespace(text);
  return { ...clampSentenceAware(collapsed, maxChars), hadMarkdown };
}

/** Число вопросительных знаков — для контроля формы «ровно один наводящий вопрос». */
export function questionMarkCount(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}
