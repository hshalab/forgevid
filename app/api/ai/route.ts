import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { OpenAI } from 'openai';
import { openAiApiKey } from '@/lib/openai-key';
import { lazyClient } from '@/lib/lazy-client';
import { llm, llmModel } from '@/lib/ai/llm';
import { securityConfigs } from '@/lib/api-security';
import { enqueueGeneration } from '@/lib/video-queue';
import { runGeneration } from '@/lib/generation-pipeline';
import { DEFAULT_TTS_MODEL, resolveVoiceId } from '@/lib/voice-catalog';
import { resolveVoiceIdForUser } from '@/lib/cloned-voices';
import { DEFAULT_TRANSITION, TRANSITIONS } from '@/lib/transitions';
import { checkGenerationQuota, settleGenerationEntitlement } from '@/lib/quota';
import { moderateText, recordModerationBlock } from '@/lib/moderation';
import { allows4k } from '@/lib/plan';
import { withRenderSlot } from '@/lib/render-semaphore';
import { withProviderReliability } from '@/lib/provider-reliability';

const aiGenerationSchema = z.object({
  prompt: z.string().min(1).max(2000),
  type: z.enum(['VIDEO_GENERATION', 'STORYBOARD', 'SCRIPT_WRITING', 'VOICE_SYNTHESIS', 'IMAGE_GENERATION']),
  settings: z.record(z.string(), z.any()).optional(),
});

// OpenAI-only client: kept for DALL-E image generation, which has no Gemini
// equivalent on the compat endpoint. Text completions use the provider-agnostic
// `llm` client below (OpenAI or Gemini, per LLM_PROVIDER / configured keys).
const openai = lazyClient<OpenAI>(() => new OpenAI({
  apiKey: openAiApiKey(),
}));

async function synthesizeWithElevenLabs(text: string, voiceId?: string) {
  try {
    const response = await withProviderReliability('elevenlabs', () => fetch(`https://api.elevenlabs.io/v1/text-to-speech/${resolveVoiceId(voiceId)}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY || '',
      },
      body: JSON.stringify({
        text,
        model_id: DEFAULT_TTS_MODEL,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5
        }
      })
    }));

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.statusText}`);
    }

    const audioBuffer = await response.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');
    
    return {
      audioUrl: `data:audio/mpeg;base64,${audioBase64}`,
      cost: Math.ceil(text.length / 100) * 0.0001 // Estimated cost per character
    };
  } catch (error) {
    console.error('ElevenLabs API error:', error);
    throw new Error('Voice synthesis failed');
  }
}

const generateVideoSchema = z.object({
  prompt: z.string().min(1).max(2000),
  style: z.string().default('modern'),
  duration: z.number().int().min(3).max(600).default(60),
  addOns: z.array(z.string()).optional(),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']).default('16:9'),
  // Narration + caption language (Latin-script set the caption font renders).
  // Writes the spoken text in that language; stock search stays English. The
  // multilingual voices speak all of these natively.
  language: z.enum(['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ja', 'ko', 'hi']).optional(),
  voiceId: z.string().optional(),
  // The user's own MediaAsset ids, in scene order. Ownership is checked
  // server-side; urls are never accepted from the client.
  mediaAssetIds: z.array(z.string()).max(20).optional(),
  // 'draft' renders at half resolution with fast encoding for quick previews.
  renderQuality: z.enum(['draft', 'full', '4k']).default('full'),
  // A MediaAsset (AUDIO) id: use the user's OWN narration instead of AI TTS.
  narrationAssetId: z.string().optional(),
  // A MediaAsset (AUDIO) id: the user's OWN background music track.
  musicAssetId: z.string().optional(),
  // Caption look; 'karaoke' = word-by-word highlight (Reels/TikTok style).
  captionPreset: z.enum(['default', 'large', 'subtle', 'karaoke']).optional(),
  forgeVidEndCard: z.boolean().default(false),
  // Presenter picture-in-picture: a VIDEO MediaAsset overlaid in a corner,
  // muted — pair with narrationAssetId for the presenter's voice.
  pip: z
    .object({
      assetId: z.string(),
      position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).default('bottom-right'),
      size: z.number().min(0.15).max(0.45).default(0.28),
    })
    .optional(),
  // Use ONLY mediaAssetIds; never pad the plan with stock footage.
  mediaOnly: z.boolean().default(false),
  // Burned-in title bar: address + price. Text is escaped before it reaches
  // the filtergraph (lib/lower-third.ts).
  lowerThird: z
    .object({
      title: z.string().min(1).max(120),
      facts: z.array(z.string().max(60)).max(5).optional(),
      start: z.number().min(0).max(60).optional(),
      duration: z.number().min(0.5).max(60).optional(),
    })
    .nullable()
    .optional(),
  // null = hard cuts. Omitted = the default cross-fade.
  transition: z
    .object({ type: z.enum(TRANSITIONS), duration: z.number().min(0).max(3) })
    .nullable()
    .optional(),
  enableEmotionAware: z.boolean().optional(),
});

// Start a generation job and return immediately.
//
// The multi-minute pipeline (script -> scenes -> footage -> voiceover ->
// FFmpeg -> upload) runs OUT of the request: on a BullMQ worker when REDIS_URL
// is set, otherwise inline as a fire-and-forget task. Either way we create the
// Video row up front (status PROCESSING) so it shows in "My Videos" right away
// and the client can poll GET /api/ai/jobs/[videoId] for real progress.
async function handleGenerateVideo(body: any, userId: string) {
  const parsed = generateVideoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid request', details: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // Content policy: block prohibited prompts before spending anything on them.
  const promptModeration = await moderateText(input.prompt);
  if (!promptModeration.allowed) {
    void recordModerationBlock('prompt', promptModeration.categories);
    return NextResponse.json({ error: promptModeration.reason ?? 'Blocked by our content policy.' }, { status: 422 });
  }

  // Quota gate: every generation costs GPT + TTS + Whisper + compute. The
  // rejection names the limit so it doubles as upgrade pressure.
  const quota = await checkGenerationQuota(userId, input.duration);
  if (!quota.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: quota.reason,
        quota: { used: quota.used, limit: quota.limit, plan: quota.plan },
        upgradeRequired: quota.upgradeRequired ?? false,
      },
      { status: 429 },
    );
  }

  // 4K quadruples the pixels and roughly the compute — pro tier and above.
  if (input.renderQuality === '4k' && !allows4k(quota.plan)) {
    return NextResponse.json(
      {
        success: false,
        error: `4K rendering requires the Pro plan (you are on ${quota.plan})`,
        upgradeRequired: true,
      },
      { status: 403 },
    );
  }

  try {
    const video = await prisma.video.create({
      data: {
        title: input.prompt.slice(0, 80),
        description: input.prompt,
        // QUEUED until a worker (or the inline runner) actually picks it up.
        status: 'QUEUED',
        duration: input.duration,
        format: 'mp4',
        userId,
        metadata: JSON.stringify({
          generation: { stage: 'queued', percent: 5, updatedAt: new Date().toISOString() },
          // Paid-credit videos get the watermark removed (lib/generation-pipeline.ts
          // brandingForVideo) and a relaxed duration floor — set server-side ONLY,
          // from the quota verdict, never from client input.
          ...(quota.usePurchasedCredit ? { paidCredit: true } : {}),
          request: {
            style: input.style,
            duration: input.duration,
            addOns: input.addOns ?? [],
            // Re-render and scene-swap read these back so they stay consistent.
            aspectRatio: input.aspectRatio,
            language: input.language,
            voiceId: await resolveVoiceIdForUser(userId, input.voiceId),
            transition: input.transition === undefined ? DEFAULT_TRANSITION : input.transition,
            mediaAssetIds: input.mediaAssetIds ?? [],
            renderQuality: input.renderQuality,
            narrationAssetId: input.narrationAssetId,
            musicAssetId: input.musicAssetId,
            captionPreset: input.captionPreset,
            forgeVidEndCard: input.forgeVidEndCard,
            pip: input.pip ?? null,
            mediaOnly: input.mediaOnly,
            lowerThird: input.lowerThird ?? null,
            // enableEmotionAware is preserved for the pipeline to honor once
            // emotion-aware generation is folded into the worker (TODO Phase 5).
            enableEmotionAware: input.enableEmotionAware ?? false,
          },
        }),
      },
      select: { id: true },
    });

    // The job is accepted — settle the entitlement now, not on completion, or
    // a user could requeue endlessly while jobs run. Records monthly usage
    // and, if the monthly allowance was already exhausted, spends the
    // purchased credit the verdict priced in — see lib/quota.ts.
    await settleGenerationEntitlement(userId, video.id, input.duration, quota);

    const jobId = await enqueueGeneration({ videoId: video.id, userId, input });
    if (!jobId) {
      // No Redis worker: render synchronously within this request, throttled so N
      // clicks can't fork N ffmpeg chains. This MUST be awaited — a fire-and-forget
      // task does not survive the Next.js request lifecycle (the render would never
      // run and the video would sit at QUEUED forever). Railway keeps the container
      // alive for the full render; short videos finish well inside its limits.
      // runGeneration marks the Video FAILED on error, so we swallow here.
      try {
        await withRenderSlot(() => runGeneration(video.id, input));
      } catch (err) {
        console.error(
          '[AI API] inline generation failed:',
          err instanceof Error ? err.message : err,
        );
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        videoId: video.id,
        jobId: jobId ?? null,
        status: 'queued',
        mode: jobId ? 'queued' : 'inline',
      },
      message: 'Video generation started. Poll /api/ai/jobs/{videoId} for progress.',
    });
  } catch (error) {
    console.error('[AI API] Failed to start video generation:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to start video generation' },
      { status: 500 },
    );
  }
}

async function processAIGeneration(type: string, prompt: string, settings?: Record<string, any>) {
  try {
    switch (type) {
      case 'SCRIPT_WRITING':
        const scriptResponse = await llm.chat.completions.create({
          model: llmModel(),
          messages: [
            {
              role: 'system',
              content: 'You are a professional video script writer. Create engaging, concise video scripts based on the user prompt. Include scene descriptions, dialogue, and visual cues.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 2048,
          temperature: 0.7
        });
        return {
          result: scriptResponse.choices[0]?.message?.content || '',
          tokensUsed: scriptResponse.usage?.total_tokens || 0,
          cost: (scriptResponse.usage?.total_tokens || 0) * 0.00003 // $0.03 per 1K tokens for GPT-4
        };
      
      case 'STORYBOARD':
        const storyboardResponse = await llm.chat.completions.create({
          model: llmModel(),
          messages: [
            {
              role: 'system',
              content: 'You are a professional storyboard artist. Create detailed storyboard descriptions with scene-by-scene breakdowns, camera angles, and visual elements.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 2048,
          temperature: 0.6
        });
        return {
          result: storyboardResponse.choices[0]?.message?.content || '',
          tokensUsed: storyboardResponse.usage?.total_tokens || 0,
          cost: (storyboardResponse.usage?.total_tokens || 0) * 0.00003
        };
      
      case 'VOICE_SYNTHESIS':
        const voiceResult = await synthesizeWithElevenLabs(prompt, settings?.voiceId);
        return {
          result: voiceResult.audioUrl,
          tokensUsed: 0,
          cost: voiceResult.cost
        };
      
      case 'IMAGE_GENERATION':
        const imageResponse = await withProviderReliability('openai', () => openai.images.generate({
          model: 'dall-e-3',
          prompt: prompt,
          n: 1,
          size: settings?.size || '1024x1024',
          quality: settings?.quality || 'standard'
        }));
        return {
          result: imageResponse.data?.[0]?.url || '',
          tokensUsed: 0,
          cost: settings?.quality === 'hd' ? 0.08 : 0.04 // DALL-E-3 pricing
        };
      
      default:
        const generalResponse = await llm.chat.completions.create({
          model: llmModel(),
          messages: [
            {
              role: 'system',
              content: 'You are an AI assistant for video creation. Help users with their video generation requests.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 2048,
          temperature: 0.7
        });
        return {
          result: generalResponse.choices[0]?.message?.content || '',
          tokensUsed: generalResponse.usage?.total_tokens || 0,
          cost: (generalResponse.usage?.total_tokens || 0) * 0.00003
        };
    }
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw new Error('AI generation failed');
  }
}

async function handlePost(request: NextRequest) {
  // Get user session
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }
  
  const userId = session.user.id;

  const body = await request.json();
  
  // Handle generate_video action
  if (body.action === 'generate_video') {
    return await handleGenerateVideo(body, userId);
  }
  
  const parsed = aiGenerationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid AI generation request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { prompt, type, settings } = parsed.data;

  // Create initial generation record
  const aiGeneration = await prisma.aIGeneration.create({
    data: {
      prompt,
      type,
      status: 'PROCESSING',
      userId,
    },
  });

  try {
    // Process with OpenAI/ElevenLabs
    const result = await processAIGeneration(type, prompt, settings);
    
    // Update with results
    const updatedGeneration = await prisma.aIGeneration.update({
      where: { id: aiGeneration.id },
      data: {
        result: result.result,
        tokensUsed: result.tokensUsed,
        cost: result.cost,
        status: 'COMPLETED'
      },
    });

    return NextResponse.json({ 
      id: updatedGeneration.id,
      status: 'completed',
      result: result.result,
      tokensUsed: result.tokensUsed,
      cost: result.cost
    });
  } catch (error) {
    // Update status to failed
    await prisma.aIGeneration.update({
      where: { id: aiGeneration.id },
      data: { status: 'FAILED' },
    });

    console.error('AI generation error:', error);
    return NextResponse.json(
      { error: 'AI generation failed' }, 
      { status: 500 }
    );
  }
}

async function handleGet(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  const url = new URL(request.url);
  const generationId = url.searchParams.get('id');

  if (generationId) {
    const generation = await prisma.aIGeneration.findUnique({
      where: { id: generationId },
      include: { user: { select: { id: true, name: true } } },
    });

    if (!generation || generation.userId !== userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(generation);
  }

  // List user's AI generations
  const generations = await prisma.aIGeneration.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return NextResponse.json(generations);
}

export const POST = securityConfigs.authenticated(handlePost);
export const GET = securityConfigs.readOnly(handleGet);
