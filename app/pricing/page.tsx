'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { PRICING_PLANS, CREDIT_PACKS } from '@/lib/stripe';
import { Check, Clapperboard, Mic, Smartphone, Type } from 'lucide-react';

export default function PricingPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState('');

  const handleSubscribe = async (planId: string) => {
    if (!session) {
      router.push('/auth/signin');
      return;
    }

    if (planId === 'free') {
      return; // Free plan doesn't require payment
    }

    setLoading(planId);

    try {
      const response = await fetch('/api/payments/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ planId, couponCode: couponCode.trim() || undefined }),
      });

      const data = await response.json();

      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'Failed to create checkout session');
      }
    } catch (error) {
      console.error('Error creating checkout session:', error);
      alert('Failed to start checkout process. Please try again.');
    } finally {
      setLoading(null);
    }
  };

  // One-time credit purchases (Single video / top-up packs) — same checkout
  // endpoint, `{type:'credits', pack}` body. Top-ups are subscriber-only and the
  // server enforces it (403); surface that nicely instead of a dead end.
  const handleCreditPurchase = async (pack: 'pilot' | 'single' | 'topup10' | 'topup25') => {
    if (!session) {
      router.push('/auth/signin');
      return;
    }

    setLoading(pack);

    try {
      const response = await fetch('/api/payments/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'credits', pack, couponCode: couponCode.trim() || undefined }),
      });

      const data = await response.json();

      if (response.status === 403) {
        alert(data.error || 'Top-up packs are for active subscribers. Grab the Single Video, or start a plan.');
        return;
      }
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'Failed to create checkout session');
      }
    } catch (error) {
      console.error('Error creating credit checkout:', error);
      alert('Failed to start checkout process. Please try again.');
    } finally {
      setLoading(null);
    }
  };

  const handleManageSubscription = async () => {
    if (!session) {
      router.push('/auth/signin');
      return;
    }

    setLoading('manage');

    try {
      const response = await fetch('/api/payments/customer-portal', {
        method: 'POST',
      });

      const data = await response.json();

      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'Failed to create customer portal session');
      }
    } catch (error) {
      console.error('Error creating customer portal session:', error);
      alert('Failed to open customer portal. Please try again.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-white mb-6">
            Simple Pricing
          </h1>
          <p className="text-xl text-gray-300 max-w-2xl mx-auto">
            Buy one video with no subscription, or pick a plan. Every video is yours to
            download and post anywhere — TikTok, Reels, Shorts, YouTube, your site.
          </p>
          <label className="mx-auto mt-6 block max-w-sm text-left text-sm text-gray-200">
            Coupon code (optional)
            <input
              value={couponCode}
              onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
              autoComplete="off"
              className="mt-2 h-11 w-full rounded-lg border border-white/20 bg-black/30 px-3 text-white"
              placeholder="ENTER CODE"
            />
          </label>
        </div>

        {/* ── Founding pilot: direct acquisition offer ───────────────────── */}
        <div className="max-w-3xl mx-auto mb-8">
          <div className="relative bg-gradient-to-r from-cyan-50 to-white rounded-2xl shadow-2xl p-8 ring-2 ring-cyan-400">
            <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
              <span className="bg-cyan-600 text-white px-4 py-2 rounded-full text-sm font-semibold">Founding customer pilot</span>
            </div>
            <div className="md:flex items-center justify-between gap-8">
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-1">5-Video Business Pilot</h3>
                <div className="text-4xl font-bold text-gray-900 mb-2">${CREDIT_PACKS.PILOT.price}<span className="text-lg text-gray-500"> one-time</span></div>
                <ul className="text-gray-700 space-y-1">
                  <li className="flex items-start"><Check className="h-5 w-5 text-green-500 mr-2 mt-0.5" />5 finished videos with no subscription</li>
                  <li className="flex items-start"><Check className="h-5 w-5 text-green-500 mr-2 mt-0.5" />Inventory-feed and English/Spanish workflows included</li>
                  <li className="flex items-start"><Check className="h-5 w-5 text-green-500 mr-2 mt-0.5" />You review every result before sharing or publishing</li>
                </ul>
              </div>
              <button onClick={() => handleCreditPurchase('pilot')} disabled={loading === 'pilot'}
                className="mt-5 md:mt-0 w-full md:w-auto py-3 px-8 rounded-lg font-semibold bg-cyan-600 hover:bg-cyan-700 text-white disabled:opacity-50">
                {loading === 'pilot' ? 'Processing…' : 'Start $99 pilot'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Single video: the no-subscription wedge ─────────────────────── */}
        <div className="max-w-3xl mx-auto mb-16">
          <div className="relative bg-gradient-to-r from-amber-50 to-white rounded-2xl shadow-2xl p-8 ring-2 ring-amber-400">
            <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
              <span className="bg-amber-500 text-white px-4 py-2 rounded-full text-sm font-semibold">
                No subscription
              </span>
            </div>
            <div className="md:flex items-center justify-between gap-8">
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-1">Single Video</h3>
                <div className="text-4xl font-bold text-gray-900 mb-2">
                  ${CREDIT_PACKS.SINGLE.price}
                  <span className="text-lg text-gray-500"> one-time</span>
                </div>
                <ul className="text-gray-700 space-y-1 mb-4 md:mb-0">
                  <li className="flex items-start"><Check className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />1 finished video, up to 90 seconds</li>
                  <li className="flex items-start"><Check className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />HD, no watermark, yours to keep</li>
                  <li className="flex items-start"><Check className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />Credit never expires — use it when you want</li>
                </ul>
              </div>
              <div className="flex-shrink-0">
                <button
                  onClick={() => handleCreditPurchase('single')}
                  disabled={loading === 'single'}
                  className={`w-full md:w-auto py-3 px-8 rounded-lg font-semibold transition-all duration-200 bg-amber-500 hover:bg-amber-600 text-white ${loading === 'single' ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {loading === 'single' ? 'Processing…' : 'Buy one video'}
                </button>
                <p className="mt-2 text-[11px] text-gray-500 text-center md:text-right">One-time payment. No renewal.</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Subscriptions ────────────────────────────────────────────────── */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-7xl mx-auto">
          {Object.entries(PRICING_PLANS).map(([key, plan]) => (
            <div
              key={plan.id}
              className={`relative bg-white rounded-2xl shadow-2xl p-8 ${
                plan.id === 'pro' ? 'ring-2 ring-purple-500 scale-105' : ''
              }`}
            >
              {plan.id === 'pro' && (
                <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                  <span className="bg-purple-500 text-white px-4 py-2 rounded-full text-sm font-semibold">
                    Most Popular
                  </span>
                </div>
              )}

              <div className="text-center mb-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  {plan.name}
                </h3>
                <div className="text-4xl font-bold text-gray-900 mb-2">
                  ${plan.price}
                  <span className="text-lg text-gray-500">/month</span>
                </div>
                <p className="text-gray-600">
                  {plan.credits} video generations
                </p>
              </div>

              <ul className="space-y-4 mb-8">
                {plan.features.map((feature, index) => (
                  <li key={index} className="flex items-start">
                    <Check className="h-5 w-5 text-green-500 mr-3 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-700">{feature}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleSubscribe(plan.id)}
                disabled={loading === plan.id}
                className={`w-full py-3 px-6 rounded-lg font-semibold transition-all duration-200 ${
                  plan.id === 'pro'
                    ? 'bg-purple-600 hover:bg-purple-700 text-white'
                    : plan.id === 'free'
                    ? 'bg-gray-200 text-gray-700 cursor-not-allowed'
                    : 'bg-gray-900 hover:bg-gray-800 text-white'
                } ${loading === plan.id ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {loading === plan.id ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                    Processing...
                  </div>
                ) : plan.id === 'free' ? (
                  'Current Plan'
                ) : (
                  'Get Started'
                )}
              </button>
              {plan.id !== 'free' && (
                <p className="mt-3 text-[11px] leading-snug text-gray-500">
                  Recurring subscription —{' '}
                  <span className="font-medium text-gray-700">auto-renews at ${plan.price}/month</span>{' '}
                  until you cancel (cancel anytime in Billing). By subscribing you agree to our{' '}
                  <a href="/terms" className="underline hover:text-gray-900">Terms</a>,{' '}
                  <a href="/privacy" className="underline hover:text-gray-900">Privacy Policy</a>, and{' '}
                  <a href="/refund" className="underline hover:text-gray-900">Refund Policy</a>.
                </p>
              )}
            </div>
          ))}
        </div>

        {/* ── Top-up packs (subscribers) ───────────────────────────────────── */}
        <div className="max-w-4xl mx-auto mt-16">
          <h2 className="text-2xl font-bold text-white text-center mb-2">Need more videos this month?</h2>
          <p className="text-gray-300 text-center mb-8">
            Top-up packs for active subscribers — extra credits that never expire.
          </p>
          <div className="grid sm:grid-cols-2 gap-6">
            {([CREDIT_PACKS.TOPUP10, CREDIT_PACKS.TOPUP25] as const).map((pack) => (
              <div key={pack.id} className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-xl font-semibold text-white">{pack.credits} extra credits</h3>
                    <p className="text-gray-300 text-sm">
                      ${(pack.price / pack.credits).toFixed(2)} per credit · 1 credit = 1 standard video · never expire
                    </p>
                  </div>
                  <div className="text-3xl font-bold text-white">${pack.price}</div>
                </div>
                <button
                  onClick={() => handleCreditPurchase(pack.id as 'topup10' | 'topup25')}
                  disabled={loading === pack.id}
                  className={`w-full py-2.5 px-6 rounded-lg font-semibold transition-all duration-200 bg-white/20 hover:bg-white/30 text-white border border-white/30 ${loading === pack.id ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {loading === pack.id ? 'Processing…' : 'Top up'}
                </button>
                <p className="mt-2 text-[11px] text-gray-400">One-time payment · requires an active plan</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Creators section ─────────────────────────────────────────────── */}
        <div className="max-w-5xl mx-auto mt-20">
          <h2 className="text-3xl font-bold text-white text-center mb-2">
            Made for TikTok, Reels &amp; Shorts too
          </h2>
          <p className="text-gray-300 text-center max-w-2xl mx-auto mb-10">
            Not just stock-footage ads. Bring your own clips and your own face — ForgeVid
            does the editing: cuts, captions, voice, and vertical framing.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6">
              <Smartphone className="h-7 w-7 text-amber-400 mb-3" />
              <h3 className="text-white font-semibold mb-1">Vertical-native 9:16</h3>
              <p className="text-gray-300 text-sm">TikTok / Reels / Shorts format out of the box — up to 4K portrait.</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6">
              <Type className="h-7 w-7 text-amber-400 mb-3" />
              <h3 className="text-white font-semibold mb-1">Karaoke captions</h3>
              <p className="text-gray-300 text-sm">Word-by-word highlighted captions, the style short-form viewers expect.</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6">
              <Clapperboard className="h-7 w-7 text-amber-400 mb-3" />
              <h3 className="text-white font-semibold mb-1">Your clips, your face</h3>
              <p className="text-gray-300 text-sm">Upload your own footage and add a talking-head overlay of yourself on top of the b-roll.</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6">
              <Mic className="h-7 w-7 text-amber-400 mb-3" />
              <h3 className="text-white font-semibold mb-1">Your voice or AI voice</h3>
              <p className="text-gray-300 text-sm">Record your own narration, or let an AI voice read your script.</p>
            </div>
          </div>
        </div>

        {session && (
          <div className="text-center mt-12">
            <button
              onClick={handleManageSubscription}
              disabled={loading === 'manage'}
              className="bg-gray-800 hover:bg-gray-700 text-white px-8 py-3 rounded-lg font-semibold transition-all duration-200 disabled:opacity-50"
            >
              {loading === 'manage' ? 'Loading...' : 'Manage Subscription'}
            </button>
          </div>
        )}

        <div className="mt-16 text-center">
          <h2 className="text-3xl font-bold text-white mb-8">
            Frequently Asked Questions
          </h2>
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6">
              <h3 className="text-xl font-semibold text-white mb-3">
                Can I try it before paying?
              </h3>
              <p className="text-gray-300">
                Yes — the Free plan includes 2 watermarked videos per month, no card required.
                When you want a watermark-free video without a subscription, the $
                {CREDIT_PACKS.SINGLE.price} Single Video is a one-time purchase.
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6">
              <h3 className="text-xl font-semibold text-white mb-3">
                Do premium AI models cost more?
              </h3>
              <p className="text-gray-300">
                Yes. A standard stock-footage video is 1 credit. Premium generation types use more,
                reflecting their real provider cost: AI Presenter videos are 2 credits, Frontier AI
                clips are 2–5 credits depending on the model (Runway Gen-4.5 is 2; Google Veo 3.1 is 3;
                ByteDance Seedance 2 is 4; Kling 3.0 Pro is 5), and lip-synced video dubbing is 8.
                The exact price is always shown on the Generate button before you click.
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6">
              <h3 className="text-xl font-semibold text-white mb-3">
                Can I change my plan anytime?
              </h3>
              <p className="text-gray-300">
                Yes! You can upgrade or downgrade your plan at any time. Changes take effect immediately.
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6">
              <h3 className="text-xl font-semibold text-white mb-3">
                What happens to unused credits?
              </h3>
              <p className="text-gray-300">
                Monthly plan credits reset each billing cycle and don&apos;t roll over. Purchased
                credits — the Single Video and top-up packs — never expire.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
