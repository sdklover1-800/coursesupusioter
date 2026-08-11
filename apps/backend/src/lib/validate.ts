import type { ZodTypeAny, output } from 'zod';
import { Errors } from './errors.js';

/**
 * Валидация/санитизация на границе API (NFR-2.4).
 * Все входные данные проходят через Zod до бизнес-логики.
 * Возвращает ВЫХОДНОЙ тип схемы (z.output) — поля с .default() не «optional».
 */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw Errors.validation('Ошибка валидации входных данных', result.error.flatten());
  }
  return result.data as output<S>;
}
