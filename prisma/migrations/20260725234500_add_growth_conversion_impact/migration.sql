CREATE TABLE "growth_conversions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "creativeId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "externalId" TEXT,
  "contactRef" TEXT,
  "revenueCents" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "notes" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "growth_conversions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "growth_conversions_userId_occurredAt_idx"
  ON "growth_conversions"("userId", "occurredAt");
CREATE INDEX "growth_conversions_creativeId_idx"
  ON "growth_conversions"("creativeId");
CREATE UNIQUE INDEX "growth_conversions_userId_source_externalId_key"
  ON "growth_conversions"("userId", "source", "externalId");

CREATE TABLE "impact_assumptions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "minutesPerTraditionalVideo" INTEGER NOT NULL DEFAULT 120,
  "agencyCostPerVideoCents" INTEGER NOT NULL DEFAULT 50000,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "impact_assumptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "impact_assumptions_userId_key"
  ON "impact_assumptions"("userId");

CREATE TABLE "growth_operator_schedules" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "cadence" TEXT NOT NULL DEFAULT 'daily',
  "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
  "maxDecisions" INTEGER NOT NULL DEFAULT 1,
  "nextRunAt" TIMESTAMP(3),
  "lastRunAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "growth_operator_schedules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "growth_operator_schedules_userId_key"
  ON "growth_operator_schedules"("userId");
CREATE INDEX "growth_operator_schedules_enabled_nextRunAt_idx"
  ON "growth_operator_schedules"("enabled", "nextRunAt");
