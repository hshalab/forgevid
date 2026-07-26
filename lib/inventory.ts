/**
 * Cross-request inventory tracking — the piece a single stateless batch
 * request can't provide. A dealer/agent/store re-imports the same feed every
 * day; this is what lets ForgeVid notice a price changed, an item has sat
 * unpromoted, or something new showed up, and recommend what to make a video
 * for next instead of the customer picking blind.
 *
 * Everything here is grounded in facts we ourselves observed (our own
 * snapshot timestamps, raw text equality) — never a parsed/interpreted
 * number. A wrong "price dropped 20%" claim about a real business's real
 * listing would be worse than making no claim.
 *
 * Relative imports only — reachable from route handlers and the worker.
 */

import { prisma } from './prisma';

export type Vertical = 'auto' | 'realestate' | 'ecom';

export interface SnapshotInput {
  userId: string;
  vertical: Vertical;
  externalRef: string;
  label: string;
  priceText?: string | null;
  photoCount: number;
  videoId?: string | null;
}

/** Upserts the InventoryItem and appends one InventorySnapshot. Call once per item per batch run, whether or not that item's video succeeded. */
export async function recordInventorySnapshot(input: SnapshotInput): Promise<void> {
  const item = await prisma.inventoryItem.upsert({
    where: {
      userId_vertical_externalRef: {
        userId: input.userId,
        vertical: input.vertical,
        externalRef: input.externalRef,
      },
    },
    update: {
      label: input.label,
      priceText: input.priceText ?? null,
      photoCount: input.photoCount,
      lastSeenAt: new Date(),
      removedAt: null, // re-appearing in a feed un-removes it
    },
    create: {
      userId: input.userId,
      vertical: input.vertical,
      externalRef: input.externalRef,
      label: input.label,
      priceText: input.priceText ?? null,
      photoCount: input.photoCount,
    },
    select: { id: true },
  });

  await prisma.inventorySnapshot.create({
    data: {
      itemId: item.id,
      label: input.label,
      priceText: input.priceText ?? null,
      videoId: input.videoId ?? null,
    },
  });
}

/**
 * Marks anything not in `seenRefs` as removed (sold/delisted), so it drops
 * out of future recommendations. Only call this after a FULL feed refresh
 * (`feedUrl` mode) — an inline/manual array of a few items is never "the
 * whole lot," so absence from it proves nothing.
 */
export async function markRemovedItems(
  userId: string,
  vertical: Vertical,
  seenRefs: string[],
): Promise<number> {
  const result = await prisma.inventoryItem.updateMany({
    where: {
      userId,
      vertical,
      removedAt: null,
      externalRef: { notIn: seenRefs },
    },
    data: { removedAt: new Date() },
  });
  return result.count;
}

export interface Opportunity {
  itemId: string;
  externalRef: string;
  label: string;
  vertical: string;
  priceText: string | null;
  daysInInventory: number;
  priceChangedSinceLastVideo: boolean;
  hasRecentVideo: boolean;
  isNewArrival: boolean;
  score: number;
  reasons: string[];
}

const RECENT_VIDEO_WINDOW_DAYS = 14;
const NEW_ARRIVAL_WINDOW_DAYS = 2;
const MAX_AGING_SCORE = 60;
export interface ScoringWeights {
  agingWeight: number;
  missingVideoWeight: number;
  priceChangeWeight: number;
  newArrivalWeight: number;
  seasonalWeight: number;
  seasonalMonths: number[];
  revenueAtRiskMethod: 'none' | 'price_text_proxy' | 'manual_priority';
  revenueAtRiskWeight: number;
}
const DEFAULT_WEIGHTS: ScoringWeights = {
  agingWeight: 1, missingVideoWeight: 30, priceChangeWeight: 25,
  newArrivalWeight: 15, seasonalWeight: 0, seasonalMonths: [],
  revenueAtRiskMethod: 'none', revenueAtRiskWeight: 0,
};

/** Pure scoring function — no I/O, so it's directly unit-testable. */
export function scoreItem(
  item: { firstSeenAt: Date; lastSeenAt: Date; priceText?: string | null },
  snapshots: Array<{ priceText: string | null; videoId: string | null; createdAt: Date }>,
  now: Date,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): Omit<Opportunity, 'itemId' | 'externalRef' | 'label' | 'vertical' | 'priceText'> {
  const daysInInventory = Math.floor((now.getTime() - item.firstSeenAt.getTime()) / 86_400_000);
  const isNewArrival = daysInInventory <= NEW_ARRIVAL_WINDOW_DAYS;

  const sorted = [...snapshots].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const withVideo = sorted.filter((s) => s.videoId);
  const lastVideoSnapshot = withVideo[withVideo.length - 1];
  const latest = sorted[sorted.length - 1];

  const hasRecentVideo = Boolean(
    lastVideoSnapshot &&
      (now.getTime() - lastVideoSnapshot.createdAt.getTime()) / 86_400_000 <= RECENT_VIDEO_WINDOW_DAYS,
  );

  // "Changed since we last made a video for it" — a real reason to re-promote.
  // Text-equality only; never interpreted as a percentage or direction.
  const priceChangedSinceLastVideo = Boolean(
    lastVideoSnapshot && latest && lastVideoSnapshot.priceText !== latest.priceText,
  );

  const reasons: string[] = [];
  let score = 0;

  const agingScore = Math.min(daysInInventory, MAX_AGING_SCORE);
  score += agingScore * weights.agingWeight;
  if (daysInInventory >= 14) reasons.push(`${daysInInventory} days in inventory`);

  if (!hasRecentVideo) {
    score += weights.missingVideoWeight;
    reasons.push(withVideo.length === 0 ? 'never had a video made' : `no video in the last ${RECENT_VIDEO_WINDOW_DAYS} days`);
  }

  if (priceChangedSinceLastVideo) {
    score += weights.priceChangeWeight;
    reasons.push('price changed since the last video');
  }

  if (isNewArrival) {
    score += weights.newArrivalWeight;
    reasons.push('new arrival — no video yet');
  }
  if (weights.seasonalMonths.includes(now.getMonth() + 1) && weights.seasonalWeight > 0) {
    score += weights.seasonalWeight;
    reasons.push('customer-configured seasonal priority');
  }
  if (weights.revenueAtRiskMethod === 'price_text_proxy' && item.priceText && daysInInventory >= 30) {
    score += weights.revenueAtRiskWeight;
    reasons.push('revenue-at-risk proxy: priced inventory aged 30+ days');
  }

  return { daysInInventory, priceChangedSinceLastVideo, hasRecentVideo, isNewArrival, score, reasons };
}

/** Top opportunities for one business, active (non-removed) items only. */
export async function getRecommendations(
  userId: string,
  vertical?: Vertical,
  limit = 10,
): Promise<Opportunity[]> {
  const [items, configured] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { userId, removedAt: null, ...(vertical ? { vertical } : {}) },
      include: { snapshots: { select: { priceText: true, videoId: true, createdAt: true } } },
    }),
    prisma.growthScoringSettings.findUnique({ where: { userId } }),
  ]);
  const weights: ScoringWeights = configured ? {
    agingWeight: configured.agingWeight,
    missingVideoWeight: configured.missingVideoWeight,
    priceChangeWeight: configured.priceChangeWeight,
    newArrivalWeight: configured.newArrivalWeight,
    seasonalWeight: configured.seasonalWeight,
    seasonalMonths: JSON.parse(configured.seasonalMonths || '[]'),
    revenueAtRiskMethod: configured.revenueAtRiskMethod as ScoringWeights['revenueAtRiskMethod'],
    revenueAtRiskWeight: configured.revenueAtRiskWeight,
  } : DEFAULT_WEIGHTS;

  const now = new Date();
  const scored: Opportunity[] = items.map((item) => {
    const rest = scoreItem(item, item.snapshots, now, weights);
    return {
      itemId: item.id,
      externalRef: item.externalRef,
      label: item.label,
      vertical: item.vertical,
      priceText: item.priceText,
      ...rest,
    };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
