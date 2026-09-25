-- CreateEnum
CREATE TYPE "QuizReviewPolicy" AS ENUM ('FULL_AFTER_FINAL', 'SCORE_UNTIL_FINAL', 'SCORE_ONLY');

-- CreateEnum
CREATE TYPE "QuizScoringRule" AS ENUM ('BEST', 'FIRST');

-- CreateEnum
CREATE TYPE "ContentIssueTarget" AS ENUM ('QUIZ_QUESTION', 'CHAT_MESSAGE', 'LECTURE', 'PRACTICAL_TASK');

-- CreateEnum
CREATE TYPE "ContentIssueStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ContentIssueOrigin" AS ENUM ('STUDENT', 'SYSTEM');

-- AlterEnum
ALTER TYPE "GenerationType" ADD VALUE 'LECTURE_SUMMARY';

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "leakCheck" JSONB,
ADD COLUMN     "reasoningTokens" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "lastActivityAt" TIMESTAMP(3),
ADD COLUMN     "lastLectureId" TEXT;

-- AlterTable
ALTER TABLE "Lecture" ADD COLUMN     "durationSec" INTEGER,
ADD COLUMN     "summary" TEXT;

-- AlterTable
ALTER TABLE "LectureProgress" ADD COLUMN     "lastViewedAt" TIMESTAMP(3),
ADD COLUMN     "positionSec" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "watchedSec" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PracticalSession" ADD COLUMN     "endReason" TEXT,
ADD COLUMN     "excusedAt" TIMESTAMP(3),
ADD COLUMN     "excusedById" TEXT,
ADD COLUMN     "metrics" JSONB,
ADD COLUMN     "summary" JSONB,
ADD COLUMN     "summaryStatus" TEXT,
ADD COLUMN     "taskSnapshot" JSONB,
ADD COLUMN     "verdictCode" TEXT;

-- AlterTable
ALTER TABLE "PracticalTask" ADD COLUMN     "agenda" JSONB,
ADD COLUMN     "canonicalRef" TEXT,
ADD COLUMN     "estimatedMinutes" INTEGER,
ADD COLUMN     "introMessage" TEXT,
ADD COLUMN     "maxSessions" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "Quiz" ADD COLUMN     "cooldownMinutes" INTEGER,
ADD COLUMN     "reviewPolicy" "QuizReviewPolicy" NOT NULL DEFAULT 'FULL_AFTER_FINAL',
ADD COLUMN     "scoringRule" "QuizScoringRule" NOT NULL DEFAULT 'BEST';

-- AlterTable
ALTER TABLE "QuizAttempt" ADD COLUMN     "activeDurationSec" INTEGER,
ADD COLUMN     "autoSubmitted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "flagged" JSONB,
ADD COLUMN     "integrityAck" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastSavedAt" TIMESTAMP(3),
ADD COLUMN     "legacy" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "presentation" JSONB,
ADD COLUMN     "unansweredCount" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "answers" SET DEFAULT '{}',
ALTER COLUMN "score" SET DEFAULT 0,
ALTER COLUMN "passed" SET DEFAULT false;

-- AlterTable
ALTER TABLE "QuizQuestion" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "canonicalKey" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "optionRationales" JSONB,
ADD COLUMN     "sourceLectureId" TEXT,
ADD COLUMN     "sourceTimecode" TEXT;

-- CreateTable
CREATE TABLE "ContentIssue" (
    "id" TEXT NOT NULL,
    "origin" "ContentIssueOrigin" NOT NULL DEFAULT 'STUDENT',
    "reporterId" TEXT,
    "enrollmentId" TEXT,
    "targetType" "ContentIssueTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "comment" TEXT,
    "context" TEXT NOT NULL,
    "courseId" TEXT,
    "languageVersionId" TEXT,
    "status" "ContentIssueStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "note" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentMigration" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detail" JSONB,

    CONSTRAINT "ContentMigration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentIssue_dedupeKey_key" ON "ContentIssue"("dedupeKey");

-- CreateIndex
CREATE INDEX "ContentIssue_status_courseId_idx" ON "ContentIssue"("status", "courseId");

-- CreateIndex
CREATE INDEX "ContentIssue_targetType_targetId_idx" ON "ContentIssue"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ContentIssue_origin_status_idx" ON "ContentIssue"("origin", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContentMigration_key_key" ON "ContentMigration"("key");

-- CreateIndex
CREATE INDEX "QuizAttempt_enrollmentId_quizId_idx" ON "QuizAttempt"("enrollmentId", "quizId");

-- CreateIndex
CREATE INDEX "QuizQuestion_canonicalKey_idx" ON "QuizQuestion"("canonicalKey");

-- AddForeignKey
ALTER TABLE "ContentIssue" ADD CONSTRAINT "ContentIssue_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
