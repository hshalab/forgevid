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
  variants: z.array(z.object({
    language: z.enum(['en', 'es']),
    hookLabel: z.string().min(2).max(40),
    hookNarration: z.string().min(5).max(300),
    ctaLabel: z.string().min(2).max(40),
    ctaNarration: z.string().min(5).max(300),
  })).min(2).max(6),
}).superRefine((decision, context) => {
  const selectedLanguages = new Set(decision.languages);

  for (const variant of decision.variants) {
    if (!selectedLanguages.has(variant.language)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['variants'],
        message: `Variant language ${variant.language} is not selected`,
      });
    }
  }

  for (const language of decision.languages) {
    const languageVariants = decision.variants.filter((variant) => variant.language === language);
    const distinctHooks = new Set(languageVariants.map((variant) => variant.hookNarration.trim().toLowerCase()));
    if (distinctHooks.size < 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['variants'],
        message: `At least two distinct ${language.toUpperCase()} hooks are required`,
      });
    }
  }
});

export type GrowthDecision = z.infer<typeof growthDecisionSchema>;

export function buildGrowthDecisionPrompt(opportunity: Opportunity): string {
  return [
    'You are ForgeVid Growth Operator. Make one grounded campaign decision from the supplied inventory evidence.',
    'Never invent product facts, performance, revenue, discounts, audience demographics, or authorization.',
    'Return JSON only with these keys: inventoryItemId, reason, targetAudience, languages, aspectRatio,',
    'salesAngle, templateStrategy, voiceStyle, callToAction, evidenceUsed, testNext, confidence, variants.',
    'languages may contain only "en" and/or "es". aspectRatio must be "16:9", "9:16", or "1:1".',
    'variants must contain two distinct hooks for every selected language. Write each hook and CTA naturally in its language.',
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
