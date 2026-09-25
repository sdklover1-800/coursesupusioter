import { describe, it, expect } from 'vitest';
import { isLocalUrl, resolvePublicAppUrl } from './publicUrl.js';

describe('resolvePublicAppUrl (ссылки и QR проверки сертификата)', () => {
  it('явный PUBLIC_APP_URL важнее FRONTEND_ORIGIN; хвостовой / убирается', () => {
    expect(resolvePublicAppUrl('https://eduopen.kz/', 'http://localhost:5173')).toBe('https://eduopen.kz');
  });

  it('пусто — первый адрес из FRONTEND_ORIGIN (прод со старым .env.prod)', () => {
    expect(resolvePublicAppUrl('', 'https://eduopen.kz')).toBe('https://eduopen.kz');
    expect(resolvePublicAppUrl('  ', ' https://eduopen.kz , https://www.eduopen.kz')).toBe('https://eduopen.kz');
  });
});

describe('isLocalUrl (прод не стартует с QR на localhost)', () => {
  it('локальные адреса и мусор', () => {
    for (const u of ['http://localhost:5173', 'http://127.0.0.1:4000', 'http://[::1]:5173', 'http://app.localhost', 'not a url', '']) {
      expect(isLocalUrl(u), u).toBe(true);
    }
  });

  it('боевой домен — не локальный', () => {
    expect(isLocalUrl('https://eduopen.kz')).toBe(false);
    expect(isLocalUrl('https://lms.esil.edu.kz')).toBe(false);
  });
});
