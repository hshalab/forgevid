import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { enqueueGeneration } from '@/lib/video-queue';
import { runGeneration } from '@/lib/generation-pipeline';
import { withRenderSlot } from '@/lib/render-semaphore';
import { checkGenerationQuota, settleGenerationEntitlement } from '@/lib/quota';
import { resolveVoiceIdForUser } from '@/lib/cloned-voices';
import { DEFAULT_TRANSITION, TRANSITIONS } from '@/lib/transitions';
import { hasLlmKey } from '@/lib/ai/llm';
import { planScenes } from '@/lib/video-generator';
import {
  MAX_VARIANTS,
  VariationError,
  assertBodySupportsAxes,
  expandVariations,
  type VariationAxes,
} from '@/lib/ad-variations';

/**
 * POST /api/campaigns/variations — one concept, a matrix of ad creatives.
 *
 * The body is planned ONCE and reused, so every variant differs by exactly the
 * axis under test (hook, CTA, or placement) — a valid A/B test, not twelve
 * unrelated videos. Each variant is a real generation, quota-checked and queued
 * individually; its label ("hook:urgency · 9:16 · cta:signup") is how the
 * marketer reads the result.
 */

export const dynamic = 'force-dynamic';

const hookSchema = z.object({
  label: z.string().min(1).max(40),
  narration: z.string().min(1).max(300),
  searchQuery: z.string().max(120).optional(),
});
const ctaSchema = z.object({
  label: z.string().min(1).max(40),
  narration: z.string().min(1).max(300),
});

const bodySchema = z.object({
  prompt: z.string().min(1).max(2000),
  style: z.string().default('modern'),
  duration: z.number().int().min(5).max(120).default(20),
  addOns: z.array(z.string()).default(['voiceover', 'subtitles', 'music']),
  voiceId: z.string().optional(),
  renderQuality: z.enum(['draft', 'full', '4k']).default('full'),
  transition: z
    .object({ type: z.enum(TRANSITIONS), duration: z.number().min(0).max(3) })
    .nullable()
    .optional(),
  axes: z.object({
    hooks: z.array(hookSchema).max(6).optional(),
    ctas: z.array(ctaSchema).max(4).optional(),
    aspectRatios: z.array(z.enum(['16:9', '9:16', '1:1'])).max(3).optional(),
    languages: z.array(z.enum(['en', 'es'])).min(1).max(2).optional(),
  }),
});

interface VariantResult {
  label: string;
  aspectRatio: string;
  axes: Record<string, unknown>;
  language: string;
  videoId?: string;
  error?: string;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const userId = session.user.id;

  if (!hasLlmKey()) {
    return NextResponse.json(
      { error: 'Variation generation needs an LLM key (OPENAI_API_KEY or GEMINI_API_KEY) to plan the concept' },
      { status: 503 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;
  const axes = input.axes as VariationAxes;

  // Expand the matrix first: refuse an over-large or impossible request before
  // spending an OpenAI call planning the body.
  let variants;
  try {
    variants = expandVariations(axes);
  } catch (error) {
    if (error instanceof VariationError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }

  // Plan once PER language. Variants in the same language share an identical
  // body, while EN/ES narration is generated natively rather than translated
  // after rendering.
  const bodies = new Map<string, Awaited<ReturnType<typeof planScenes>>>();
  try {
    for (const language of [...new Set(variants.map((variant) => variant.language))]) {
      const body = await planScenes(input.prompt, input.duration, language);
      assertBodySupportsAxes(body, axes);
      bodies.set(language, body);
    }
  } catch (error) {
    if (error instanceof VariationError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error('[campaigns] planning failed:', error);
    return NextResponse.json({ error: 'Could not plan the concept' }, { status: 502 });
  }

  const resolvedVoiceId = await resolveVoiceIdForUser(userId, input.voiceId);
  const transition = input.transition === undefined ? DEFAULT_TRANSITION : input.transition;
  const results: VariantResult[] = [];

  for (const variant of variants) {
    const result: VariantResult = {
      label: variant.label,
      aspectRatio: variant.aspectRatio,
      axes: variant.axes,
      language: variant.language,
    };

    // Quota per variant: a 12-variant matrix must not let a user render twelve
    // videos on a plan that allows five. Once the monthly allowance runs out
    // mid-batch, purchased credits pick up the remaining variants (1 credit
    // each) instead of hard-denying the rest of the matrix.
    const quota = await checkGenerationQuota(userId, input.duration, 1);
    if (!quota.allowed) {
      result.error = quota.reason ?? 'Quota exceeded';
      results.push(result);
      continue;
    }

    const genInput = {
      prompt: input.prompt,
      style: input.style,
      duration: input.duration,
      addOns: input.addOns,
      aspectRatio: variant.aspectRatio,
      voiceId: resolvedVoiceId,
      transition,
      renderQuality: input.renderQuality,
      language: variant.language,
      // The shared body + this variant's single overridden axis.
      presetScenes: bodies.get(variant.language),
      hookNarration: variant.hookNarration,
      hookSearchQuery: variant.hookSearchQuery,
      ctaNarration: variant.ctaNarration,
    };

    try {
      const video = await prisma.video.create({
        data: {
          title: `${input.prompt.slice(0, 60)} — ${variant.label}`,
          description: `Ad variant: ${variant.label}`,
          status: 'QUEUED',
          duration: input.duration,
          format: 'mp4',
          userId,
          metadata: JSON.stringify({
            generation: { stage: 'queued', percent: 5, updatedAt: new Date().toISOString() },
            // Paid-credit videos get the watermark removed (lib/generation-pipeline.ts
            // brandingForVideo) — set server-side ONLY, from the quota verdict.
            ...(quota.usePurchasedCredit ? { paidCredit: true } : {}),
            request: genInput,
            variant: { label: variant.label, axes: variant.axes },
          }),
        },
        select: { id: true },
      });

      await settleGenerationEntitlement(userId, video.id, input.duration, quota);

      const jobId = await enqueueGeneration({ videoId: video.id, userId, input: genInput });
      if (!jobId) {
        void withRenderSlot(() => runGeneration(video.id, genInput)).catch((err) =>
          console.error(`[campaigns] ${variant.label} failed:`, err instanceof Error ? err.message : err),
        );
      }
      result.videoId = video.id;
    } catch (error) {
      console.error(`[campaigns] ${variant.label} could not start:`, error);
      result.error = 'Could not start this variant';
    }

    results.push(result);
  }

  const started = results.filter((r) => r.videoId).length;
  return NextResponse.json({
    concept: input.prompt.slice(0, 80),
    bodyScenes: Object.fromEntries([...bodies].map(([language, body]) => [language, body.length])),
    started,
    failed: results.length - started,
    limit: MAX_VARIANTS,
    variants: results,
    message: `Started ${started} of ${results.length} ad variants from one concept. Poll /api/ai/jobs/{videoId} for each.`,
  });
}
