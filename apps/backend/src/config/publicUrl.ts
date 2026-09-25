/**
 * Публичный адрес сайта — ссылки и QR проверки сертификата (/verify/:serial).
 * PUBLIC_APP_URL важнее; пусто — первый адрес из FRONTEND_ORIGIN (CORS-белый список,
 * в проде это реальный домен). Так прод, где .env.prod заведён до появления
 * PUBLIC_APP_URL, не выдаёт сертификаты с QR на localhost. Хвостовой «/» отбрасывается.
 */
export function resolvePublicAppUrl(publicAppUrl: string, frontendOrigin: string): string {
  const explicit = publicAppUrl.trim();
  const fallback = frontendOrigin.split(',').map((s) => s.trim()).find(Boolean) ?? '';
  return (explicit || fallback).replace(/\/+$/, '');
}

/** Адрес ведёт на локальную машину — в проде недопустим (QR сертификата был бы нерабочим). */
export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '0.0.0.0' || host === '[::1]' || host.startsWith('127.') || host.endsWith('.localhost');
  } catch {
    return true; // не URL — тоже непригоден для ссылки в сертификате
  }
}
