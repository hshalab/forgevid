import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';
import { headers } from 'next/headers';
import { sendSubscriptionReceiptEmail, sendSubscriptionCancelledEmail } from '@/lib/email';
import { grantCredits } from '@/lib/credits';
import type Stripe from 'stripe';

/** Maps a Stripe checkout metadata `pack` id to the CreditLedger reason. */
const CREDIT_PURCHASE_REASON: Record<string, 'purchase_single' | 'purchase_topup10' | 'purchase_topup25' | 'purchase_pilot'> = {
  pilot: 'purchase_pilot',
  single: 'purchase_single',
  topup10: 'purchase_topup10',
  topup25: 'purchase_topup25',
};

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = (await headers()).get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const discountCode = session.metadata?.discountCode;
        const redemptionUserId = session.metadata?.userId || session.client_reference_id;
        if (discountCode && redemptionUserId) {
          const discount = await prisma.discountCode.findUnique({ where: { code: discountCode } });
          if (discount) {
            await prisma.$transaction([
              prisma.discountRedemption.create({
                data: { discountCodeId: discount.id, stripeSessionId: session.id, userId: redemptionUserId },
              }),
              prisma.discountCode.update({ where: { id: discount.id }, data: { redemptions: { increment: 1 } } }),
            ]).catch((error: any) => {
              if (error?.code !== 'P2002') console.error('[Webhook] Failed to record discount redemption:', error);
            });
          }
        }

        // One-time credit-pack purchase (SINGLE/TOPUP10/TOPUP25) — a distinct
        // flow from the subscription checkout below: grant the ledger, record a
        // Payment for the revenue dashboard, and stop. No Subscription touched.
        if (session.mode === 'payment' && session.metadata?.type === 'credit_purchase') {
          const creditUserId = session.metadata.userId || session.client_reference_id;
          const credits = Number(session.metadata.credits);
          const reason = session.metadata.pack ? CREDIT_PURCHASE_REASON[session.metadata.pack] : undefined;

          if (!creditUserId || !reason || !Number.isFinite(credits) || credits <= 0) {
            console.error('[Webhook] Missing/invalid credit_purchase metadata:', session.metadata);
            break;
          }

          // Event arrival order is not guaranteed: a refund can be issued
          // before THIS event is ever delivered (e.g. the original delivery
          // failed and Stripe retried it after the refund). charge.refunded's
          // handler can only reconcile a Payment row that exists, so check
          // the charge's refund state NOW — a refunded purchase grants no
          // credits and is recorded as REFUNDED from the start, whichever
          // event happens to land first.
          let alreadyRefunded = false;
          try {
            if (session.payment_intent) {
              const intent = await stripe.paymentIntents.retrieve(session.payment_intent as string, {
                expand: ['latest_charge'],
              });
              const charge = intent.latest_charge as Stripe.Charge | null;
              alreadyRefunded = Boolean(charge?.refunded);
            }
          } catch (err) {
            console.error('[Webhook] Could not check refund state, assuming not refunded:', err);
          }

          if (alreadyRefunded) {
            console.log(`[Webhook] Session ${session.id} was already refunded — recording REFUNDED, granting no credits`);
          } else {
            await grantCredits({
              userId: creditUserId,
              credits,
              reason,
              stripeSessionId: session.id,
            });
          }

          try {
            await prisma.payment.create({
              data: {
                userId: creditUserId,
                amount: session.amount_total ? session.amount_total / 100 : 0,
                currency: session.currency || 'usd',
                status: alreadyRefunded ? 'REFUNDED' : 'SUCCEEDED',
                stripePaymentId: (session.payment_intent as string) || session.id,
                description: `Credit pack: ${session.metadata.pack} (${credits} credits)`,
                metadata: JSON.stringify({
                  type: 'credit_purchase',
                  pack: session.metadata.pack,
                  credits,
                  stripeSessionId: session.id,
                }),
              },
            });
          } catch (error) {
            console.error('[Webhook] Failed to record credit-pack payment:', error);
          }

          console.log(`[Webhook] Granted ${credits} credits (${session.metadata.pack}) to user ${creditUserId}`);
          break;
        }

        const userId = session.client_reference_id || session.metadata?.userId;
        const planId = session.metadata?.planId || session.metadata?.plan;

        if (!userId || !planId) {
          console.error('Missing userId or planId in session metadata');
          break;
        }

        // The Stripe subscription id must be captured HERE, at creation —
        // it's the only thing invoice.payment_succeeded and
        // customer.subscription.updated/deleted can use later to find this
        // row again (both look up by `metadata: { contains: <stripe sub id> }`).
        // Without it, every downstream lookup for this subscription silently
        // matches zero rows, starting with its very first invoice.
        const stripeSubscriptionId = (session.subscription as string) || null;
        const stripeCustomerId = (session.customer as string) || null;
        const stripeMetadata = JSON.stringify({ stripeSubscriptionId, stripeCustomerId });

        const existing = await prisma.subscription.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        });

        if (existing) {
          await prisma.subscription.update({
            where: { id: existing.id },
            data: {
              plan: planId.toLowerCase(),
              status: 'ACTIVE',
              currentPeriodStart: new Date(),
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              metadata: stripeMetadata,
            },
          });
        } else {
          await prisma.subscription.create({
            data: {
              userId,
              plan: planId.toLowerCase(),
              status: 'ACTIVE',
              currentPeriodStart: new Date(),
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              metadata: stripeMetadata,
            },
          });
        }

        console.log(`Subscription created for user ${userId}, plan ${planId}`);

        // Send subscription receipt email
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
        if (user?.email) {
          sendSubscriptionReceiptEmail(user.email, user.name || 'Creator', {
            plan: planId,
            amount: session.amount_total ? (session.amount_total / 100).toFixed(2) : '0.00',
            currency: session.currency || 'usd',
            billingPeriod: 'Monthly',
            invoiceId: session.invoice as string || session.id,
            date: new Date().toLocaleDateString(),
          }).catch((err) => console.error('[Email] Receipt email failed:', err));
        }

        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        try {
          await prisma.subscription.updateMany({
            where: {
              metadata: { contains: subscription.id },
            },
            data: {
              status: subscription.status === 'active' ? 'ACTIVE' :
                     subscription.status === 'canceled' ? 'CANCELLED' :
                     subscription.status === 'past_due' ? 'PAST_DUE' : 'INCOMPLETE',
              currentPeriodStart: new Date((subscription as any).current_period_start * 1000),
              currentPeriodEnd: new Date((subscription as any).current_period_end * 1000),
              cancelAtPeriodEnd: subscription.cancel_at_period_end,
              canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
              metadata: JSON.stringify({
                stripeSubscriptionId: subscription.id,
                stripeCustomerId: customerId,
              }),
            },
          });
        } catch (error) {
          console.error('Error updating subscription:', error);
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const stripeSubscriptionId = (invoice as any).subscription as string | null;

        // The canonical place subscription revenue is recorded — fires for
        // the first charge AND every renewal, so it's the single source of
        // truth for Payment rows (checkout.session.completed only activates
        // access; recording revenue here avoids double-counting the first
        // month). Idempotent via stripePaymentId's unique constraint, same
        // pattern as lib/credits.ts's grantCredits.
        if (!stripeSubscriptionId) {
          console.log(`[Webhook] invoice ${invoice.id} has no subscription — not a subscription payment, skipping Payment record`);
          break;
        }

        const subscription = await prisma.subscription.findFirst({
          where: { metadata: { contains: stripeSubscriptionId } },
        });
        if (!subscription) {
          console.error(`[Webhook] invoice.payment_succeeded: no Subscription found for Stripe subscription ${stripeSubscriptionId} — cannot record Payment`);
          break;
        }

        try {
          await prisma.payment.create({
            data: {
              userId: subscription.userId,
              amount: invoice.amount_paid / 100,
              currency: invoice.currency || 'usd',
              status: 'SUCCEEDED',
              stripePaymentId: ((invoice as any).payment_intent as string) || invoice.id,
              description: `Subscription payment: ${subscription.plan}`,
              subscriptionId: subscription.id,
              metadata: JSON.stringify({ type: 'subscription_payment', invoiceId: invoice.id, stripeSubscriptionId }),
            },
          });
          console.log(`[Webhook] Recorded subscription payment for user ${subscription.userId}, invoice ${invoice.id}`);
        } catch (error: any) {
          if (error?.code === 'P2002') {
            console.log(`[Webhook] Payment for invoice ${invoice.id} already recorded, skipping`);
          } else {
            console.error('[Webhook] Failed to record subscription payment:', error);
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        console.log(`Payment failed for invoice ${invoice.id}`);
        break;
      }

      case 'charge.refunded': {
        // Refunded money must never keep counting as earned revenue.
        // getHackathonEvidence() only sums Payment rows with status
        // SUCCEEDED, so flipping status (full refund) or reducing amount
        // (partial refund) here is the whole fix — no change needed there.
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId = (charge.payment_intent as string) || null;
        if (!paymentIntentId) {
          console.log(`[Webhook] charge.refunded for ${charge.id} has no payment_intent — cannot map to a Payment row`);
          break;
        }

        const payment = await prisma.payment.findUnique({ where: { stripePaymentId: paymentIntentId } });
        if (!payment) {
          console.log(`[Webhook] charge.refunded: no Payment row for payment_intent ${paymentIntentId} — nothing to reconcile`);
          break;
        }

        const fullyRefunded = charge.amount_refunded >= charge.amount;
        try {
          await prisma.payment.update({
            where: { id: payment.id },
            data: fullyRefunded
              ? { status: 'REFUNDED' }
              : { amount: (charge.amount - charge.amount_refunded) / 100 },
          });
          console.log(`[Webhook] ${fullyRefunded ? 'Fully' : 'Partially'} refunded payment ${payment.id} (${paymentIntentId})`);
        } catch (error) {
          console.error('[Webhook] Failed to reconcile refund:', error);
        }
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}
