-- NFR-1.8: окно доступности практического задания
ALTER TABLE "PracticalTask" ADD COLUMN "availableFrom" TIMESTAMP(3);
ALTER TABLE "PracticalTask" ADD COLUMN "availableUntil" TIMESTAMP(3);
