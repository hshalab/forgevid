import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { allowsFrontierGeneration } from '@/lib/plan';
import { checkGenerationQuota, settleGenerationEntitlement } from '@/lib/quota';
import { pollProviderJobToCompletion } from '@/lib/provider-job-poll';
import { moderateText, recordModerationBlock } from '@/lib/moderation';
import { createTextToVideo, getRunwayTaskStatus, isRunwayConfigured } from '@/lib/runway-provider';

/**
 * POST /api/videos/runway/generate — real AI-generated video from a text
 * prompt via Runway's API, reaching Runway's own Gen models AND the
 * third-party frontier models Runway hosts (Google Veo, ByteDance Seedance,
 * Kuaishou Kling — all confirmed live on this account). An explicit OPT-IN
 * alternative to the free stock-footage assembler (lib/video-generator.ts):
 * real, per-second billing (~$0.12/s, ~14x an avatar render), so it's Pro+
 * gated and priced with a proportionally higher purchased-credit cost
 * rather than a stricter plan tier.
 *
 * Same contract as every other generation: returns a videoId immediately,
 * poll GET /api/ai/jobs/[videoId].
 */

/**
 * A deliberately curated subset of the ~15 video-capable models this
 * account has access to (one representative per frontier provider) — a
 * ForgeVid product decision (which choices are worth surfacing), not a fact
 * about Runway's API, so it lives here rather than in lib/runway-provider.ts.
 */
const RUNWAY_VIDEO_MODELS = [
  'gen4.5', // Runway's own flagship
  'gen4_turbo', // Runway's own, faster/cheaper
  'veo3.1', // Google
  'seedance2', // ByteDance
  'kling3.0_pro', // Kuaishou
] as const;

const bodySchema = z.object({
  promptText: z.string().min(3).max(1000),
  model: z.enum(RUNWAY_VIDEO_MODELS).default('gen4.5'),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']).default('16:9'),
  /** Seconds — 2-10 is gen4.5's documented range, also enforced inside lib/runway-provider.ts. */
  duration: z.number().int().min(2).max(10).default(5),
  seed: z.number().int().min(0).max(4294967295).optional(),
});

// Worst case ($0.12/s x 10s = $1.20) against a purchased credit's ~$1.16-1.50
// amortized value is close to break-even on its own — priced at 2 credits
// for a real margin, since third-party (Veo/Seedance/Kling) pricing through
// Runway's markup isn't independently verified (see lib/cost-ledger.ts).
const RUNWAY_CREDIT_COST = 2;

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
  const input = parsed.data;

  if (!isRunwayConfigured()) {
    return NextResponse.json(
      { error: 'AI video generation is unavailable (RUNWAY_API_KEY is not configured)' },
      { status: 503 },
    );
  }

  // Frontier generation shares the monthly generation quota — this is the
  // most expensive thing the platform buys. Once exhausted, purchased
  // credits can pick this up too, at RUNWAY_CREDIT_COST each.
  const quota = await checkGenerationQuota(userId, input.duration, RUNWAY_CREDIT_COST);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: quota.reason, upgradeRequired: quota.upgradeRequired ?? false },
      { status: 429 },
    );
  }
  if (!allowsFrontierGeneration(quota.plan)) {
    return NextResponse.json(
      { error: `AI video generation requires the Pro plan (you are on ${quota.plan})`, upgradeRequired: true },
      { status: 403 },
    );
  }

  // Content policy: checked last, after every free gate — an OpenAI
  // moderation call is a real billed request, and a request already headed
  // for a 503/429/403 shouldn't spend it regardless of prompt content.
  // failClosed: unlike a script rewrite that a later step still vets, this
  // prompt IS the generated content — a moderation outage must not become a
  // free pass to unmoderated, billed video generation.
  const promptModeration = await moderateText(input.promptText, { failClosed: true });
  if (!promptModeration.allowed) {
    void recordModerationBlock('prompt', promptModeration.categories);
    return NextResponse.json({ error: promptModeration.reason ?? 'Blocked by our content policy.' }, { status: 422 });
  }

  try {
    const taskId = await createTextToVideo({
      promptText: input.promptText,
      model: input.model,
      aspectRatio: input.aspectRatio,
      duration: input.duration,
      seed: input.seed,
    });

    const video = await prisma.video.create({
      data: {
        title: input.promptText.slice(0, 80),
        description: input.promptText,
        status: 'QUEUED',
        duration: input.duration,
        format: 'mp4',
        userId,
        metadata: JSON.stringify({
          generation: { stage: 'queued', percent: 5, updatedAt: new Date().toISOString() },
          ...(quota.usePurchasedCredit ? { paidCredit: true } : {}),
          source: 'runway',
          provider: { name: 'runway', taskId, model: input.model },
          request: { aspectRatio: input.aspectRatio, duration: input.duration, model: input.model },
        }),
      },
      select: { id: true },
    });

    // Consume AFTER the provider has accepted the job — never spend
    // quota/credits on a request that never actually started.
    await settleGenerationEntitlement(userId, video.id, input.duration, quota);

    // Polling is lightweight (no local ffmpeg), so no render slot needed.
    void pollProviderJobToCompletion({
      videoId: video.id,
      userId,
      providerName: 'runway',
      prompt: input.promptText,
      checkStatus: () => getRunwayTaskStatus(taskId),
      // Runway is deterministic — it renders exactly the requested
      // duration, unlike HeyGen dub's translated-speech length, which can
      // vary. Billing the request's own duration is correct here.
      successCost: () => ({ runwaySeconds: input.duration }),
    });

    return NextResponse.json({
      videoId: video.id,
      status: 'queued',
      provider: 'runway',
      model: input.model,
      message: `Started generating with ${input.model}. Poll /api/ai/jobs/${video.id} for progress.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI video generation failed to start';
    console.error('[videos/runway/generate]', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
