/**
 * Usage quotas — the free tier must not be an open faucet.
 *
 * Every generation costs real money (GPT + TTS + Whisper + compute), so each
 * plan gets a monthly video budget and a max duration. Enforcement is
 * server-side against UsageRecord rows; the client only ever sees the verdict.
 *
 * This is also the upgrade pressure that makes the Stripe plans sell: the
 * rejection names the limit and flags `upgradeRequired`.
 *
 * Two credit pools: this monthly allowance is consumed FIRST. Once it's
 * exhausted, checkGenerationQuota falls back to the purchased-credit pool
 * (lib/credits.ts) — never-expiring credits bought via SINGLE/TOPUP10/TOPUP25.
 * A generation that runs on a purchased credit is flagged `usePurchasedCredit`
 * so the caller can consume the credit instead of (already-exhausted) quota,
 * and gets a `maxDurationSeconds` floor of 90s regardless of plan (see
 * lib/stripe.ts CREDIT_PACKS and the business design in TODO/PRD notes).
 *
 * Relative imports only — reachable from the worker process.
 */

import { prisma } from './prisma';
import { getUserPlan, type Plan } from './plan';
import { getCreditBalance, consumeCredit } from './credits';

export const GENERATION_ACTION = 'video_generation';

/** Videos rendered on a purchased credit get at least this long, regardless of plan cap. */
export const PURCHASED_CREDIT_MIN_DURATION_SECONDS = 90;

export interface PlanQuota {
  /** Generations per calendar month. */
  videosPerMonth: number;
  /** Longest allowed video, seconds. */
  maxDurationSeconds: number;
}

// Margins-protecting allowances (2026-07 credit-system relaunch). A purchased
// credit (SINGLE/TOPUP10/TOPUP25) can still buy a longer render than the plan
// cap — see PURCHASED_CREDIT_MIN_DURATION_SECONDS — but never unlocks 4K,
// avatars, voice cloning, or custom branding (those stay plan-gated in lib/plan.ts).
export const PLAN_QUOTAS: Record<Plan, PlanQuota> = {
  free: { videosPerMonth: 2, maxDurationSeconds: 60 },
  starter: { videosPerMonth: 30, maxDurationSeconds: 90 },
  pro: { videosPerMonth: 100, maxDurationSeconds: 120 },
  enterprise: { videosPerMonth: 250, maxDurationSeconds: 150 },
  custom: { videosPerMonth: 250, maxDurationSeconds: 150 },
};

export interface QuotaVerdict {
  allowed: boolean;
  plan: Plan;
  used: number;
  limit: number;
  maxDurationSeconds: number;
  reason?: string;
  upgradeRequired?: boolean;
  /** true when this generation must be paid for with a purchased credit, not monthly quota. */
  usePurchasedCredit?: boolean;
  /** This generation's weight: monthly-allowance units consumed, or purchased credits spent. */
  creditCost?: number;
  /** Denial only: the user could unblock themselves with a Single/top-up purchase instead of upgrading. */
  topUpAvailable?: boolean;
}

function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * May this user start a generation of `durationSeconds`?
 * Fails CLOSED on lookup errors — an unprovable entitlement is a denial.
 *
 * `creditCost` is the WEIGHT of this generation in BOTH pools — how many
 * units of the monthly allowance it consumes, and how many purchased
 * credits it spends once the allowance is exhausted. 1 for a standard
 * stock-footage video; more for generation types with real per-unit
 * provider cost (avatar 2, dub 8, frontier models 2-5 by measured rate).
 *
 * Weighting the MONTHLY pool too is what protects margins: a Pro slot is
 * worth ~$0.99 of subscription revenue, and a single kling3.0_pro clip
 * costs ~$4.10 of provider spend — at flat 1-slot-per-generation, 100
 * premium generations would cost ~4x the subscription price. Weighted,
 * the economics hold on both pools by construction.
 */
export async function checkGenerationQuota(
  userId: string,
  durationSeconds: number,
  creditCost: number = 1,
): Promise<QuotaVerdict> {
  const plan = await getUserPlan(userId);
  const quota = PLAN_QUOTAS[plan];

  if (durationSeconds > quota.maxDurationSeconds) {
    return {
      allowed: false,
      plan,
      used: 0,
      limit: quota.videosPerMonth,
      maxDurationSeconds: quota.maxDurationSeconds,
      reason: `The ${plan} plan allows videos up to ${quota.maxDurationSeconds}s`,
      upgradeRequired: plan === 'free' || plan === 'starter',
    };
  }

  let used = 0;
  try {
    // Sum of unit weights, not row count — a 5-unit premium generation
    // consumes 5 of the month's allowance, not 1.
    const aggregate = await prisma.usageRecord.aggregate({
      _sum: { quantity: true },
      where: {
        userId,
        action: GENERATION_ACTION,
        timestamp: { gte: monthStart() },
      },
    });
    used = aggregate._sum.quantity ?? 0;
  } catch (error) {
    console.error('[Quota] Usage lookup failed, denying:', error);
    return {
      allowed: false,
      plan,
      used: 0,
      limit: quota.videosPerMonth,
      maxDurationSeconds: quota.maxDurationSeconds,
      reason: 'Could not verify your usage. Try again shortly.',
    };
  }

  // Not enough monthly room for THIS generation's full weight → the
  // purchased-credit pool covers the whole cost (never split across pools).
  if (used + creditCost > quota.videosPerMonth) {
    // Monthly allowance is spent — fall back to the purchased-credit pool
    // (never-expiring, bought via Single/top-up) before denying outright.
    // Must cover the FULL cost of this generation, not just be non-zero —
    // a 2-credit avatar render must not proceed on a 1-credit balance.
    const balance = await getCreditBalance(userId);
    if (balance >= creditCost) {
      return {
        allowed: true,
        plan,
        used,
        limit: quota.videosPerMonth,
        maxDurationSeconds: Math.max(quota.maxDurationSeconds, PURCHASED_CREDIT_MIN_DURATION_SECONDS),
        usePurchasedCredit: true,
        creditCost,
      };
    }

    return {
      allowed: false,
      plan,
      used,
      limit: quota.videosPerMonth,
      maxDurationSeconds: quota.maxDurationSeconds,
      reason:
        `Monthly allowance used (${used}/${quota.videosPerMonth} generation credits on the ${plan} plan; ` +
        `this generation needs ${creditCost}). It can run on ${creditCost} purchased credit${creditCost === 1 ? '' : 's'} — ` +
        `buy a Single video or a top-up pack to keep going without upgrading.`,
      upgradeRequired: plan !== 'enterprise' && plan !== 'custom',
      topUpAvailable: true,
    };
  }

  return {
    allowed: true,
    plan,
    used,
    limit: quota.videosPerMonth,
    maxDurationSeconds: quota.maxDurationSeconds,
    // Carried so settleGenerationEntitlement records this generation's
    // weight against the monthly pool (same number both pools).
    creditCost,
  };
}

/** Record a consumed generation. Call ONLY after the job is accepted. */
export async function recordGenerationUsage(
  userId: string,
  videoId: string,
  durationSeconds: number,
  units: number = 1,
): Promise<void> {
  try {
    await prisma.usageRecord.create({
      data: {
        userId,
        action: GENERATION_ACTION,
        resourceType: 'video',
        // The generation's weight — checkGenerationQuota sums this column,
        // so a premium generation genuinely consumes its priced share of
        // the monthly allowance.
        quantity: Math.max(1, Math.round(units)),
        metadata: JSON.stringify({ videoId, durationSeconds }),
      },
    });
  } catch (error) {
    // Never fail a paid-for generation over bookkeeping; log loudly instead.
    console.error('[Quota] Failed to record usage:', error);
  }
}

/**
 * Settle the entitlement `checkGenerationQuota` decided, once the generation
 * job has actually been accepted (the Video row exists). This is the ONE
 * place every generation path should call after creating its Video row —
 * always records the monthly usage row, and additionally spends the
 * purchased-credit amount the verdict priced in (`verdict.creditCost`,
 * default 1) when the monthly allowance was already exhausted.
 *
 * Centralizing this means every generation path (AI Studio, campaigns,
 * listings batch, feed batch, voice-to-video, avatars) shares one entitlement
 * bookkeeping path instead of six copies that can drift.
 */
export async function settleGenerationEntitlement(
  userId: string,
  videoId: string,
  durationSeconds: number,
  verdict: QuotaVerdict,
): Promise<void> {
  await recordGenerationUsage(userId, videoId, durationSeconds, verdict.creditCost ?? 1);
  if (verdict.usePurchasedCredit) {
    await consumeCredit({ userId, videoId, credits: verdict.creditCost ?? 1 });
  }
}

/**
 * Refund the quota slot for a video whose render failed.
 *
 * Usage is recorded up front (at enqueue) so a burst of requests can't blow past
 * the plan limit. But if the render then fails, that slot must be given back —
 * otherwise a failed render silently eats a paid-for credit. The videoId lives
 * inside the usage row's metadata JSON, so we match it there.
 */
export async function refundGenerationUsage(videoId: string): Promise<void> {
  try {
    await prisma.usageRecord.deleteMany({
      where: { action: GENERATION_ACTION, metadata: { contains: `"videoId":"${videoId}"` } },
    });
  } catch (error) {
    console.error('[Quota] Failed to refund usage:', error);
  }
}
