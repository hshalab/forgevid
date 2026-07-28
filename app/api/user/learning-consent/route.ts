import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  allowsProductImprovement,
  LEARNING_POLICY_VERSION,
  recordLearningConsent,
} from '@/lib/learning-consent';

/**
 * The user-facing switch for the controlled learning system's
 * product-improvement purpose: whether this account's render quality/cost
 * telemetry is recorded and included in cross-customer model-routing
 * evidence. Defaults to included; opting out stops new recording AND
 * excludes previously recorded observations from the router (see
 * lib/learning-consent.ts for the exact semantics).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  return NextResponse.json({
    purpose: 'product_improvement',
    granted: await allowsProductImprovement(session.user.id),
    policyVersion: LEARNING_POLICY_VERSION,
  });
}

const bodySchema = z.object({ granted: z.boolean() });

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'granted must be a boolean' }, { status: 400 });
  }
  await recordLearningConsent({
    userId: session.user.id,
    purpose: 'product_improvement',
    granted: parsed.data.granted,
    source: 'settings',
  });
  return NextResponse.json({ purpose: 'product_improvement', granted: parsed.data.granted });
}
