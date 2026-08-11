import { describe, it, expect } from 'vitest';
import { extractYoutubeId } from './youtube.js';
import { AppError } from './errors.js';

describe('extractYoutubeId (FR-4.3)', () => {
  it('сырой 11-символьный ID', () => {
    expect(extractYoutubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('watch?v=', () => {
    expect(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('watch?v= с доп. параметрами', () => {
    expect(extractYoutubeId('https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=x')).toBe('dQw4w9WgXcQ');
  });
  it('youtu.be короткая ссылка', () => {
    expect(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('embed', () => {
    expect(extractYoutubeId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('shorts', () => {
    expect(extractYoutubeId('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('пробелы обрезаются', () => {
    expect(extractYoutubeId('  dQw4w9WgXcQ  ')).toBe('dQw4w9WgXcQ');
  });
  it('мусор → ошибка', () => {
    expect(() => extractYoutubeId('не ссылка')).toThrow(AppError);
  });
  it('короткий id → ошибка', () => {
    expect(() => extractYoutubeId('abc')).toThrow(AppError);
  });
});
