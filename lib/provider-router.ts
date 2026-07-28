import { prisma } from './prisma';
import { productImprovementOptOuts } from './learning-consent';

export const FRONTIER_MODELS = [
  { provider: 'runway', model: 'gen4.5', qualityPrior: 92, costPrior: 0.12, latencyPrior: 90 },
  { provider: 'runway', model: 'gen3a_turbo', qualityPrior: 78, costPrior: 0.05, latencyPrior: 45 },
  { provider: 'runway', model: 'veo3.1', qualityPrior: 94, costPrior: 0.14, latencyPrior: 110 },
  { provider: 'runway', model: 'seedance2', qualityPrior: 87, costPrior: 0.10, latencyPrior: 75 },
  { provider: 'runway', model: 'kling3.0_pro', qualityPrior: 90, costPrior: 0.12, latencyPrior: 100 },
] as const;

export type FrontierModel = (typeof FRONTIER_MODELS)[number]['model'];

export interface RouteContext {
  vertical?: string;
  language?: string;
  priority?: 'quality' | 'balanced' | 'speed' | 'cost';
  excludeModels?: string[];
}

export interface ModelRecommendation {
  provider: string;
  model: FrontierModel;
  score: number;
  reason: string;
  evidenceCount: number;
  predictedQuality: number;
  predictedLatencyMs: number;
  predictedCostPerSecond: number;
}

/**
 * Deterministic, explainable routing. It starts from conservative priors and
 * replaces them with persisted evidence as observations accumulate.
 */
export async function recommendFrontierModels(
  context: RouteContext,
  limit = 3,
): Promise<ModelRecommendation[]> {
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const optOuts = await productImprovementOptOuts();
  const observations = await prisma.providerObservation.findMany({
    where: {
      createdAt: { gte: since },
      operation: 'frontier_video',
      AND: [
        ...(context.vertical ? [{ OR: [{ vertical: context.vertical }, { vertical: null }] }] : []),
        ...(context.language ? [{ OR: [{ language: context.language }, { language: null }] }] : []),
        // Consent: opted-out users' observations never inform routing. The
        // explicit `userId: null` arm matters — SQL NOT IN drops NULL rows,
        // which would silently discard system-level observations.
        ...(optOuts.length ? [{ OR: [{ userId: null }, { userId: { notIn: optOuts } }] }] : []),
      ],
    },
    select: { model: true, latencyMs: true, costUsd: true, qualityScore: true, succeeded: true },
  });

  const priority = context.priority ?? 'balanced';
  const weights = {
    quality: priority === 'quality' ? 0.7 : priority === 'speed' ? 0.25 : priority === 'cost' ? 0.3 : 0.5,
    reliability: 0.2,
    speed: priority === 'speed' ? 0.45 : 0.15,
    cost: priority === 'cost' ? 0.4 : 0.15,
  };

  return FRONTIER_MODELS
    .filter((candidate) => !context.excludeModels?.includes(candidate.model))
    .map((candidate) => {
      const rows = observations.filter((row) => row.model === candidate.model);
      const successes = rows.filter((row) => row.succeeded);
      const avg = (values: number[], fallback: number) =>
        values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
      const predictedQuality = avg(
        successes.map((row) => row.qualityScore).filter((value): value is number => value != null),
        candidate.qualityPrior,
      );
      const predictedLatencyMs = avg(
        successes.map((row) => row.latencyMs),
        candidate.latencyPrior * 1000,
      );
      const reliability = rows.length ? successes.length / rows.length : 0.9;
      const predictedCostPerSecond = avg(
        successes.map((row) => Number(row.costUsd)).filter((value) => value > 0),
        candidate.costPrior,
      );
      const speedScore = Math.max(0, 100 - predictedLatencyMs / 1500);
      const costScore = Math.max(0, 100 - predictedCostPerSecond * 500);
      const score =
        predictedQuality * weights.quality +
        reliability * 100 * weights.reliability +
        speedScore * weights.speed +
        costScore * weights.cost;
      return {
        provider: candidate.provider,
        model: candidate.model,
        score: Number(score.toFixed(2)),
        reason: rows.length
          ? `Based on ${rows.length} recent matching provider observation${rows.length === 1 ? '' : 's'}`
          : 'Based on conservative model priors until ForgeVid gathers matching evidence',
        evidenceCount: rows.length,
        predictedQuality: Number(predictedQuality.toFixed(1)),
        predictedLatencyMs: Math.round(predictedLatencyMs),
        predictedCostPerSecond: Number(predictedCostPerSecond.toFixed(4)),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(limit, FRONTIER_MODELS.length)));
}
