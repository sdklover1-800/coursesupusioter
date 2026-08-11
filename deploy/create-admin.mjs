/**
 * Создание (или сброс пароля) первого администратора на проде.
 *
 * Нужен потому, что POST /api/admin/users требует уже существующего ADMIN,
 * а prisma/seed.ts — dev-сид: он заводит демо-аккаунты с публично известными
 * паролями и на проде запускаться не должен.
 *
 * Запуск:
 *   docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm \
 *     -e ADMIN_EMAIL=admin@esil.edu.kz -e ADMIN_PASSWORD='…' \
 *     migrate node /app/deploy/create-admin.mjs
 *
 * Пароль передаётся переменной окружения одноразового контейнера и не
 * попадает ни в .env.prod, ни в образ. В истории shell — попадает:
 * очистите её или используйте `read -rs ADMIN_PASSWORD`.
 */
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME?.trim() || 'Администратор';
const language = process.env.ADMIN_LANGUAGE?.trim() || 'ru';

if (!email || !password) {
  console.error('Нужны ADMIN_EMAIL и ADMIN_PASSWORD');
  process.exit(1);
}
if (password.length < 12) {
  console.error('Пароль администратора должен быть не короче 12 символов');
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { email },
    // Для существующей учётки — сброс пароля и подтверждение роли,
    // остальные поля (когорта, согласие) не трогаем.
    update: { passwordHash, role: 'ADMIN', isActive: true, mustChangePassword: false },
    create: { email, name, role: 'ADMIN', interfaceLanguage: language, passwordHash },
  });
  console.log(`✅ Администратор готов: ${user.email} (id=${user.id})`);
} catch (err) {
  console.error('❌ Не удалось создать администратора:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
