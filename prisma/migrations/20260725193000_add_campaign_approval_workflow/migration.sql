ALTER TABLE "ad_creatives"
  ADD COLUMN "recommendationReason" TEXT,
  ADD COLUMN "expectedResult" TEXT,
  ADD COLUMN "estimatedCostCents" INTEGER,
  ADD COLUMN "rightsStatus" TEXT NOT NULL DEFAULT 'UNCONFIRMED',
  ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'AWAITING_REVIEW',
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "approvedRevision" INTEGER,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedByUserId" TEXT,
  ADD COLUMN "reviewNote" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "ad_creatives_userId_approvalStatus_idx"
  ON "ad_creatives"("userId", "approvalStatus");

ALTER TYPE "AIGenerationType" ADD VALUE IF NOT EXISTS 'GROWTH_DECISION';
