import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireVideoOwner } from '@/lib/video-access';
import { runGeneration, type GenerationInput } from '@/lib/generation-pipeline';
import type { ResolvedScene } from '@/lib/video-generator';
import { enqueueGeneration } from '@/lib/video-queue';
import { withRenderSlot } from '@/lib/render-semaphore';
import { checkGenerationQuota, settleGenerationEntitlement } from '@/lib/quota';
import { hasLlmKey } from '@/lib/ai/llm';
import { resolveVoiceIdForUser } from '@/lib/cloned-voices';
import { backTranslationReport, localizedPresetScenes } from '@/lib/localize';
import { NARRATION_LANGUAGE_NAMES, spokenLine, type NarrationLanguage } from '@/lib/video-generator';

/**
 * POST /api/videos/[videoId]/localize — a new video in another language,
 * reusing the source video's scene structure (search query, keywords,
 * duration, branding) and translating only what's spoken (see
 * lib/localize.ts). This does NOT guarantee the exact same stock clips —
 * resolveSceneClips searches fresh each time — only the same visual BODY
 * (what each scene is about and how long it runs). A `mediaOnly` source
 * (an agent's own listing photos) DOES carry its exact media over, since
 * that path never touches stock search at all.
 *
 * A real generation: quota-checked and metered the same as any fresh
 * render, because it spends real GPT/TTS/compute — it just skips scene
 * planning and reuses the translated body instead.
 *
 * Returns a new videoId immediately; poll GET /api/ai/jobs/[videoId] for
 * progress, same as a fresh generation.
 */

const LANGUAGES = Object.keys(NARRATION_LANGUAGE_NAMES) as NarrationLanguage[];

const bodySchema = z.object({
  targetLanguage: z.enum(LANGUAGES as [NarrationLanguage, ...NarrationLanguage[]]),
  voiceId: z.string().max(200).optional(),
});

export async function POST(req: NextRequest, props: { params: Promise<{ videoId: string }> }) {
  const params = await props.params;
  const access = await requireVideoOwner(params.videoId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  if (!hasLlmKey()) {
    return NextResponse.json(
      { error: 'Localization needs an LLM key (OPENAI_API_KEY or GEMINI_API_KEY) to translate the narration' },
      { status: 503 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }
  const { targetLanguage, voiceId } = parsed.data;

  const source = await prisma.video.findUnique({
    where: { id: params.videoId },
    select: { title: true, duration: true, metadata: true },
  });
  const meta = source?.metadata ? JSON.parse(source.metadata) : {};
  const scenes: ResolvedScene[] = Array.isArray(meta.scenes) ? meta.scenes : [];
  if (scenes.length === 0) {
    return NextResponse.json({ error: 'This video has no persisted scenes to localize' }, { status: 422 });
  }
  const request: Partial<GenerationInput> = meta.request ?? {};

  if (request.language === targetLanguage) {
    return NextResponse.json(
      { error: `This video is already in ${NARRATION_LANGUAGE_NAMES[targetLanguage]}` },
      { status: 422 },
    );
  }

  const duration = source?.duration || scenes.reduce((n, s) => n + s.duration, 0);

  // A localization is a real render (GPT translation, fresh TTS, a full ffmpeg
  // assembly) — quota-checked exactly like a fresh generation.
  const quota = await checkGenerationQuota(access.userId, duration);
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error: quota.reason,
        quota: { used: quota.used, limit: quota.limit, plan: quota.plan },
        upgradeRequired: quota.upgradeRequired ?? false,
      },
      { status: 429 },
    );
  }

  const presetScenes = await localizedPresetScenes(scenes, targetLanguage, {
    userId: access.userId,
    sourceLanguage: request.language ?? 'en',
  });
  const resolvedVoiceId = await resolveVoiceIdForUser(access.userId, voiceId ?? request.voiceId);

  // The localization profile's requireHumanReview flag, finally consumed:
  // when the profile demands it and any line was actually machine-translated
  // (identical lines mean a memory hit or a fallback — both pre-approved or
  // unchanged), the finished render is HELD for the owner's review with a
  // back-translation drift report attached to the review card.
  let reviewHold: GenerationInput['reviewHold'] = null;
  const profile = await prisma.localizationProfile
    .findUnique({ where: { userId: access.userId }, select: { requireHumanReview: true } })
    .catch(() => null);
  if (profile?.requireHumanReview) {
    const originalLines = scenes.map((scene) => spokenLine(scene));
    const translatedLines = presetScenes.map((scene) => scene.narration ?? '');
    const machineTranslated = translatedLines.some((line, i) => line && line !== originalLines[i]);
    if (machineTranslated) {
      const report = await backTranslationReport(originalLines, translatedLines, targetLanguage);
      reviewHold = {
        reason: `Machine translation to ${NARRATION_LANGUAGE_NAMES[targetLanguage]} requires your review (localization profile setting)`,
        details: report ?? undefined,
      };
    }
  }

  const genInput: GenerationInput = {
    prompt: request.prompt ?? source?.title ?? 'Localized video',
    style: request.style ?? 'modern',
    duration,
    addOns: request.addOns ?? ['voiceover', 'subtitles'],
    aspectRatio: request.aspectRatio,
    voiceId: resolvedVoiceId,
    language: targetLanguage,
    transition: request.transition,
    renderQuality: request.renderQuality,
    captionPreset: request.captionPreset,
    forgeVidEndCard: request.forgeVidEndCard,
    lowerThird: request.lowerThird ?? null,
    presetScenes,
    // Carries the source video's own media over exactly (mediaOnly skips
    // stock search entirely) — this is what makes a mediaOnly listing/
    // vehicle video localize with its real photos instead of stock footage.
    mediaAssetIds: request.mediaAssetIds,
    mediaOnly: request.mediaOnly,
    musicAssetId: request.musicAssetId,
    pip: request.pip,
    reviewHold,
    // narrationAssetId is deliberately NOT carried over: that's the user's
    // own recorded voice in the ORIGINAL language, and translation always
    // needs fresh TTS in the target language.
  };

  const video = await prisma.video.create({
    data: {
      title: `${source?.title ?? 'Video'} (${NARRATION_LANGUAGE_NAMES[targetLanguage]})`,
      description: `Localized from video ${params.videoId}`,
      status: 'QUEUED',
      duration,
      format: 'mp4',
      userId: access.userId,
      metadata: JSON.stringify({
        generation: { stage: 'queued', percent: 5, updatedAt: new Date().toISOString() },
        ...(quota.usePurchasedCredit ? { paidCredit: true } : {}),
        request: genInput,
        // Shared "derived from" convention with the dub route
        // (app/api/videos/[videoId]/dub/route.ts) — one metadata key for
        // both variant types rather than each feature inventing its own.
        variantType: 'localize',
        sourceVideoId: params.videoId,
      }),
    },
    select: { id: true },
  });

  await settleGenerationEntitlement(access.userId, video.id, duration, quota);

  const jobId = await enqueueGeneration({ videoId: video.id, userId: access.userId, input: genInput });
  if (!jobId) {
    void withRenderSlot(() => runGeneration(video.id, genInput)).catch((err) =>
      console.error('[localize] inline generation failed:', err instanceof Error ? err.message : err),
    );
  }

  return NextResponse.json({
    videoId: video.id,
    jobId: jobId ?? null,
    status: 'queued',
    mode: jobId ? 'queued' : 'inline',
    targetLanguage,
    sceneCount: presetScenes.length,
    message: `Started localizing into ${NARRATION_LANGUAGE_NAMES[targetLanguage]}. Poll /api/ai/jobs/${video.id} for progress.`,
  });
}
