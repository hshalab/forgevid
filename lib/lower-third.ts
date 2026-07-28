/**
 * Lower thirds — the caption bar an estate agent expects.
 *
 * "14 Maple Court" on one line, "$685,000 · 4 bed · 2 bath" beneath it, held in
 * the lower-left for the opening seconds. Agents will not use a listing video
 * that does not show the price, because the price is the reason anyone watches.
 *
 * Everything here is a PURE string builder over ffmpeg's drawtext, so the filter
 * is verified without rendering. Two rules it must never break:
 *
 *  1. The text is user data. It goes into a filtergraph, so it is escaped
 *     (lib/captions' escapeDrawText) and the colours are hex-validated — a
 *     colon or a quote in "O'Brien Ave" would otherwise rewrite the graph.
 *  2. Never hand this to fluent-ffmpeg's outputOptions(): an array entry with
 *     exactly one space gets torn in half. Pass it to videoFilters()/
 *     complexFilter(), which send it as a single argv entry.
 *
 * Relative imports only — reachable from the worker process.
 */

import { escapeDrawText, escapeFontPath, resolveCaptionFontFile } from './captions';
import { isValidHexColor } from './brand-kit';

export interface LowerThird {
  /** The headline: an address, a product name. */
  title: string;
  /** The facts beneath it, already formatted. Joined with a middot. */
  facts?: string[];
  /** Seconds into the video when it appears. */
  start?: number;
  /** How long it stays on screen. */
  duration?: number;
}

export interface LowerThirdStyle {
  titleSize?: number;
  factsSize?: number;
  /** Distance from the left edge, in pixels. */
  marginLeft?: number;
  /** Distance from the bottom edge, in pixels. */
  marginBottom?: number;
  fontColor?: string;
  /** Accent bar colour down the left of the block. */
  accentColor?: string;
  boxOpacity?: number;
  fontFile?: string | null;
  /**
   * Anchor the block to the TOP of the frame instead of the bottom — use
   * when bottom-anchored karaoke captions would otherwise collide with it
   * (every prospect sample). Distance from the top comes from marginTop.
   */
  anchorTop?: boolean;
  /** Distance from the top edge, px (anchorTop only). */
  marginTop?: number;
}

/** A colour is only allowed through if it is a hex value or a safe name. */
const SAFE_NAMED_COLORS = new Set(['white', 'black', 'gray', 'grey']);

function safeColor(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  if (SAFE_NAMED_COLORS.has(value.toLowerCase())) return value.toLowerCase();
  return isValidHexColor(value) ? value : fallback;
}

/** "$685,000 · 4 bed · 2 bath" from the parts the caller actually has. */
export function formatFacts(facts: Array<string | undefined | null>): string {
  return facts.map((f) => (f ?? '').trim()).filter(Boolean).join('  ·  ');
}

/**
 * Build the drawtext chain for one lower third.
 *
 * Returns '' when there is no font (a bare container ships none) or nothing to
 * say — a missing font must drop the overlay, never kill the render.
 */
export function buildLowerThirdFilter(
  lowerThird: LowerThird,
  style: LowerThirdStyle = {},
): string {
  const title = (lowerThird.title ?? '').trim();
  if (!title) return '';

  const brandFont = style.fontFile ?? null;
  const font = brandFont ?? resolveCaptionFontFile();
  if (!font) return '';
  const fontOpt = `fontfile='${escapeFontPath(font)}':`;

  const titleSize = style.titleSize ?? 46;
  const factsSize = style.factsSize ?? 30;
  const marginLeft = style.marginLeft ?? 70;
  const marginBottom = style.marginBottom ?? 170;
  const fontColor = safeColor(style.fontColor, 'white');
  const accentColor = safeColor(style.accentColor, '#38bdf8');
  const opacity = Math.min(Math.max(style.boxOpacity ?? 0.6, 0), 1);

  const start = Math.max(lowerThird.start ?? 0.6, 0);
  const end = start + Math.max(lowerThird.duration ?? 4.5, 0.5);
  // `enable` is an expression: its commas must be escaped or ffmpeg reads them
  // as filter-option separators.
  const enable = `enable='between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})'`;

  const facts = formatFacts(lowerThird.facts ?? []);
  const filters: string[] = [];

  const box = (size: number) =>
    opacity > 0 ? `box=1:boxcolor=black@${opacity.toFixed(2)}:boxborderw=${Math.round(size * 0.35)}:` : '';

  // y-expressions per anchor. Bottom (default): drawn from the bottom up so
  // the block grows upward, never colliding with captions below it. Top:
  // the title sits at marginTop and the facts below it — used when the
  // bottom is already claimed by karaoke captions.
  const anchorTop = style.anchorTop ?? false;
  let titleYExpr: string;
  let factsYExpr: string;
  let barYExpr: string;
  if (anchorTop) {
    const marginTop = style.marginTop ?? 90;
    titleYExpr = `${marginTop}`;
    factsYExpr = `${marginTop + titleSize + 12}`;
    barYExpr = `${marginTop}`;
  } else {
    const factsY = marginBottom;
    const titleY = marginBottom + (facts ? factsSize + 22 : 0);
    titleYExpr = `h-${titleY + titleSize}`;
    factsYExpr = `h-${factsY + factsSize}`;
    barYExpr = `h-${titleY + titleSize}`;
  }

  // A slim accent bar to the left of the text. drawtext can't draw a rectangle,
  // so it draws a run of full-block glyphs, which every font we ship has.
  const barHeight = titleSize + (facts ? factsSize + 12 : 0);
  filters.push(
    `drawtext=${fontOpt}text='█':fontsize=${Math.round(barHeight * 0.9)}:fontcolor=${accentColor}:` +
      `x=${marginLeft - 26}:y=${barYExpr}:${enable}`,
  );

  filters.push(
    `drawtext=${fontOpt}text='${escapeDrawText(title)}':fontsize=${titleSize}:fontcolor=${fontColor}:` +
      `${box(titleSize)}x=${marginLeft}:y=${titleYExpr}:${enable}`,
  );

  if (facts) {
    filters.push(
      `drawtext=${fontOpt}text='${escapeDrawText(facts)}':fontsize=${factsSize}:fontcolor=${fontColor}:` +
        `${box(factsSize)}x=${marginLeft}:y=${factsYExpr}:${enable}`,
    );
  }

  return filters.join(',');
}

/**
 * Animated opening title — the brand name in big condensed type for the
 * first ~2.5 seconds, the way produced social ads open. Fades in with a
 * slight upward settle, holds, fades out before the second scene.
 *
 * Prefers the bundled Bebas Neue (condensed display face made for exactly
 * this); falls back to the caption font. Same fail-soft contract as the
 * lower third: no font or no text -> '' (dropped overlay, never a dead
 * render). Deliberately NOT combined with a lower third by callers — two
 * title treatments in the opening seconds fight each other.
 */
export function buildOpenerTitleFilter(
  text: string,
  options: { fontFile?: string | null } = {},
): string {
  const title = text.trim().toUpperCase();
  if (!title) return '';
  const bundledBebas = pathJoinPublicFont('BebasNeue-Regular.ttf');
  const font = options.fontFile ?? bundledBebas ?? resolveCaptionFontFile();
  if (!font) return '';
  const fontOpt = `fontfile='${escapeFontPath(font)}':`;
  // Fade in over 0.4s, hold to 2.0s, fade out by 2.5s; settle upward ~2% of
  // frame height as it appears. All timing via t so it survives any fps.
  const alpha = `if(lt(t,0.4),t/0.4,if(lt(t,2.0),1,max(0,(2.5-t)/0.5)))`;
  const y = `(h*0.40)-((h*0.02)*min(t/0.4,1))`;
  return (
    `drawtext=${fontOpt}text='${escapeDrawText(title)}':` +
    `fontsize=h*0.11:fontcolor=white:borderw=3:bordercolor=black@0.45:` +
    `x=(w-text_w)/2:y=${y}:alpha='${alpha}':enable='lt(t,2.5)'`
  );
}

/** The bundled font path when it exists, else null. */
function pathJoinPublicFont(file: string): string | null {
  // Lazy require keeps this module's import surface unchanged.
  const path = require('path') as typeof import('path');
  const fs = require('fs') as typeof import('fs');
  const full = path.join(process.cwd(), 'public', 'fonts', file);
  return fs.existsSync(full) ? full : null;
}
