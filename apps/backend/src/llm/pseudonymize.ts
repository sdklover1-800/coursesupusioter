/**
 * Псевдонимизация на границе (DP-5, §9.3).
 * LLM-шлюз — ЕДИНСТВЕННАЯ точка выхода данных наружу. Он обязан вычистить
 * прямые идентификаторы из контекста: наружу не уходят email, имя, телефон —
 * только псевдо-ID. Это второй рубеж: бизнес-логика и так передаёт лишь псевдо-ID,
 * но шлюз страхует от случайной утечки идентификаторов в тексте промпта.
 */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Телефоны РК/международные (грубая эвристика)
const PHONE_RE = /(\+?\d[\d\s\-()]{9,}\d)/g;
// ИИН РК (12 цифр)
const IIN_RE = /\b\d{12}\b/g;

export interface PseudonymizeResult {
  text: string;
  redactions: number;
}

export function pseudonymizeText(input: string): PseudonymizeResult {
  let redactions = 0;
  const text = input
    .replace(EMAIL_RE, () => {
      redactions++;
      return '[REDACTED_EMAIL]';
    })
    .replace(IIN_RE, () => {
      redactions++;
      return '[REDACTED_ID]';
    })
    .replace(PHONE_RE, (m) => {
      // не трогаем короткие числовые последовательности внутри учебного текста
      if (m.replace(/\D/g, '').length < 10) return m;
      redactions++;
      return '[REDACTED_PHONE]';
    });
  return { text, redactions };
}

/** Применить псевдонимизацию к каждому сообщению перед отправкой провайдеру. */
export function pseudonymizeMessages(
  messages: { role: string; content: string }[],
): { messages: { role: string; content: string }[]; redactions: number } {
  let total = 0;
  const cleaned = messages.map((m) => {
    const r = pseudonymizeText(m.content);
    total += r.redactions;
    return { role: m.role, content: r.text };
  });
  return { messages: cleaned, redactions: total };
}
