/**
 * Per-generation cost ledger.
 *
 * You cannot price plans without knowing unit cost. Every generation writes an
 * AIGeneration row whose `cost` is an ESTIMATE built from published unit rates —
 * good enough to see margins per plan, not an invoice.
 *
 * Relative imports only — reachable from the worker process.
 */

import { prisma } from './prisma';

/** Unit rates (USD). Update when providers reprice. */
export const RATES = {
  /** GPT-4-class script call, per 1K tokens (blended in/out). */
  gptPer1kTokens: 0.02,
  /** ElevenLabs, per 1K characters synthesized. */
  ttsPer1kChars: 0.15,
  /** Whisper, per minute of audio transcribed. */
  whisperPerMinute: 0.006,
  /** Our compute: ffmpeg render, per minute of output (rough VM amortisation). */
  renderPerMinute: 0.01,
  /** HeyGen-class avatar rendering, per minute of output. */
  avatarPerMinute: 0.5,
  /** HeyGen video-translate (dub + lip-sync an existing video), per minute of source. */
  dubPerMinute: 2.0,
  /**
   * Runway frontier video generation, per second of output — the FALLBACK
   * for models without a measured rate below.
   */
  runwayPerSecond: 0.12,
  /**
   * Per-model rates MEASURED from real credit spend on this account
   * (2026-07-28 live verification; 1 Runway credit = $0.01):
   *   gen4.5    60cr / 5s  → $0.12/s (matches Runway's published rate)
   *   veo3.1   ~200cr / 8s → $0.25/s
   *   seedance2 180cr / 5s → $0.36/s
   *   kling3.0_pro ~205cr / 5s → $0.41/s
   * These drive both cost estimates and the per-model credit prices in
   * app/api/videos/runway/generate/route.ts — a flat rate here is what
   * originally under-priced the premium models.
   */
  runwayPerSecondByModel: {
    'gen4.5': 0.12,
    'veo3.1': 0.25,
    seedance2: 0.36,
    'kling3.0_pro': 0.41,
  } as Record<string, number>,
};

export interface CostInputs {
  gptTokens?: number;
  ttsChars?: number;
  whisperSeconds?: number;
  renderSeconds?: number;
  avatarSeconds?: number;
  dubSeconds?: number;
  runwaySeconds?: number;
  /** Which frontier model rendered runwaySeconds — selects its measured rate. */
  runwayModel?: string;
}

export interface CostBreakdown extends Required<Omit<CostInputs, 'runwayModel'>> {
  runwayModel: string | null;
  totalUsd: number;
}

export function estimateGenerationCost(inputs: CostInputs): CostBreakdown {
  const gptTokens = Math.max(0, inputs.gptTokens ?? 0);
  const ttsChars = Math.max(0, inputs.ttsChars ?? 0);
  const whisperSeconds = Math.max(0, inputs.whisperSeconds ?? 0);
  const renderSeconds = Math.max(0, inputs.renderSeconds ?? 0);
  const avatarSeconds = Math.max(0, inputs.avatarSeconds ?? 0);
  const dubSeconds = Math.max(0, inputs.dubSeconds ?? 0);
  const runwaySeconds = Math.max(0, inputs.runwaySeconds ?? 0);
  const runwayRate =
    (inputs.runwayModel ? RATES.runwayPerSecondByModel[inputs.runwayModel] : undefined) ??
    RATES.runwayPerSecond;

  const totalUsd =
    (gptTokens / 1000) * RATES.gptPer1kTokens +
    (ttsChars / 1000) * RATES.ttsPer1kChars +
    (whisperSeconds / 60) * RATES.whisperPerMinute +
    (renderSeconds / 60) * RATES.renderPerMinute +
    (avatarSeconds / 60) * RATES.avatarPerMinute +
    (dubSeconds / 60) * RATES.dubPerMinute +
    runwaySeconds * runwayRate;

  return {
    gptTokens,
    ttsChars,
    whisperSeconds,
    renderSeconds,
    avatarSeconds,
    dubSeconds,
    runwaySeconds,
    runwayModel: inputs.runwayModel ?? null,
    totalUsd: Number(totalUsd.toFixed(6)),
  };
}

/**
 * Persist the estimate. Runs in the pipeline (worker or inline), so cost is
 * recorded wherever the work actually happened. Best-effort: bookkeeping must
 * never fail a finished render.
 */
export async function recordGenerationCost(args: {
  userId: string;
  videoId: string;
  prompt: string;
  breakdown: CostBreakdown;
  succeeded: boolean;
}): Promise<void> {
  try {
    await prisma.aIGeneration.create({
      data: {
        type: 'VIDEO_GENERATION',
        prompt: args.prompt.slice(0, 1000),
        result: args.videoId,
        status: args.succeeded ? 'COMPLETED' : 'FAILED',
        tokensUsed: args.breakdown.gptTokens,
        cost: args.breakdown.totalUsd,
        userId: args.userId,
      },
    });
  } catch (error) {
    console.error('[CostLedger] Failed to record cost:', error);
  }
}
