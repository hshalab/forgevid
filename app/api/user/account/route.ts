import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { revokeClonedVoice } from '@/lib/cloned-voices';
import { appendEvidence } from '@/lib/evidence-ledger';

/**
 * DELETE /api/user/account — the settings page's "Delete Account" flow.
 *
 * SOFT delete, deliberately: the row flips to status DELETED with PII
 * scrubbed (email tombstoned, name/password cleared) rather than a
 * cascading hard delete, because (a) Payment rows are financial records
 * that must survive for the evidence ledger and tax/refund handling —
 * the schema RESTRICTs subscription deletion for the same reason — and
 * (b) the hackathon evidence explicitly excludes DELETED users from every
 * aggregate, so a deleted account disappears from all product surfaces
 * and metrics immediately.
 *
 * What IS actively destroyed: cloned voices are deleted at the provider
 * (ElevenLabs) — biometric-adjacent data doesn't get to sit in a vendor
 * account after the user leaves. An active paid subscription blocks
 * deletion until cancelled, so nobody deletes their way out of a paid
 * period into an un-refundable limbo.
 *
 * Requires the literal confirmation string so a stray API call can't
 * nuke an account.
 */

const bodySchema = z.object({ confirm: z.literal('DELETE MY ACCOUNT') });

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const userId = session.user.id;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Confirmation required: send { "confirm": "DELETE MY ACCOUNT" }' },
      { status: 400 },
    );
  }

  // Any subscription still live at STRIPE blocks deletion — not just ACTIVE.
  // PAST_DUE/TRIALING/INCOMPLETE rows can flip back to ACTIVE on a later
  // webhook, which would book payments to a deleted account forever.
  const livePaid = await prisma.subscription.findFirst({
    where: {
      userId,
      status: { in: ['ACTIVE', 'PAST_DUE', 'TRIALING', 'INCOMPLETE'] },
      plan: { not: 'free' },
      cancelAtPeriodEnd: false,
    },
    select: { id: true, plan: true },
  });
  if (livePaid) {
    return NextResponse.json(
      { error: `Cancel your ${livePaid.plan} subscription first (Billing tab), then delete the account.` },
      { status: 409 },
    );
  }

  // Provider-side voice deletion first — if ElevenLabs is unreachable the
  // account deletion still proceeds (the voice rows keep their revocation
  // state for a retry), but we always try.
  const voices = await prisma.clonedVoice.findMany({
    where: { userId, revokedAt: null },
    select: { id: true },
  });
  for (const voice of voices) {
    await revokeClonedVoice(userId, voice.id).catch((error) =>
      console.warn(`[account/delete] voice ${voice.id} revocation failed (continuing):`, error),
    );
  }

  const tombstone = `deleted-${userId}@deleted.forgevid.invalid`;
  await prisma.user.update({
    where: { id: userId },
    data: {
      status: 'DELETED',
      email: tombstone,
      name: null,
      password: null,
      image: null,
      // The SSO provider profile (name/email/picture) lives in metadata;
      // MFA/reset material is credential-adjacent — all scrubbed.
      metadata: null,
      mfaSecret: null,
      mfaEnabled: false,
      resetTokenHash: null,
      resetTokenExpiry: null,
    },
  });
  // API keys authenticate independently of the session — deactivate them
  // all, or a deleted account keeps programmatic access.
  await prisma.apiKey.updateMany({ where: { userId }, data: { isActive: false } }).catch(() => {});
  // JWT sessions are stateless — the session callback (lib/auth.ts) and
  // getFreshSessionUser both refuse DELETED users on every subsequent
  // request, which is what actually ends access.

  await appendEvidence({
    kind: 'account.deleted',
    entityType: 'User',
    entityId: userId,
    actorUserId: userId,
    payload: { voicesRevoked: voices.length, piiScrubbed: true, softDelete: true },
  });

  return NextResponse.json({ ok: true, message: 'Account deleted. Your data has been scrubbed and this login no longer works.' });
}
