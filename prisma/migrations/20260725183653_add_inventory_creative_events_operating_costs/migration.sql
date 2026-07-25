-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "priceText" TEXT,
    "photoCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_snapshots" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "priceText" TEXT,
    "label" TEXT NOT NULL,
    "videoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_events" (
    "id" TEXT NOT NULL,
    "creativeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creative_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operating_costs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "incurredOn" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operating_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_items_userId_vertical_idx" ON "inventory_items"("userId", "vertical");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_userId_vertical_externalRef_key" ON "inventory_items"("userId", "vertical", "externalRef");

-- CreateIndex
CREATE INDEX "inventory_snapshots_itemId_idx" ON "inventory_snapshots"("itemId");

-- CreateIndex
CREATE INDEX "creative_events_creativeId_idx" ON "creative_events"("creativeId");

-- CreateIndex
CREATE INDEX "operating_costs_userId_idx" ON "operating_costs"("userId");

-- CreateIndex
CREATE INDEX "operating_costs_incurredOn_idx" ON "operating_costs"("incurredOn");

-- AddForeignKey
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
