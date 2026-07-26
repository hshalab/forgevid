/**
 * The shared "render one video per feed item" loop.
 *
 * Real estate, automotive, and e-commerce all do exactly the same thing per
 * item: check quota, pull the item's photos through the SSRF guard into
 * ownership-checked MediaAssets, then start a `mediaOnly` generation with a
 * burned-in lower third. Only the prompt and the lower third differ, so those
 * are the two things a caller supplies; everything else lives here, once.
 *
 * A failing item is reported by its reference and never takes the batch down.
 *
 * Relative imports only — reachable from route handlers (server components).
 */

import { prisma } from './prisma';
import { enqueueGeneration } from './video-queue';
import { runGeneration } from './generation-pipeline';
import { withRenderSlot } from './render-semaphore';
import { checkGenerationQuota, settleGenerationEntitlement } from './quota';
import { moderateText, recordModerationBlock } from './moderation';
import { importSiteImages } from './site-images';
import { DEFAULT_TRANSITION } from './transitions';
import { recordInventorySnapshot, type Vertical } from './inventory';
import type { AspectRatio, NarrationLanguage } from './video-generator';
import type { LowerThird } from './lower-third';

export interface FeedItem {
  /** The caller's own id for this item, echoed back in the result. */
  ref: string;
  /** A human name for logs and errors ("14 Maple Court", "2022 RAV4"). */
  label: string;
  /** Photo URLs, in order. */
  photos: string[];
  /** Raw price text as the feed gave it, for inventory tracking — never parsed to a number. */
  priceText?: string | null;
  /** Facts-only prompt built from `photoCount` real images. */
  buildPrompt: (photoCount: number) => string;
  /**
   * The raw user-supplied free text for this item (title + highlights/
   * description), moderated on its own. Moderating this instead of the assembled
   * prompt keeps the signal concentrated — a dealership template around one
   * explicit sentence would otherwise dilute the score below threshold.
   */
  moderationText?: string;
  /** The address/price/spec bar for the opening seconds. */
  lowerThird: (photoCount: number) => LowerThird;
}

export interface FeedBatchOptions {
  userId: string;
  duration: number;
  aspectRatio: AspectRatio;
  voiceId: string;
  /** Narration + caption language for every item ('es' = Spanish). */
  language?: NarrationLanguage;
  renderQuality: 'draft' | 'full' | '4k';
  /** Caption look; 'karaoke' = word-by-word highlight (Reels/TikTok style). */
  captionPreset?: import('./captions').CaptionPresetName;
  addOns?: string[];
  maxPhotosPerItem?: number;
  /**
   * Vertical for cross-request inventory tracking (price changes, days in
   * inventory, "no recent video"). Omit to skip tracking entirely — existing
   * callers keep working unchanged.
   */
  vertical?: Vertical;
  /** Persisted rights provenance supplied only after the route's confirmation gate. */
  authorizationBasis?: string;
  sourceUrl?: string | null;
}

export interface FeedBatchResult {
  ref: string;
  label: string;
  videoId?: string;
  photosUsed?: number;
  error?: string;
}

export async function runFeedBatch(
  items: FeedItem[],
  opts: FeedBatchOptions,
): Promise<{ started: number; failed: number; results: FeedBatchResult[] }> {
  const maxPhotos = opts.maxPhotosPerItem ?? 12;
  const results: FeedBatchResult[] = [];

  for (const item of items) {
    const result: FeedBatchResult = { ref: item.ref, label: item.label };
    if (opts.authorizationBasis) {
      const authorizationBasis = opts.authorizationBasis;
      await Promise.all(item.photos.map((assetUrl) => prisma.inventoryAssetAuthorization.upsert({
        where: { userId_assetUrl: { userId: opts.userId, assetUrl } },
        update: {
          sourceUrl: opts.sourceUrl ?? null,
          authorizationBasis,
          authorizedBy: 'account owner confirmation',
          revokedAt: null,
        },
        create: {
          userId: opts.userId,
          assetUrl,
          sourceUrl: opts.sourceUrl ?? null,
          authorizationBasis,
          authorizedBy: 'account owner confirmation',
        },
      }))).catch((error) => {
        console.error(`[feed-batch] asset authorization failed for ${item.ref}:`, error);
      });
    }

    // Cross-request inventory tracking (price changes, days in inventory, "no
    // recent video") is best-effort: a tracking hiccup must never break the
    // actual render this caller is paying for.
    const snapshotIfTracked = async (photoCount: number, videoId?: string) => {
      if (!opts.vertical) return;
      try {
        await recordInventorySnapshot({
          userId: opts.userId,
          vertical: opts.vertical,
          externalRef: item.ref,
          label: item.label,
          priceText: item.priceText,
          photoCount,
          videoId,
        });
      } catch (err) {
        console.error(`[feed-batch] inventory snapshot failed for ${item.ref}:`, err);
      }
    };

    // Quota per item: a 25-item batch must not let a user render 25 videos on a
    // plan that allows five. Purchased credits (1 each) pick up the remaining
    // items once the monthly allowance runs out mid-batch.
    const quota = await checkGenerationQuota(opts.userId, opts.duration, 1);
    if (!quota.allowed) {
      result.error = quota.reason ?? 'Quota exceeded';
      results.push(result);
      await snapshotIfTracked(0);
      continue;
    }

    // Photos are feed-supplied URLs, so they go through the SSRF guard and land
    // as MediaAssets this user owns. Order is preserved.
    const images = await importSiteImages(opts.userId, item.photos, maxPhotos);
    if (images.length === 0) {
      result.error = 'None of the photos could be fetched';
      results.push(result);
      await snapshotIfTracked(0);
      continue;
    }

    const input = {
      prompt: item.buildPrompt(images.length),
      style: 'professional',
      duration: opts.duration,
      addOns: opts.addOns ?? ['voiceover', 'subtitles', 'music'],
      aspectRatio: opts.aspectRatio,
      voiceId: opts.voiceId,
      language: opts.language,
      transition: DEFAULT_TRANSITION,
      mediaAssetIds: images.map((i) => i.assetId),
      // The video shows THIS item. Never pad it with stock footage.
      mediaOnly: true,
      renderQuality: opts.renderQuality,
      captionPreset: opts.captionPreset,
      lowerThird: item.lowerThird(images.length),
    };

    // Content policy: block prohibited feed text before rendering it. Moderate
    // the raw item text (concentrated), falling back to the assembled prompt.
    const promptModeration = await moderateText(item.moderationText || input.prompt);
    if (!promptModeration.allowed) {
      void recordModerationBlock('prompt', promptModeration.categories);
      result.error = promptModeration.reason ?? 'Blocked by our content policy';
      results.push(result);
      await snapshotIfTracked(images.length);
      continue;
    }

    try {
      const video = await prisma.video.create({
        data: {
          title: item.label.slice(0, 80),
          description: `Feed item ${item.ref}`,
          status: 'QUEUED',
          duration: opts.duration,
          format: 'mp4',
          userId: opts.userId,
          metadata: JSON.stringify({
            generation: { stage: 'queued', percent: 5, updatedAt: new Date().toISOString() },
            // Paid-credit videos get the watermark removed (lib/generation-pipeline.ts
            // brandingForVideo) — set server-side ONLY, from the quota verdict.
            ...(quota.usePurchasedCredit ? { paidCredit: true } : {}),
            request: input,
            item: { ref: item.ref, label: item.label },
          }),
        },
        select: { id: true },
      });

      await settleGenerationEntitlement(opts.userId, video.id, opts.duration, quota);

      const jobId = await enqueueGeneration({ videoId: video.id, userId: opts.userId, input });
      if (!jobId) {
        void withRenderSlot(() => runGeneration(video.id, input)).catch((err) =>
          console.error(`[feed-batch] ${item.ref} failed:`, err instanceof Error ? err.message : err),
        );
      }
      result.videoId = video.id;
      result.photosUsed = images.length;
    } catch (error) {
      console.error(`[feed-batch] ${item.ref} could not start:`, error);
      result.error = 'Could not start the generation';
    }

    results.push(result);
    await snapshotIfTracked(images.length, result.videoId);
  }

  const started = results.filter((r) => r.videoId).length;
  return { started, failed: results.length - started, results };
}
