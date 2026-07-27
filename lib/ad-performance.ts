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
 * Recompute `roas` and `isWinner` for a campaign from each creative's
 * `totalSpendCents` plus its summed GrowthConversion revenue. Does nothing
 * until at least one creative in the campaign has imported spend — a
 * campaign with none is left completely alone, so a manual `roas`/`isWinner`
 * set via `PATCH /api/ad-studio/creatives/[id]` before real data ever
 * existed survives untouched.
 *
 * Once real data DOES exist for the campaign, two different rules apply:
 *  - `roas` is only written for a creative that itself has imported spend —
 *    one with none keeps whatever value it already had (manual or stale).
 *  - `isWinner` is a campaign-wide invariant (at most one true creative), so
 *    EVERY creative in the campaign is touched for it, spend or not. Real
 *    numbers existing anywhere in the campaign supersede an old manual guess
 *    everywhere in it — otherwise a creative whose spend was corrected down
 *    to zero (or one that was never given real data at all) could keep a
 *    stale `isWinner: true` forever alongside a newly-computed winner.
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

  // Sequential, not $transaction/Promise.all: a campaign holds at most 48
  // creatives (app/api/ad-studio/campaigns/route.ts), so this is cheap either
  // way, and each write is independent — no reason to hold one long
  // transaction open, or burst the connection pool with concurrent writes.
  for (const c of creatives) {
    const roas = roasById.get(c.id);
    await prisma.adCreative.update({
      where: { id: c.id },
      data: roas !== undefined ? { roas, isWinner: c.id === winnerId } : { isWinner: c.id === winnerId },
    });
  }
}
