import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { allowsAvatars } from '@/lib/plan';
import { checkGenerationQuota, settleGenerationEntitlement } from '@/lib/quota';
import { pollProviderJobToCompletion } from '@/lib/provider-job-poll';
import {
  createAvatarVideo,
  getAvatarVideoStatus,
  isAvatarProviderConfigured,
} from '@/lib/avatar-provider';

/**
 * POST /api/avatars/generate — an AI presenter reads your script.
 *
 * Same contract as every other generation: returns a videoId immediately, poll
 * GET /api/ai/jobs/[videoId]. The render happens on the provider's
 * infrastructure; we poll until the video URL exists. Pro plans only; counts
 * against the same monthly quota as normal generations — and, once that's
 * exhausted, against purchased credits at AVATAR_CREDIT_COST each. Purchased
 * credits are an ADDITIONAL path for an already-Pro+ user, never a way
 * around the allowsAvatars() gate below (checkGenerationQuota only reports
 * usePurchasedCredit for the user's REAL plan; it can't upgrade them).
 */

const bodySchema = z.object({
  script: z.string().min(5).max(5000),
  avatarId: z.string().min(1).max(100),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']).default('16:9'),
  /** Estimated output length, for quota/cost purposes. */
  duration: z.number().int().min(5).max(600).default(60),
});

// HeyGen bills ~$0.50/minute — a single purchased credit ($19 for one video,
// or ~$1.16-1.50 amortized in a top-up) would be a straight loss on anything
// past a couple minutes. Avatar renders cost 2 purchased credits.
const AVATAR_CREDIT_COST = 2;

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
  const input = parsed.data;

  // Avatar renders share the monthly generation quota — provider minutes are
  // the most expensive thing the platform buys. Once that's exhausted,
  // purchased credits can pick this up too, at AVATAR_CREDIT_COST each.
  const quota = await checkGenerationQuota(userId, input.duration, AVATAR_CREDIT_COST);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: quota.reason, upgradeRequired: quota.upgradeRequired ?? false },
      { status: 429 },
    );
  }
  // Purchased credits do NOT bypass the Pro+ requirement — checkGenerationQuota
  // reports the user's real plan regardless of usePurchasedCredit, so a free
  // user who somehow had credits would still be blocked here.
  if (!allowsAvatars(quota.plan)) {
    return NextResponse.json(
      { error: `Avatar videos require the Pro plan (you are on ${quota.plan})`, upgradeRequired: true },
      { status: 403 },
    );
  }
  if (!isAvatarProviderConfigured()) {
    return NextResponse.json(
      { error: 'Avatar generation is unavailable (HEYGEN_API_KEY is not configured)' },
      { status: 503 },
    );
  }

  try {
    const providerVideoId = await createAvatarVideo({
      script: input.script,
      avatarId: input.avatarId,
      aspectRatio: input.aspectRatio,
    });

    const video = await prisma.video.create({
      data: {
        title: input.script.slice(0, 80),
        description: input.script,
        status: 'QUEUED',
        duration: input.duration,
        format: 'mp4',
        userId,
        metadata: JSON.stringify({
          generation: { stage: 'queued', percent: 5, updatedAt: new Date().toISOString() },
          // Recorded for consistency with every other generation path, set
          // server-side ONLY from the quota verdict. NOTE: unlike the ffmpeg
          // pipeline, this flag has no watermark effect here — HeyGen renders
          // the avatar directly and never passes through
          // lib/generation-pipeline.ts's brandingForVideo.
          ...(quota.usePurchasedCredit ? { paidCredit: true } : {}),
          source: 'avatar',
          provider: { name: 'heygen', videoId: providerVideoId, avatarId: input.avatarId },
          request: { aspectRatio: input.aspectRatio, duration: input.duration },
        }),
      },
      select: { id: true },
    });

    // Consume AFTER the provider has accepted the job (video row created) —
    // never spend credits on a request that never actually started.
    await settleGenerationEntitlement(userId, video.id, input.duration, quota);

    // Polling is lightweight (no local ffmpeg), so no render slot needed.
    void pollProviderJobToCompletion({
      videoId: video.id,
      userId,
      providerName: 'heygen',
      prompt: input.script,
      checkStatus: () => getAvatarVideoStatus(providerVideoId),
      successCost: () => ({ avatarSeconds: input.duration }),
    });

    return NextResponse.json({
      success: true,
      data: { videoId: video.id, status: 'queued', provider: 'heygen' },
      message: 'Avatar render started. Poll /api/ai/jobs/{videoId} for progress.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Avatar render failed to start';
    console.error('[avatars/generate]', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
