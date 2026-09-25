-- Заявки на курс из публичного каталога: студент подаёт заявку (PENDING),
-- менеджер/админ одобряет (ACTIVE) или отклоняет (REJECTED). Доступ к контенту —
-- только ACTIVE/COMPLETED. Прямая запись менеджером по-прежнему создаёт ACTIVE.
-- PostgreSQL ≥ 12: несколько ADD VALUE в одной миграции допустимы (новые значения
-- в этой же миграции не используются).
ALTER TYPE "EnrollmentStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "EnrollmentStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- Когда подана заявка и кто/когда/с каким комментарием её рассмотрел
ALTER TABLE "Enrollment" ADD COLUMN "requestedAt" TIMESTAMP(3),
ADD COLUMN "reviewNote" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewedById" TEXT;

-- Очередь заявок и счётчики фильтруют по статусу
CREATE INDEX "Enrollment_status_idx" ON "Enrollment"("status");

ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
