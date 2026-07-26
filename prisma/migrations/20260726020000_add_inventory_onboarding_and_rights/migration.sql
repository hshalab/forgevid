CREATE TABLE "inventory_sources" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "vertical" TEXT NOT NULL,
  "feedUrl" TEXT NOT NULL,
  "credentialCiphertext" TEXT,
  "fieldMapping" TEXT,
  "authorizationBasis" TEXT NOT NULL,
  "authorizationExpiresAt" TIMESTAMP(3),
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
  "cadence" TEXT NOT NULL DEFAULT 'daily',
  "nextRunAt" TIMESTAMP(3),
  "lastRunAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inventory_sources_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "inventory_sources_userId_enabled_idx" ON "inventory_sources"("userId", "enabled");
CREATE INDEX "inventory_sources_scheduleEnabled_nextRunAt_idx" ON "inventory_sources"("scheduleEnabled", "nextRunAt");

CREATE TABLE "inventory_import_runs" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "itemsRead" INTEGER NOT NULL DEFAULT 0,
  "itemsValid" INTEGER NOT NULL DEFAULT 0,
  "itemsFailed" INTEGER NOT NULL DEFAULT 0,
  "errorArchive" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "inventory_import_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "inventory_import_runs_sourceId_startedAt_idx" ON "inventory_import_runs"("sourceId", "startedAt");
ALTER TABLE "inventory_import_runs" ADD CONSTRAINT "inventory_import_runs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "inventory_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "inventory_asset_authorizations" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "inventoryItemId" TEXT,
  "assetUrl" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "authorizationBasis" TEXT NOT NULL,
  "authorizedBy" TEXT,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inventory_asset_authorizations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "inventory_asset_authorizations_userId_assetUrl_key" ON "inventory_asset_authorizations"("userId", "assetUrl");
CREATE INDEX "inventory_asset_authorizations_userId_revokedAt_expiresAt_idx" ON "inventory_asset_authorizations"("userId", "revokedAt", "expiresAt");
CREATE INDEX "inventory_asset_authorizations_inventoryItemId_idx" ON "inventory_asset_authorizations"("inventoryItemId");

CREATE TABLE "growth_scoring_settings" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "agingWeight" INTEGER NOT NULL DEFAULT 1,
  "missingVideoWeight" INTEGER NOT NULL DEFAULT 30,
  "priceChangeWeight" INTEGER NOT NULL DEFAULT 25,
  "newArrivalWeight" INTEGER NOT NULL DEFAULT 15,
  "seasonalWeight" INTEGER NOT NULL DEFAULT 0,
  "seasonalMonths" TEXT NOT NULL DEFAULT '[]',
  "revenueAtRiskMethod" TEXT NOT NULL DEFAULT 'none',
  "revenueAtRiskWeight" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "growth_scoring_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "growth_scoring_settings_userId_key" ON "growth_scoring_settings"("userId");

CREATE TABLE "discount_codes" (
  "id" TEXT NOT NULL, "code" TEXT NOT NULL, "stripeCouponId" TEXT NOT NULL,
  "percentOff" INTEGER, "amountOffCents" INTEGER, "currency" TEXT NOT NULL DEFAULT 'usd',
  "maxRedemptions" INTEGER, "redemptions" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true, "expiresAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "discount_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "discount_codes_code_key" ON "discount_codes"("code");
CREATE INDEX "discount_codes_active_expiresAt_idx" ON "discount_codes"("active", "expiresAt");
CREATE TABLE "discount_redemptions" (
  "id" TEXT NOT NULL, "discountCodeId" TEXT NOT NULL, "stripeSessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "discount_redemptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "discount_redemptions_stripeSessionId_key" ON "discount_redemptions"("stripeSessionId");
CREATE INDEX "discount_redemptions_discountCodeId_idx" ON "discount_redemptions"("discountCodeId");

CREATE TABLE "campaign_domains" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "hostname" TEXT NOT NULL,
  "verificationToken" TEXT NOT NULL, "verifiedAt" TIMESTAMP(3), "defaultCreativeId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "campaign_domains_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "campaign_domains_hostname_key" ON "campaign_domains"("hostname");
CREATE INDEX "campaign_domains_userId_enabled_idx" ON "campaign_domains"("userId", "enabled");
