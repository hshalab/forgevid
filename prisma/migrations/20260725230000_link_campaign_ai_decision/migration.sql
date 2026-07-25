ALTER TABLE "ad_campaigns" ADD COLUMN "aiDecisionId" TEXT;

CREATE INDEX "ad_campaigns_aiDecisionId_idx"
  ON "ad_campaigns"("aiDecisionId");
