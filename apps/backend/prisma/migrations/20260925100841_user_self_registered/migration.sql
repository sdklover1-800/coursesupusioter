-- Самостоятельная регистрация из каталога: владение email не проверяется, поэтому
-- такие аккаунты помечаются для админа (очередь заявок, список пользователей).
ALTER TABLE "User" ADD COLUMN "selfRegisteredAt" TIMESTAMP(3);

-- Заполнение для уже созданных саморегистрацией аккаунтов — по журналу аудита.
UPDATE "User" u
SET "selfRegisteredAt" = a."createdAt"
FROM "AuditLog" a
WHERE a."action" = 'USER_SELF_REGISTERED'
  AND a."targetId" = u."id"
  AND u."selfRegisteredAt" IS NULL;
