import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { resolveVoiceIdForUser } from '@/lib/cloned-voices';
import { FetchLimitError, SsrfError, safeFetch, withDefaultScheme } from '@/lib/safe-fetch';
import { runFeedBatch, type FeedItem } from '@/lib/feed-batch';
import { markRemovedItems } from '@/lib/inventory';
import {
  VehicleParseError,
  parseVehicleFeed,
  vehicleLowerThird,
  vehiclePrompt,
  type Vehicle,
} from '@/lib/vehicle-feed';

/**
 * POST /api/vehicles/batch — a dealership's whole lot, one video per car.
 *
 * Accepts a DMS inventory feed URL (JSON or XML), or an inline `vehicles` array.
 * Each vehicle's photos are pulled through the SSRF guard, and a `mediaOnly`
 * video is rendered with its price / mileage / year burned in. Nothing about the
 * car is invented — a dealer is legally accountable for what an ad claims.
 */

export const dynamic = 'force-dynamic';

const MAX_VEHICLES = 40;

const vehicleSchema = z.object({
  ref: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  year: z.number().int().min(1900).max(2100).optional(),
  make: z.string().max(60).optional(),
  model: z.string().max(60).optional(),
  trim: z.string().max(60).optional(),
  price: z.string().max(60).optional(),
  mileage: z.string().max(40).optional(),
  highlights: z.string().max(1000).optional(),
  photos: z.array(z.string().min(4)).min(1).max(12),
});

const bodySchema = z
  .object({
    feedUrl: z.string().min(4).max(2048).optional(),
    vehicles: z.array(vehicleSchema).min(1).max(MAX_VEHICLES).optional(),
    duration: z.number().int().min(5).max(120).default(20),
    aspectRatio: z.enum(['16:9', '9:16', '1:1']).default('16:9'),
    voiceId: z.string().optional(),
    renderQuality: z.enum(['draft', 'full', '4k']).default('full'),
    captionPreset: z.enum(['default', 'large', 'subtle', 'karaoke']).optional(),
    // A Miami lot wants both: pass ['en','es'] to render every car twice, once
    // per language. Each language consumes its own quota, as intended.
    languages: z.array(z.enum(['en', 'es'])).min(1).max(2).default(['en']),
    // Parse + count only; don't render or touch quota.
    preview: z.boolean().optional(),
    approvedByUser: z.boolean().default(false),
  })
  .refine((b) => Boolean(b.feedUrl) !== Boolean(b.vehicles), {
    message: 'Provide either `feedUrl` or `vehicles`, not both',
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

  let vehicles: Vehicle[];
  try {
    if (feedUrl) {
      const { body, contentType } = await safeFetch(withDefaultScheme(feedUrl), {
        maxBytes: 8 * 1024 * 1024,
        timeoutMs: 15_000,
        acceptTypes: ['application/json', 'text/json', 'application/xml', 'text/xml', 'text'],
        headers: { Accept: 'application/json, application/xml;q=0.9' },
      });
      vehicles = parseVehicleFeed(body.toString('utf8'), contentType);
    } else {
      vehicles = parsed.data.vehicles as Vehicle[];
    }
  } catch (error) {
    if (error instanceof VehicleParseError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof SsrfError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof FetchLimitError) {
      return NextResponse.json({ error: `Could not read the feed: ${error.message}` }, { status: 422 });
    }
    console.error('[vehicles] feed fetch failed:', error);
    return NextResponse.json({ error: 'Could not read that feed' }, { status: 502 });
  }

  if (vehicles.length > MAX_VEHICLES) {
    return NextResponse.json(
      { error: `At most ${MAX_VEHICLES} vehicles per batch (got ${vehicles.length})` },
      { status: 413 },
    );
  }

  if (parsed.data.preview) {
    return NextResponse.json({
      preview: true,
      count: vehicles.length,
      items: vehicles.map((v) => ({ ref: v.ref, label: v.title, photos: v.photos.length })),
    });
  }
  if (!parsed.data.approvedByUser) {
    return NextResponse.json({ error: 'Review the preview and explicitly approve generation first.' }, { status: 400 })
  }

  const resolvedVoiceId = await resolveVoiceIdForUser(userId, voiceId);
  const items: FeedItem[] = vehicles.map((v) => ({
    ref: v.ref,
    label: v.title,
    photos: v.photos,
    priceText: v.price,
    moderationText: [v.title, v.trim, v.highlights].filter(Boolean).join('. '),
    buildPrompt: (n) => vehiclePrompt(v, n),
    lowerThird: () => vehicleLowerThird(v),
  }));

  // One batch per requested language. A bilingual request renders each car
  // twice — the English cut for one audience, the Spanish cut for the other.
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
      vertical: 'auto',
      authorizationBasis: feedUrl ? 'authorized-feed' : 'customer-confirmation',
      sourceUrl: feedUrl ?? null,
    });
    started += batch.started;
    failed += batch.failed;
    for (const r of batch.results) results.push({ ...r, language });
  }

  // A feedUrl pull represents the WHOLE lot, so anything no longer in it is
  // sold/delisted — exclude it from future recommendations. An inline
  // `vehicles` array is never assumed complete, so this only runs for feeds.
  if (feedUrl) {
    await markRemovedItems(userId, 'auto', vehicles.map((v) => v.ref)).catch((err) =>
      console.error('[vehicles] removal detection failed:', err),
    );
  }

  const langLabel = languages.join('+');
  return NextResponse.json({
    started,
    failed,
    languages,
    results,
    message: `Started ${started} of ${results.length} vehicle videos (${langLabel}). Poll /api/ai/jobs/{videoId} for each.`,
  });
}
