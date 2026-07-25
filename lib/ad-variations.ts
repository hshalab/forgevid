/**
 * The creative-variation engine — one concept into a matrix of ad variants.
 *
 * Performance marketing in 2026 is a volume game against ad fatigue: cold
 * creative burns out in 10-14 days, the top teams test 20-50 variants a month,
 * and the winning framework is the "3x2x2 matrix" — 3 hooks x 2 lengths x 2 CTAs
 * = 12 variants per concept. The hook (the first ~3 seconds) drives roughly 70%
 * of the performance difference.
 *
 * The one rule that makes this a real A/B test and not just twelve unrelated
 * videos: **change exactly one variable at a time.** The body of every variant
 * is identical (ForgeVid plans it once and reuses it); a hook variant differs
 * only in its opening line, a CTA variant only in its closing line, an aspect
 * variant only in its shape. If the body changed too, you could not attribute a
 * result to the hook.
 *
 * This file is PURE: axes in, a labelled list of variant specs out. It is
 * verified offline; the endpoint plans the body and enqueues the render.
 *
 * Relative imports only — reachable from the worker process.
 */

import type { AspectRatio, NarrationLanguage, PlannedScene } from './video-generator';

/** One value of an axis: a human label plus the copy it swaps in. */
export interface HookOption {
  label: string;
  /** The opening line the viewer hears and reads. */
  narration: string;
  /** Optional footage query so the picture matches the new hook. */
  searchQuery?: string;
}

export interface CtaOption {
  label: string;
  /** The closing line. */
  narration: string;
}

export interface VariationAxes {
  /** Alternative opening lines. The highest-leverage axis. */
  hooks?: HookOption[];
  /** Alternative closing lines. */
  ctas?: CtaOption[];
  /** Placements: 16:9 (YouTube), 9:16 (Reels/TikTok), 1:1 (feed). */
  aspectRatios?: AspectRatio[];
  /** Narration/caption languages. Each language is planned independently. */
  languages?: NarrationLanguage[];
}

/** A single renderable variant: the body, one set of overrides, and a label. */
export interface VariantSpec {
  /** e.g. "hook:urgency · 9:16 · cta:signup" — how you read the A/B result. */
  label: string;
  aspectRatio: AspectRatio;
  language: NarrationLanguage;
  hookNarration?: string;
  hookSearchQuery?: string;
  ctaNarration?: string;
  /** Which value of each axis this variant carries, for reporting. */
  axes: { hook?: string; cta?: string; aspect: AspectRatio; language: NarrationLanguage };
}

/** No sane campaign renders more than this in one request. */
export const MAX_VARIANTS = 24;

export class VariationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VariationError';
  }
}

/**
 * Expand the axes into the full cross-product of variants.
 *
 * An axis with no values contributes a single "keep the base" pass-through, so
 * asking for two hooks and nothing else yields two variants (not zero), each
 * differing only in the hook.
 */
export function expandVariations(axes: VariationAxes): VariantSpec[] {
  const hooks: (HookOption | null)[] = axes.hooks?.length ? axes.hooks : [null];
  const ctas: (CtaOption | null)[] = axes.ctas?.length ? axes.ctas : [null];
  const ratios: AspectRatio[] = axes.aspectRatios?.length ? axes.aspectRatios : ['16:9'];
  const languages: NarrationLanguage[] = axes.languages?.length ? axes.languages : ['en'];

  const total = hooks.length * ctas.length * ratios.length * languages.length;
  if (total === 0) throw new VariationError('No variants to generate');
  if (total > MAX_VARIANTS) {
    throw new VariationError(
      `That matrix is ${total} variants; the limit is ${MAX_VARIANTS}. ` +
        'Trim a hook, a CTA, or a placement.',
    );
  }

  const variants: VariantSpec[] = [];
  for (const language of languages) {
    for (const ratio of ratios) {
      for (const hook of hooks) {
        for (const cta of ctas) {
          const parts: string[] = [];
          if (hook) parts.push(`hook:${hook.label}`);
          parts.push(language.toUpperCase(), ratio);
          if (cta) parts.push(`cta:${cta.label}`);

          variants.push({
            label: parts.join(' · '),
            aspectRatio: ratio,
            language,
            hookNarration: hook?.narration,
            hookSearchQuery: hook?.searchQuery,
            ctaNarration: cta?.narration,
            axes: { hook: hook?.label, cta: cta?.label, aspect: ratio, language },
          });
        }
      }
    }
  }
  return variants;
}

/**
 * Sanity-check that a pre-planned body can carry the requested overrides.
 *
 * A hook override needs a first scene; a CTA override needs a last scene. A
 * one-scene plan cannot hold both a distinct hook and a distinct CTA — they
 * would fight over the same scene — so that combination is refused up front
 * rather than producing a confusing render.
 */
export function assertBodySupportsAxes(scenes: PlannedScene[], axes: VariationAxes): void {
  if (scenes.length === 0) throw new VariationError('The concept produced no scenes');
  const varyingHook = (axes.hooks?.length ?? 0) > 0;
  const varyingCta = (axes.ctas?.length ?? 0) > 0;
  if (varyingHook && varyingCta && scenes.length < 2) {
    throw new VariationError(
      'Testing both a hook and a CTA needs at least two scenes; this concept has one. ' +
        'Use a longer duration, or test one axis at a time.',
    );
  }
}
