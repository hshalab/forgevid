/*
  Warnings:

  - You are about to drop the column `clicks` on the `ad_creatives` table. All the data in the column will be lost.
  - You are about to drop the column `impressions` on the `ad_creatives` table. All the data in the column will be lost.
  - You are about to drop the column `spendCents` on the `ad_creatives` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ad_creatives" DROP COLUMN "clicks",
DROP COLUMN "impressions",
DROP COLUMN "spendCents",
ADD COLUMN     "totalClicks" INTEGER,
ADD COLUMN     "totalImpressions" INTEGER,
ADD COLUMN     "totalSpendCents" INTEGER;
