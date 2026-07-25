import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { resolveVoiceIdForUser } from '@/lib/cloned-voices';
import { runFeedBatch, type FeedItem } from '@/lib/feed-batch';
import { markRemovedItems } from '@/lib/inventory';
import {
  ListingParseError,
  listingPrompt,
  parseListingsCsv,
  type Listing,
} from '@/lib/listing-brief';
import { parseListingsFeed } from '@/lib/mls-feed';
import { FetchLimitError, SsrfError, safeFetch, withDefaultScheme } from '@/lib/safe-fetch';
import { decodeHtmlBody, parseSiteHtml } from '@/lib/site-extract';

/**
 * POST /api/listings/batch — an estate agent's whole spreadsheet at once.
 *
 * Accepts either a CSV (the thing agents actually have) or a JSON array, then
 * for each listing: pulls the photos through the SSRF guard into ownership-
 * checked MediaAssets, builds a fact-only prompt, and starts a generation with
 * `mediaOnly` so the video shows THAT house and nothing else.
 *
 * Every listing is charged and quota-checked individually. A row that fails —
 * an unreachable photo, an exhausted quota — is reported by reference and does
 * not take the rest of the batch down with it.
 */

export const dynamic = 'force-dynamic';

const MAX_LISTINGS = 25;
const MAX_PHOTOS_PER_LISTING = 12;

const listingSchema = z.object({
  ref: z.string().min(1).max(120),
  address: z.string().min(1).max(300),
  price: z.string().max(60).optional(),
  beds: z.number().int().min(0).max(50).optional(),
  baths: z.number().min(0).max(50).optional(),
  highlights: z.string().max(1000).optional(),
  photos: z.array(z.string().min(4)).min(1).max(MAX_PHOTOS_PER_LISTING),
});

const bodySchema = z
  .object({
    csv: z.string().min(10).max(200_000).optional(),
    listings: z.array(listingSchema).min(1).max(MAX_LISTINGS).optional(),
    /** A RESO Web API (JSON) or portal (XML) feed. The agent touches nothing. */
    feedUrl: z.string().min(4).max(2048).optional(),
    duration: z.number().int().min(5).max(120).default(25),
    aspectRatio: z.enum(['16:9', '9:16', '1:1']).default('16:9'),
    voiceId: z.string().optional(),
    renderQuality: z.enum(['draft', 'full', '4k']).default('full'),
    captionPreset: z.enum(['default', 'large', 'subtle', 'karaoke']).optional(),
    // An agent wants both: pass ['en','es'] to render every listing twice, once
    // per language. Each language consumes its own quota, as intended.
    languages: z.array(z.enum(['en', 'es'])).min(1).max(2).default(['en']),
    // Parse + count only; don't render or touch quota.
    preview: z.boolean().optional(),
    approvedByUser: z.boolean().default(false),
  })
  .refine(
    (b) => [b.csv, b.listings, b.feedUrl].filter(Boolean).length === 1,
    { message: 'Provide exactly one of `csv`, `listings` or `feedUrl`' },
  );

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const userId = session.user.id;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.issues },
      { status: 400 },
    );
  }
  const { csv, feedUrl, duration, aspectRatio, voiceId, renderQuality, captionPreset } = parsed.data;
  const languages = [...new Set(parsed.data.languages)];

  let listings: Listing[];
  // Only a true MLS/RESO feed pull represents the agent's WHOLE portfolio —
  // a single scraped listing page or a hand-typed array is never assumed
  // complete, so removal detection only runs for this path.
  let isFullFeedRefresh = false;
  try {
    if (feedUrl) {
      // A feed url is attacker-supplied data. It goes through the same guard as
      // every other url this product fetches.
      const { body, contentType } = await safeFetch(withDefaultScheme(feedUrl), {
        maxBytes: 8 * 1024 * 1024,
        timeoutMs: 15_000,
        acceptTypes: ['application/json', 'text/json', 'application/xml', 'text/xml', 'text', 'text/html', 'application/xhtml+xml'],
        headers: { Accept: 'application/json, application/xml;q=0.9, text/html;q=0.8' },
      });
      if (contentType.toLowerCase().includes('html')) {
        const sourceUrl = withDefaultScheme(feedUrl);
        const page = parseSiteHtml(decodeHtmlBody(body, contentType), sourceUrl);
        if (!page.title || page.images.length === 0) {
          throw new ListingParseError('That page did not expose enough property details and photos. Use an authorized MLS feed or Paste data.');
        }
        listings = [{
          ref: new URL(sourceUrl).pathname.split('/').filter(Boolean).pop() || 'listing-page',
          address: page.title.replace(/\s*[-|]\s*(Homes\.com|Zillow|Realtor\.com|Redfin).*$/i, '').trim(),
          highlights: page.description || page.paragraphs.slice(0, 2).join(' '),
          photos: page.images.slice(0, MAX_PHOTOS_PER_LISTING),
        }];
      } else {
        listings = parseListingsFeed(body.toString('utf8'), contentType);
        isFullFeedRefresh = true;
      }
    } else if (csv) {
      listings = parseListingsCsv(csv);
    } else {
      listings = parsed.data.listings as Listing[];
    }
  } catch (error) {
    if (error instanceof ListingParseError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof SsrfError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof FetchLimitError) {
      const blocked = /\b(401|403|429)\b/.test(error.message);
      return NextResponse.json({
        error: blocked
          ? 'The source platform blocked automated import. ForgeVid will not bypass its access controls. Use an authorized MLS/RESO feed or Paste data with property details and photo URLs.'
          : `Could not read the feed: ${error.message}`,
        code: blocked ? 'SOURCE_BLOCKED' : 'FEED_UNREADABLE',
      }, { status: 422 });
    }
    console.error('[listings] feed fetch failed:', error);
    return NextResponse.json({ error: 'Could not read that feed' }, { status: 502 });
  }

  if (listings.length > MAX_LISTINGS) {
    return NextResponse.json(
      { error: `At most ${MAX_LISTINGS} listings per batch (got ${listings.length})` },
      { status: 413 },
    );
  }

  if (parsed.data.preview) {
    return NextResponse.json({
      preview: true,
      count: listings.length,
      items: listings.map((l) => ({ ref: l.ref, label: l.address, photos: l.photos.length })),
    });
  }
  if (!parsed.data.approvedByUser) {
    return NextResponse.json({ error: 'Review the preview and explicitly approve generation first.' }, { status: 400 })
  }

  // Resolve the voice once — it is the same narrator for the whole batch.
  const resolvedVoiceId = await resolveVoiceIdForUser(userId, voiceId);
  const items: FeedItem[] = listings.map((listing) => ({
    ref: listing.ref,
    label: listing.address,
    photos: listing.photos,
    priceText: listing.price,
    moderationText: [listing.address, listing.highlights].filter(Boolean).join('. '),
    buildPrompt: (n) => listingPrompt(listing, n),
    // The price is the reason anyone watches a listing video. Burn it in.
    lowerThird: () => ({
      title: listing.address,
      facts: [
        listing.price,
        listing.beds ? `${listing.beds} bed` : undefined,
        listing.baths ? `${listing.baths} bath` : undefined,
      ].filter((f): f is string => Boolean(f)),
      start: 0.6,
      duration: 4.5,
    }),
  }));

  // One batch per requested language. A bilingual request renders each
  // listing twice — the English cut for one audience, the Spanish cut for
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
      // Matches this route's pre-existing behavior: no background music bed.
      addOns: ['voiceover', 'subtitles'],
      maxPhotosPerItem: MAX_PHOTOS_PER_LISTING,
      vertical: 'realestate',
    });
    started += batch.started;
    failed += batch.failed;
    for (const r of batch.results) results.push({ ...r, language });
  }

  if (isFullFeedRefresh) {
    await markRemovedItems(userId, 'realestate', listings.map((l) => l.ref)).catch((err) =>
      console.error('[listings] removal detection failed:', err),
    );
  }

  const langLabel = languages.join('+');
  return NextResponse.json({
    started,
    failed,
    languages,
    results,
    message: `Started ${started} of ${results.length} listing videos (${langLabel}). Poll /api/ai/jobs/{videoId} for each.`,
  });
}
