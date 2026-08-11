-- Мини-квизы: вид теста + тренировочный флаг + привязка к лекции/курсу
CREATE TYPE "QuizKind" AS ENUM ('MODULE_FINAL', 'LECTURE_MINI', 'COURSE_FINAL');

ALTER TABLE "Quiz" ADD COLUMN "kind" "QuizKind" NOT NULL DEFAULT 'MODULE_FINAL';
ALTER TABLE "Quiz" ADD COLUMN "isGraded" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Quiz" ADD COLUMN "lectureId" TEXT;
ALTER TABLE "Quiz" ADD COLUMN "courseLanguageVersionId" TEXT;

-- moduleId становится необязательным (у мини-квизов его нет)
ALTER TABLE "Quiz" ALTER COLUMN "moduleId" DROP NOT NULL;

CREATE UNIQUE INDEX "Quiz_lectureId_key" ON "Quiz"("lectureId");
CREATE UNIQUE INDEX "Quiz_courseLanguageVersionId_key" ON "Quiz"("courseLanguageVersionId");

ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_lectureId_fkey"
  FOREIGN KEY ("lectureId") REFERENCES "Lecture"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_courseLanguageVersionId_fkey"
  FOREIGN KEY ("courseLanguageVersionId") REFERENCES "CourseLanguageVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
