import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { PRICING_PLANS, CREDIT_PACKS } from '@/lib/stripe';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { securityConfigs } from '@/lib/api-security';
import { getUserPlan, isPaidPlan } from '@/lib/plan';
import { prisma } from '@/lib/prisma';

async function checkoutDiscount(couponCode: unknown) {
  if (!couponCode) return { discounts: undefined, code: undefined };
  const code = String(couponCode).trim().toUpperCase();
  const discount = await prisma.discountCode.findFirst({
    where: {
      code, active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  if (!discount || (discount.maxRedemptions != null && discount.redemptions >= discount.maxRedemptions)) {
    throw new Error('INVALID_COUPON');
  }
  return { discounts: [{ coupon: discount.stripeCouponId }], code };
}

/**
 * One-time credit-pack purchase (SINGLE/TOPUP10/TOPUP25) — the second checkout
 * mode this route supports, alongside the existing subscription flow below.
 * TOPUP10/TOPUP25 are subscriber-only (they undercut SINGLE's per-video price
 * on purpose, to reward existing subscribers rather than let anyone route
 * around the plan price) — enforced HERE, server-side, never trusting the
 * client's claim about their own plan.
 */
async function handleCreditPackCheckout(
  session: { user: { id: string; email?: string | null } },
  body: { pack?: string; couponCode?: string },
) {
  const pack = Object.values(CREDIT_PACKS).find((p) => p.id === body.pack);
  if (!pack) {
    return NextResponse.json({ error: 'Invalid credit pack' }, { status: 400 });
  }

  if ('requiresSubscription' in pack && pack.requiresSubscription) {
    const plan = await getUserPlan(session.user.id);
    if (!isPaidPlan(plan)) {
      return NextResponse.json(
        { error: 'This top-up is available to active paid subscribers only' },
        { status: 403 },
      );
    }
  }

  if (!pack.stripePriceId) {
    return NextResponse.json({ error: 'Pack not configured' }, { status: 400 });
  }

  const discount = await checkoutDiscount(body.couponCode);
  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{ price: pack.stripePriceId, quantity: 1 }],
    success_url: `${process.env.NEXTAUTH_URL}/dashboard?success=true`,
    cancel_url: `${process.env.NEXTAUTH_URL}/dashboard?canceled=true`,
    client_reference_id: session.user.id,
    metadata: {
      type: 'credit_purchase',
      pack: pack.id,
      credits: String(pack.credits),
      userId: session.user.id,
      ...(discount.code ? { discountCode: discount.code } : {}),
    },
    customer_email: session.user.email ?? undefined,
    discounts: discount.discounts,
  });

  return NextResponse.json({ url: checkoutSession.url });
}

export const POST = securityConfigs.payment(async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();

    if (body?.type === 'credits') {
      return await handleCreditPackCheckout(session as any, body);
    }

    const { planId } = body;

    const plan = Object.values(PRICING_PLANS).find((candidate) => candidate.id === planId);

    if (!plan) {
      return NextResponse.json({ error: 'Invalid plan ID' }, { status: 400 });
    }

    if (plan.id === 'free') {
      return NextResponse.json({ error: 'Free plan does not require payment' }, { status: 400 });
    }

    if (!plan.stripePriceId) {
      return NextResponse.json({ error: 'Plan not configured for payments' }, { status: 400 });
    }

    const discount = await checkoutDiscount(body.couponCode);
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: plan.stripePriceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXTAUTH_URL}/dashboard?success=true`,
      cancel_url: `${process.env.NEXTAUTH_URL}/dashboard?canceled=true`,
      metadata: {
        userId: session.user.id,
        planId: plan.id,
        ...(discount.code ? { discountCode: discount.code } : {}),
      },
      customer_email: session.user.email ?? undefined,
      discounts: discount.discounts,
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_COUPON') {
      return NextResponse.json({ error: 'Coupon code is invalid, expired, or fully redeemed' }, { status: 400 });
    }
    console.error('Error creating checkout session:', error);
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
});
