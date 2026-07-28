import { prisma } from './prisma';
import type { Prisma } from '@prisma/client';

export interface EvaluationInput {
  userId: string;
  videoId: string;
  provider: string;
  model?: string | null;
  modelVersion?: string | null;
  candidateGroupId?: string | null;
  promptVersion?: string;
  storyboardVersion?: string;
  vertical?: string | null;
  language?: string | null;
  platform?: string | null;
  latencyMs?: number | null;
  estimatedCostUsd?: number | null;
  qualityScore?: number | null;
  qualityPassed?: boolean | null;
  factualPassed?: boolean | null;
  retryCount?: number;
  failureReason?: string | null;
  metrics?: Record<string, unknown> | null;
}

/** Persist a normalized learning record without ever storing credentials or raw media. */
export async function upsertGenerationEvaluation(input: EvaluationInput): Promise<void> {
  const data = {
    userId: input.userId,
    provider: input.provider,
    model: input.model ?? null,
    modelVersion: input.modelVersion ?? null,
    candidateGroupId: input.candidateGroupId ?? null,
    promptVersion: input.promptVersion ?? 'v1',
    storyboardVersion: input.storyboardVersion ?? 'v1',
    vertical: input.vertical ?? null,
    language: input.language ?? null,
    platform: input.platform ?? null,
    latencyMs: input.latencyMs ?? null,
    estimatedCostUsd: input.estimatedCostUsd ?? null,
    qualityScore: input.qualityScore ?? null,
    qualityPassed: input.qualityPassed ?? null,
    factualPassed: input.factualPassed ?? null,
    retryCount: input.retryCount ?? 0,
    failureReason: input.failureReason?.slice(0, 1000) ?? null,
    metrics: input.metrics as Prisma.InputJsonValue | undefined,
  };
  await prisma.generationEvaluation.upsert({
    where: { videoId: input.videoId },
    create: { videoId: input.videoId, ...data },
    update: data,
  });
}

export async function recordProviderObservation(input: {
  userId?: string | null;
  videoId?: string | null;
  provider: string;
  model?: string | null;
  operation: string;
  vertical?: string | null;
  language?: string | null;
  latencyMs: number;
  costUsd?: number | null;
  qualityScore?: number | null;
  succeeded: boolean;
  errorCode?: string | null;
}): Promise<void> {
  await prisma.providerObservation.create({
    data: {
      ...input,
      userId: input.userId ?? null,
      videoId: input.videoId ?? null,
      model: input.model ?? null,
      vertical: input.vertical ?? null,
      language: input.language ?? null,
      costUsd: input.costUsd ?? null,
      qualityScore: input.qualityScore ?? null,
      errorCode: input.errorCode?.slice(0, 200) ?? null,
    },
  });
}

export async function recordCustomerEvaluation(input: {
  userId: string;
  videoId: string;
  rating?: number | null;
  accepted: boolean;
  selectedCandidate?: boolean;
  editSummary?: string | null;
}): Promise<void> {
  const owned = await prisma.video.findFirst({
    where: { id: input.videoId, userId: input.userId },
    select: { id: true },
  });
  if (!owned) throw new Error('Video not found');
  // updateMany, not update: an opted-out user's render has NO evaluation row
  // (recording is consent-gated in the pipeline), and their accept/reject
  // must still succeed — count 0 is a fine outcome, not an error.
  await prisma.generationEvaluation.updateMany({
    where: { videoId: input.videoId },
    data: {
      customerRating: input.rating ?? null,
      customerAccepted: input.accepted,
      selectedCandidate: input.selectedCandidate ?? false,
      editSummary: input.editSummary?.slice(0, 2000) ?? null,
    },
  });
}
