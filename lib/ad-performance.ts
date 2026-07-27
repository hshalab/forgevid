/**
 * Real per-creative ROAS, computed from data the customer imports themselves —
 * never pulled live from a Meta/TikTok/Google Ads API (this account has no
 * business-verified ad-platform access, and building OAuth against those
 * platforms is its own project). Spend/impressions/clicks are imported via
 * app/api/growth-operator/creative-performance/import/route.ts (a CSV the
 * customer exports from their own ads dashboard); revenue already comes from
 * GrowthConversion (app/api/growth-operator/conversions*). This module is the
 * one place that turns "spend I imported" + "revenue you reported" into a
 * comparable number across a campaign's variants.
 *
 * Relative imports only — reachable from the worker process.
 */
import { prisma } from './prisma';

/** ROAS = revenue / spend. Null when spend is unknown or zero (undefined, not infinite or zero). */
export function computeRoas(spendCents: number | null | undefined, revenueCents: number): number | null {
  if (!spendCents || spendCents <= 0) return null;
  return Math.round((revenueCents / spendCents) * 1000) / 1000;
}

/**
 * Recompute `roas` and `isWinner` for every creative in a campaign that has
 * imported spend, from its `totalSpendCents` plus its summed GrowthConversion
 * revenue. The single highest-ROAS creative among THOSE (strictly greater — a
 * tie marks neither) is `isWinner`.
 *
 * A creative with no spend imported yet is left completely untouched — its
 * `roas`/`isWinner` may have been set manually via
 * `PATCH /api/ad-studio/creatives/[id]` before real data existed, and
 * overwriting that back to null/false on every unrelated campaign import
 * would silently destroy it. Once real spend is imported for a creative,
 * computed ROAS takes over for it.
 *
 * Call this after EITHER side changes: a spend import or a conversion
 * import/manual entry, since ROAS depends on both. Every current write path
 * (app/api/growth-operator/conversions/route.ts,
 * .../conversions/import/route.ts,
 * .../creative-performance/import/route.ts) already does — if you add a
 * fourth place that writes GrowthConversion.revenueCents or
 * AdCreative.total{SpendCents,Impressions,Clicks}, call this too, or that
 * data's campaign will show stale roas/isWinner until something else happens
 * to trigger a recompute.
 */
export async function recomputeCampaignPerformance(campaignId: string): Promise<void> {
  const creatives = await prisma.adCreative.findMany({
    where: { campaignId },
    select: { id: true, totalSpendCents: true },
  });
  const withSpend = creatives.filter((c) => (c.totalSpendCents ?? 0) > 0);
  if (withSpend.length === 0) return;

  const revenueByCreative = await prisma.growthConversion.groupBy({
    by: ['creativeId'],
    where: { creativeId: { in: withSpend.map((c) => c.id) } },
    _sum: { revenueCents: true },
  });
  const revenueById = new Map(revenueByCreative.map((r) => [r.creativeId, r._sum.revenueCents ?? 0]));

  // computeRoas never returns null here — every entry has totalSpendCents > 0.
  const roasById = new Map(
    withSpend.map((c) => [c.id, computeRoas(c.totalSpendCents, revenueById.get(c.id) ?? 0)!]),
  );

  const ranked = [...roasById.entries()].sort((a, b) => b[1] - a[1]);
  // A tie at the top means no single winner — leave isWinner false for everyone
  // rather than pick one arbitrarily.
  const winnerId = ranked.length === 1 || ranked[0][1] > ranked[1][1] ? ranked[0][0] : null;

  await prisma.$transaction(
    withSpend.map((c) =>
      prisma.adCreative.update({
        where: { id: c.id },
        data: { roas: roasById.get(c.id), isWinner: c.id === winnerId },
      }),
    ),
  );
}
