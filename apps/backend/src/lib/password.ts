import argon2 from 'argon2';
import { customAlphabet } from 'nanoid';

/**
 * Хеширование паролей (FR-1.1, NFR-2.2): argon2id. Открытые пароли не хранятся.
 */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain).catch(() => false);
}

// Без похожих символов (0/O, 1/l) — читаемый стартовый пароль (FR-1.4).
const nano = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz', 12);

/** Генерация стартового пароля при создании/импорте студента (FR-1.4). */
export function generateStartPassword(): string {
  return nano();
}
