CREATE TABLE "evidence_records" (
  "id" TEXT NOT NULL,
  "sequence" BIGINT NOT NULL,
  "kind" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "actorUserId" TEXT,
  "payload" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "previousHash" TEXT NOT NULL,
  "recordHash" TEXT NOT NULL,
  "supersedesId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "evidence_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "evidence_records_sequence_key" ON "evidence_records"("sequence");
CREATE UNIQUE INDEX "evidence_records_recordHash_key" ON "evidence_records"("recordHash");
CREATE INDEX "evidence_records_kind_createdAt_idx" ON "evidence_records"("kind", "createdAt");
CREATE INDEX "evidence_records_entityType_entityId_idx" ON "evidence_records"("entityType", "entityId");

CREATE OR REPLACE FUNCTION reject_evidence_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'evidence_records is append-only; append a superseding record';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evidence_records_no_update
BEFORE UPDATE ON "evidence_records"
FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();

CREATE TRIGGER evidence_records_no_delete
BEFORE DELETE ON "evidence_records"
FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();

CREATE TABLE "campaign_approval_events" (
  "id" TEXT NOT NULL,
  "creativeId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "rightsConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "note" TEXT,
  "snapshot" TEXT NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "campaign_approval_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "campaign_approval_events_creativeId_revision_createdAt_idx"
  ON "campaign_approval_events"("creativeId", "revision", "createdAt");
CREATE INDEX "campaign_approval_events_actorUserId_createdAt_idx"
  ON "campaign_approval_events"("actorUserId", "createdAt");
CREATE TRIGGER campaign_approval_events_no_update
BEFORE UPDATE ON "campaign_approval_events"
FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
CREATE TRIGGER campaign_approval_events_no_delete
BEFORE DELETE ON "campaign_approval_events"
FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
