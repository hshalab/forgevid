-- AlterTable
ALTER TABLE "ad_creatives" ADD COLUMN     "clicks" INTEGER,
ADD COLUMN     "impressions" INTEGER,
ADD COLUMN     "spendCents" INTEGER,
ADD COLUMN     "spendUpdatedAt" TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT;
