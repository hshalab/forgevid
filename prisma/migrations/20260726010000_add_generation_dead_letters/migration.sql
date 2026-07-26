CREATE TABLE "generation_dead_letters" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "videoId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "jobData" TEXT NOT NULL,
  "error" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "replayedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "generation_dead_letters_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "generation_dead_letters_userId_status_createdAt_idx"
  ON "generation_dead_letters"("userId", "status", "createdAt");
CREATE INDEX "generation_dead_letters_videoId_idx"
  ON "generation_dead_letters"("videoId");
