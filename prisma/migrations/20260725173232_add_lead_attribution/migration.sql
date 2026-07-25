-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'SAMPLE_SENT', 'REPLIED', 'MEETING', 'PILOT', 'PAID', 'RETAINED', 'DEAD');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "isRelatedParty" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "creativeId" TEXT,
    "vertical" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "source" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "isRelatedParty" BOOLEAN NOT NULL DEFAULT false,
    "revenueCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "testimonialConsent" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "sampleSentAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_userId_idx" ON "leads"("userId");

-- CreateIndex
CREATE INDEX "leads_creativeId_idx" ON "leads"("creativeId");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");
