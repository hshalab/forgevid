import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { resolveVoiceIdForUser } from '@/lib/cloned-voices';
import { FetchLimitError, SsrfError, safeFetch, withDefaultScheme } from '@/lib/safe-fetch';
import { runFeedBatch, type FeedItem } from '@/lib/feed-batch';
import { markRemovedItems } from '@/lib/inventory';
import {
  ProductParseError,
  parseProductFeed,
  productLowerThird,
  productPrompt,
  type Product,
} from '@/lib/product-feed';

/**
 * POST /api/products/batch — a store's catalogue, one ad per SKU.
 *
 * Accepts a Google Merchant (XML) or Shopify/generic (JSON) product feed URL,
 * or an inline `products` array. Each product's images are pulled through the
 * SSRF guard and a `mediaOnly` ad is rendered with its price burned in. The
 * ad-variation engine (/api/campaigns/variations) then multiplies the winners
 * into hooks and placements for testing.
 */

export const dynamic = 'force-dynamic';

const MAX_PRODUCTS = 40;

const productSchema = z.object({
  ref: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  price: z.string().max(60).optional(),
  brand: z.string().max(80).optional(),
  description: z.string().max(1000).optional(),
  photos: z.array(z.string().min(4)).min(1).max(12),
});

const bodySchema = z
  .object({
    feedUrl: z.string().min(4).max(2048).optional(),
    products: z.array(productSchema).min(1).max(MAX_PRODUCTS).optional(),
    duration: z.number().int().min(5).max(120).default(15),
    aspectRatio: z.enum(['16:9', '9:16', '1:1']).default('9:16'),
    voiceId: z.string().optional(),
    renderQuality: z.enum(['draft', 'full', '4k']).default('full'),
    captionPreset: z.enum(['default', 'large', 'subtle', 'karaoke']).optional(),
    // A store wants both: pass ['en','es'] to render every product twice, once
    // per language. Each language consumes its own quota, as intended.
    languages: z.array(z.enum(['en', 'es'])).min(1).max(2).default(['en']),
    // Parse + count only; don't render or touch quota.
    preview: z.boolean().optional(),
    approvedByUser: z.boolean().default(false),
  })
  .refine((b) => Boolean(b.feedUrl) !== Boolean(b.products), {
    message: 'Provide either `feedUrl` or `products`, not both',
  });

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const userId = session.user.id;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }
  const { feedUrl, duration, aspectRatio, voiceId, renderQuality, captionPreset } = parsed.data;
  const languages = [...new Set(parsed.data.languages)];

  let products: Product[];
  try {
    if (feedUrl) {
      const { body, contentType } = await safeFetch(withDefaultScheme(feedUrl), {
        maxBytes: 8 * 1024 * 1024,
        timeoutMs: 15_000,
        acceptTypes: ['application/json', 'text/json', 'application/xml', 'text/xml', 'text'],
        headers: { Accept: 'application/xml, application/json;q=0.9' },
      });
      products = parseProductFeed(body.toString('utf8'), contentType);
    } else {
      products = parsed.data.products as Product[];
    }
  } catch (error) {
    if (error instanceof ProductParseError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof SsrfError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof FetchLimitError) {
      return NextResponse.json({ error: `Could not read the feed: ${error.message}` }, { status: 422 });
    }
    console.error('[products] feed fetch failed:', error);
    return NextResponse.json({ error: 'Could not read that feed' }, { status: 502 });
  }

  if (products.length > MAX_PRODUCTS) {
    return NextResponse.json(
      { error: `At most ${MAX_PRODUCTS} products per batch (got ${products.length})` },
      { status: 413 },
    );
  }

  if (parsed.data.preview) {
    return NextResponse.json({
      preview: true,
      count: products.length,
      items: products.map((p) => ({ ref: p.ref, label: p.title, photos: p.photos.length })),
    });
  }
  if (!parsed.data.approvedByUser) {
    return NextResponse.json({ error: 'Review the preview and explicitly approve generation first.' }, { status: 400 })
  }

  const resolvedVoiceId = await resolveVoiceIdForUser(userId, voiceId);
  const items: FeedItem[] = products.map((p) => ({
    ref: p.ref,
    label: p.title,
    photos: p.photos,
    priceText: p.price,
    moderationText: [p.title, p.brand, p.description].filter(Boolean).join('. '),
    buildPrompt: (n) => productPrompt(p, n),
    lowerThird: () => productLowerThird(p),
  }));

  // One batch per requested language. A bilingual request renders each
  // product twice — the English cut for one audience, the Spanish cut for
  // the other.
  let started = 0;
  let failed = 0;
  const results: Array<{ ref: string; label: string; language: string; videoId?: string; photosUsed?: number; error?: string }> = [];
  for (const language of languages) {
    const batch = await runFeedBatch(items, {
      userId,
      duration,
      aspectRatio,
      voiceId: resolvedVoiceId,
      language,
      renderQuality,
      captionPreset,
      vertical: 'ecom',
    });
    started += batch.started;
    failed += batch.failed;
    for (const r of batch.results) results.push({ ...r, language });
  }

  // A feedUrl pull represents the WHOLE catalog, so anything no longer in it
  // is delisted — exclude it from future recommendations. An inline
  // `products` array is never assumed complete, so this only runs for feeds.
  if (feedUrl) {
    await markRemovedItems(userId, 'ecom', products.map((p) => p.ref)).catch((err) =>
      console.error('[products] removal detection failed:', err),
    );
  }

  const langLabel = languages.join('+');
  return NextResponse.json({
    started,
    failed,
    languages,
    results,
    message: `Started ${started} of ${results.length} product ads (${langLabel}). Poll /api/ai/jobs/{videoId} for each.`,
  });
}
