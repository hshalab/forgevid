import { z } from 'zod';
import { extractJson } from './ai/llm';
import type { Opportunity } from './inventory';

export const growthDecisionSchema = z.object({
  inventoryItemId: z.string().min(1),
  reason: z.string().min(10).max(1000),
  targetAudience: z.string().min(3).max(300),
  languages: z.array(z.enum(['en', 'es'])).min(1).max(2),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']),
  salesAngle: z.string().min(3).max(300),
  templateStrategy: z.string().min(3).max(300),
  voiceStyle: z.string().min(3).max(200),
  callToAction: z.string().min(3).max(200),
  evidenceUsed: z.array(z.string().min(2).max(300)).min(1).max(10),
  testNext: z.string().min(3).max(300),
  confidence: z.enum(['low', 'medium', 'high']),
});

export type GrowthDecision = z.infer<typeof growthDecisionSchema>;

export function buildGrowthDecisionPrompt(opportunity: Opportunity): string {
  return [
    'You are ForgeVid Growth Operator. Make one grounded campaign decision from the supplied inventory evidence.',
    'Never invent product facts, performance, revenue, discounts, audience demographics, or authorization.',
    'Return JSON only with these keys: inventoryItemId, reason, targetAudience, languages, aspectRatio,',
    'salesAngle, templateStrategy, voiceStyle, callToAction, evidenceUsed, testNext, confidence.',
    'languages may contain only "en" and/or "es". aspectRatio must be "16:9", "9:16", or "1:1".',
    `Inventory evidence: ${JSON.stringify(opportunity)}`,
  ].join('\n');
}

export function parseGrowthDecision(raw: string, expectedItemId: string): GrowthDecision {
  const parsed = growthDecisionSchema.parse(JSON.parse(extractJson(raw)));
  if (parsed.inventoryItemId !== expectedItemId) {
    throw new Error('Growth decision referenced an inventory item that was not requested.');
  }
  return parsed;
}
