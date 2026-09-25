import type { Prisma } from '@prisma/client';

/**
 * Служебные (тестовые) аккаунты в исследовательскую выгрузку не попадают.
 * Признак — зарезервированный для примеров и тестов домен email (RFC 2606, RFC 6761):
 * example.com / example.net / example.org и зоны .test, .example, .invalid, .localhost.
 * У настоящего студента такого адреса быть не может, а QA-проверки и скрипты создают
 * пользователей именно так (qa-…@example.com). Схема БД не меняется — флага isTest нет.
 */
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'] as const;
const RESERVED_TLDS = ['test', 'example', 'invalid', 'localhost'] as const;

const SUFFIXES = [...RESERVED_DOMAINS.map((d) => `@${d}`), ...RESERVED_DOMAINS.map((d) => `.${d}`), ...RESERVED_TLDS.map((t) => `.${t}`)];

/** Тестовый ли аккаунт (по домену email, без учёта регистра). */
export function isTestAccountEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  return SUFFIXES.some((s) => e.endsWith(s));
}

/** Фильтр Prisma: пользователь — тестовый аккаунт (то же правило, что isTestAccountEmail). */
export const testAccountWhere: Prisma.UserWhereInput = {
  OR: SUFFIXES.map((s) => ({ email: { endsWith: s, mode: 'insensitive' as const } })),
};

/** Фильтр Prisma: пользователь — НЕ тестовый аккаунт (участник исследования). */
export const realUserWhere: Prisma.UserWhereInput = { NOT: testAccountWhere };
