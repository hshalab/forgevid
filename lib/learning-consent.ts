/**
 * The consent layer of the controlled learning system. Two kinds of rows
 * live in learning_consents:
 *
 * - purpose 'product_improvement': a user's standing choice about whether
 *   their generation evaluations and provider observations may be RECORDED
 *   and included in cross-customer aggregates (the frontier-model router's
 *   evidence). Default when no row exists: INCLUDED — these are operational
 *   quality/cost metrics about renders the platform itself performed, the
 *   same legitimate-interest basis as the cost ledger — but the opt-out is
 *   honored end-to-end: nothing new is recorded for an opted-out user and
 *   the router excludes whatever was recorded before they opted out.
 *
 * - purpose 'voice_clone': an evidence record of the explicit consent
 *   captured when a voice was cloned (basis, subject, training permission),
 *   and of its revocation. Not a toggle — an audit trail, one row per
 *   consent/revocation event.
 *
 * History is preserved: changing a choice revokes the prior row and appends
 * a new one, so "what did the user consent to, when, under which policy
 * version" is always answerable.
 */
import { prisma } from './prisma';

export const LEARNING_POLICY_VERSION = 'learning-policy-v1';

export type ConsentPurpose = 'product_improvement' | 'voice_clone';

export async function recordLearningConsent(input: {
  userId: string;
  purpose: ConsentPurpose;
  granted: boolean;
  source: string;
  policyVersion?: string;
  evidence?: Record<string, unknown>;
}): Promise<void> {
  const create = prisma.learningConsent.create({
    data: {
      userId: input.userId,
      purpose: input.purpose,
      granted: input.granted,
      policyVersion: input.policyVersion ?? LEARNING_POLICY_VERSION,
      source: input.source,
      evidence: input.evidence ? JSON.stringify(input.evidence) : null,
    },
  });
  // voice_clone rows are APPEND-ONLY audit evidence — one row per event,
  // each about a DIFFERENT voice. Revoking prior rows here would falsely
  // stamp voice A's consent as revoked the moment voice B is cloned. Only
  // toggle purposes (product_improvement) supersede their prior row.
  if (input.purpose === 'voice_clone') {
    await create;
    return;
  }
  await prisma.$transaction([
    prisma.learningConsent.updateMany({
      where: { userId: input.userId, purpose: input.purpose, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    create,
  ]);
}

/** The user's current product-improvement choice. No row = included (see module doc). */
export async function allowsProductImprovement(userId: string): Promise<boolean> {
  const latest = await prisma.learningConsent.findFirst({
    where: { userId, purpose: 'product_improvement', revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { granted: true },
  });
  return latest?.granted ?? true;
}

/** Users whose current choice is opted-out — the router excludes their observations. */
export async function productImprovementOptOuts(): Promise<string[]> {
  const rows = await prisma.learningConsent.findMany({
    where: { purpose: 'product_improvement', granted: false, revokedAt: null },
    select: { userId: true },
  });
  return rows.map((row) => row.userId);
}
