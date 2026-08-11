import { Errors } from './errors.js';

/**
 * Извлечение и валидация YouTube video ID из URL или «сырого» ID (FR-4.3).
 * Поддержка watch?v=, youtu.be/, embed/, shorts/.
 */
const ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export function extractYoutubeId(input: string): string {
  const raw = input.trim();
  if (ID_RE.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.split('/').filter(Boolean)[0] ?? '';
      if (ID_RE.test(id)) return id;
    }
    const v = url.searchParams.get('v');
    if (v && ID_RE.test(v)) return v;
    const parts = url.pathname.split('/').filter(Boolean);
    const idx = parts.findIndex((p) => p === 'embed' || p === 'shorts');
    if (idx !== -1 && parts[idx + 1] && ID_RE.test(parts[idx + 1]!)) return parts[idx + 1]!;
  } catch {
    /* not a URL */
  }
  throw Errors.badRequest('Не удалось распознать YouTube video ID');
}
