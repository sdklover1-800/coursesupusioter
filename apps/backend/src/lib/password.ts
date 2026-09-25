import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
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

/**
 * Хеш-«приманка» с теми же параметрами argon2id, что и настоящие: считается один раз
 * при старте (не на первом запросе — иначе первый вход с неизвестным email был бы
 * заметно дольше). Пароль случайный и нигде не хранится — совпасть с ним нельзя.
 */
let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('base64url'));
  return dummyHash;
}
void getDummyHash();

/**
 * Проверка пароля с постоянной стоимостью (защита от перечисления по времени ответа):
 * если пользователя нет (hash = null), argon2 всё равно выполняется — над приманкой,
 * и результат всегда false. Время ответа входа не зависит от существования email.
 */
export async function verifyPasswordConstantTime(hash: string | null | undefined, plain: string): Promise<boolean> {
  if (hash) return verifyPassword(hash, plain);
  await verifyPassword(await getDummyHash(), plain);
  return false;
}

// Без похожих символов (0/O, 1/l) — читаемый стартовый пароль (FR-1.4).
const nano = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz', 12);

/** Генерация стартового пароля при создании/импорте студента (FR-1.4). */
export function generateStartPassword(): string {
  return nano();
}
