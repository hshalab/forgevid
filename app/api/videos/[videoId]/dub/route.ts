import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireVideoOwner } from '@/lib/video-access';
import { allowsVideoDubbing } from '@/lib/plan';
import { checkGenerationQuota, settleGenerationEntitlement } from '@/lib/quota';
import { pollProviderJobToCompletion } from '@/lib/provider-job-poll';
import {
  createVideoTranslation,
  getVideoTranslationStatus,
  isVideoTranslateConfigured,
} from '@/lib/video-translate';

/**
 * POST /api/videos/[videoId]/dub — dub an EXISTING finished video into another
 * language via HeyGen's Video Translate API: real voice cloning AND lip-sync
 * on the actual rendered video, not a re-narration over the same footage (see
 * lib/localize.ts for that cheaper, faster, no-lip-sync alternative — the
 * right choice for a stock-footage video, since there's no face to sync).
 * This one costs real HeyGen minutes, so it's gated the same way avatar
 * rendering is (Pro plan, shares the monthly quota, purchased credits price
 * in the higher per-minute rate) via its OWN plan-gate function
 * (allowsVideoDubbing) — dubbing works on any video, not just avatar ones, so
 * it isn't really an "avatar" permission even though both currently agree on
 * every plan tier.
 *
 * Same contract as every other generation: returns a new videoId immediately,
 * poll GET /api/ai/jobs/[videoId].
 */

const bodySchema = z.object({
  /** A language NAME ("Spanish"), not an ISO code — HeyGen's own field, see lib/video-translate.ts. */
  targetLanguage: z.string().min(1).max(60),
  mode: z.enum(['speed', 'precision']).default('speed'),
});

// HeyGen bills up to ~$2/minute for video-translate — roughly 4x avatar
// rendering's ~$0.50/minute, so a purchased credit needs to price in
// proportionally more or every dub past a couple minutes is a straight loss.
const DUB_CREDIT_COST = 8;

export async function POST(req: NextRequest, props: { params: Promise<{ videoId: string }> }) {
  const params = await props.params;
  const access = await requireVideoOwner(params.videoId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }
  const { targetLanguage, mode } = parsed.data;

  const source = await prisma.video.findUnique({
    where: { id: params.videoId },
    select: { status: true, fileUrl: true, url: true, duration: true, title: true },
  });
  const sourceUrl = source?.fileUrl || source?.url;
  if (!source || source.status !== 'COMPLETED' || !sourceUrl) {
    return NextResponse.json({ error: 'Only a completed video with a rendered file can be dubbed' }, { status: 422 });
  }
  // The pre-flight quota/cost estimate can only ever use the SOURCE's known
  // duration — HeyGen's actual dubbed output (often a different length; see
  // lib/video-translate.ts) isn't known until the job completes, at which
  // point pollProviderJobToCompletion re-books the real cost from HeyGen's
  // own reported duration. A video with no recorded duration is refused
  // rather than guessed at, since that estimate also gates real money.
  if (!source.duration || source.duration <= 0) {
    return NextResponse.json({ error: 'This video has no recorded duration and cannot be dubbed' }, { status: 422 });
  }
  const estimatedDuration = source.duration;

  if (!isVideoTranslateConfigured()) {
    return NextResponse.json(
      { error: 'Video dubbing is unavailable (HEYGEN_API_KEY is not configured)' },
      { status: 503 },
    );
  }

  // Dubbing shares the monthly generation quota — HeyGen minutes are the most
  // expensive thing the platform buys. Once exhausted, purchased credits can
  // pick this up too, at DUB_CREDIT_COST each.
  const quota = await checkGenerationQuota(access.userId, estimatedDuration, DUB_CREDIT_COST);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: quota.reason, upgradeRequired: quota.upgradeRequired ?? false },
      { status: 429 },
    );
  }
  if (!allowsVideoDubbing(quota.plan)) {
    return NextResponse.json(
      { error: `Video dubbing requires the Pro plan (you are on ${quota.plan})`, upgradeRequired: true },
      { status: 403 },
    );
  }

  try {
    const [videoTranslationId] = await createVideoTranslation({
      videoUrl: sourceUrl,
      outputLanguages: [targetLanguage],
      mode,
    });

    const video = await prisma.video.create({
      data: {
        title: `${source.title ?? 'Video'} (${targetLanguage} dub)`,
        description: `Dubbed from video ${params.videoId}`,
        status: 'QUEUED',
        duration: estimatedDuration,
        format: 'mp4',
        userId: access.userId,
        metadata: JSON.stringify({
          generation: { stage: 'queued', percent: 5, updatedAt: new Date().toISOString() },
          ...(quota.usePurchasedCredit ? { paidCredit: true } : {}),
          // Shared "derived from" convention with the localize route
          // (app/api/videos/[videoId]/localize/route.ts).
          variantType: 'dub',
          sourceVideoId: params.videoId,
          targetLanguage,
          mode,
        }),
      },
      select: { id: true },
    });

    // Consume AFTER the provider has accepted the job — never spend
    // quota/credits on a request that never actually started.
    await settleGenerationEntitlement(access.userId, video.id, estimatedDuration, quota);

    // Polling is lightweight (no local ffmpeg), so no render slot needed.
    void pollProviderJobToCompletion({
      videoId: video.id,
      userId: access.userId,
      providerName: 'heygen',
      prompt: `[dub -> ${targetLanguage}, mode=${mode}]`,
      checkStatus: async () => {
        const status = await getVideoTranslationStatus(videoTranslationId);
        // Re-book against HeyGen's OWN reported duration when the job
        // completes — the dubbed output routinely differs from the
        // source's length, and that's what HeyGen actually billed for.
        if (status.status === 'completed' && status.durationSeconds) {
          await prisma.video
            .update({ where: { id: video.id }, data: { duration: status.durationSeconds } })
            .catch(() => {});
        }
        return status;
      },
      // Bill the REAL output length HeyGen reports, falling back to the
      // pre-flight estimate only if HeyGen didn't return one.
      successCost: (status) => ({ dubSeconds: status.durationSeconds ?? estimatedDuration }),
    });

    return NextResponse.json({
      videoId: video.id,
      status: 'queued',
      provider: 'heygen',
      targetLanguage,
      message: `Started dubbing into ${targetLanguage}. Poll /api/ai/jobs/${video.id} for progress.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Video dub failed to start';
    console.error('[videos/dub]', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
