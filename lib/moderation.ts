/**
 * Content moderation gate — blocks prohibited content BEFORE a render.
 *
 * The Acceptable Use Policy bars this content contractually; this enforces it in
 * software. Text (prompts, feed narration) and images (uploaded / feed photos)
 * run through OpenAI's omni-moderation model, which scores both. The image path
 * is the important one: it plugs the mediaOnly bypass where a user's own photos
 * never otherwise reach any AI provider.
 *
 * Thresholds use category SCORES, not just the model's booleans, so:
 *  - sexual/minors (the CSAM signal) blocks at a very low score — no tolerance;
 *  - ordinary sexual content blocks only when explicit, so legitimate swimwear /
 *    lingerie / underwear product ads (e-commerce) are not false-flagged.
 *
 * Failure policy: TEXT fails OPEN on a moderation-service error (an outage must
 * not take down all generation) but logs; IMAGES fail CLOSED (block) because the
 * CSAM risk outweighs availability. Override images with MODERATION_IMAGES_FAIL_OPEN=true.
 */
import { hasOpenAiKey, openAiApiKey } from './openai-key';
import { prisma } from './prisma';
import { withProviderReliability } from './provider-reliability';

const MODEL = 'omni-moderation-latest';

/** Block when a category's score meets/exceeds its threshold. */
const THRESHOLDS: Record<string, number> = {
  'sexual/minors': 0.2, // CSAM — extremely sensitive, effectively zero tolerance
  sexual: 0.85, // explicit only; allow swimwear/lingerie product ads
  'violence/graphic': 0.85,
};

export interface ModerationResult {
  allowed: boolean;
  categories: string[]; // which categories tripped
  reason?: string;
}
const OK: ModerationResult = { allowed: true, categories: [] };

async function client() {
  const { OpenAI } = await import('openai');
  return new OpenAI({ apiKey: openAiApiKey() });
}

function blocked(result: unknown): string[] {
  const scores = (result as { category_scores?: Record<string, number> } | undefined)?.category_scores ?? {};
  return Object.entries(THRESHOLDS)
    .filter(([cat, thr]) => Number(scores[cat] ?? 0) >= thr)
    .map(([cat]) => cat);
}

/** Moderate free text (a prompt or feed narration). Fails OPEN on error. */
export async function moderateText(text: string): Promise<ModerationResult> {
  const trimmed = (text || '').trim();
  if (!trimmed || !hasOpenAiKey()) return OK;
  try {
    const openai = await client();
    const res = await withProviderReliability('openai', () =>
      openai.moderations.create({ model: MODEL, input: trimmed.slice(0, 8000) }));
    const hits = blocked(res.results?.[0]);
    if (hits.length === 0) return OK;
    console.warn('[Moderation] text blocked:', hits.join(', '));
    return { allowed: false, categories: hits, reason: 'This request was blocked by our content policy.' };
  } catch (error) {
    console.error('[Moderation] text check failed (allowing):', error);
    return OK; // fail-open for text availability
  }
}

/** Moderate one image by URL (http(s) or data:). Fails CLOSED on error. */
export async function moderateImageUrl(url: string): Promise<ModerationResult> {
  const failOpen = process.env.MODERATION_IMAGES_FAIL_OPEN === 'true';
  if (!hasOpenAiKey()) {
    return failOpen ? OK : { allowed: false, categories: [], reason: 'Image could not be verified.' };
  }
  try {
    const openai = await client();
    const res = await withProviderReliability('openai', () => openai.moderations.create({
      model: MODEL,
      input: [{ type: 'image_url', image_url: { url } }],
    } as never));
    const hits = blocked(res.results?.[0]);
    if (hits.length === 0) return OK;
    console.warn('[Moderation] image blocked:', hits.join(', '));
    return { allowed: false, categories: hits, reason: 'An image was blocked by our content policy.' };
  } catch (error) {
    console.error('[Moderation] image check failed:', error);
    return failOpen ? OK : { allowed: false, categories: [], reason: 'Image could not be verified.' };
  }
}

/**
 * Audit trail: record a blocked attempt so abuse is visible for review even
 * though no video is created. Fire-and-forget — never fail the request over it.
 */
export async function recordModerationBlock(
  kind: 'prompt' | 'image',
  categories: string[],
  videoId?: string,
): Promise<void> {
  try {
    await prisma.contentReport.create({
      data: {
        videoId,
        reason: `auto-moderation: ${kind} blocked`,
        categories: categories.join(',') || null,
        source: 'auto_moderation',
        status: 'open',
      },
    });
  } catch (error) {
    console.error('[Moderation] failed to record block:', error);
  }
}
