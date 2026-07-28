/**
 * AI visual reviewer — the vision half of the quality gate. The technical
 * gate (lib/quality-gate.ts) catches what ffprobe can measure: black or
 * frozen frames, silent audio, wrong duration. This reviews what only
 * EYES can: rendering artifacts, incoherent composition, unreadable
 * caption text, identity drift between scenes (a different car in scene 3
 * than scene 1).
 *
 * Runs on up to 3 sampled per-scene poster frames through the configured
 * multimodal LLM (Gemini flash / gpt-4o-mini — both accept image parts on
 * the OpenAI-compatible API this codebase already uses). Strictly
 * ADVISORY-first: scores are always recorded in the evaluation, but only
 * an explicit `critical: true` verdict joins the human-review hold, and
 * every failure mode (no key, no thumbnails, API error, unparseable
 * reply) degrades to null — a render must never fail because its reviewer
 * did. Kill switch: VISUAL_REVIEW=off.
 *
 * Relative imports only — reachable from the worker process.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { llm, llmModel, hasLlmKey } from './ai/llm';
import type { ResolvedScene } from './video-generator';

export interface VisualReview {
  artifactScore: number;
  compositionScore: number;
  textLegibilityScore: number;
  identityConsistencyScore: number;
  issues: string[];
  critical: boolean;
  framesReviewed: number;
}

const clamp = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 50;
};

/** Pure and pinned by tests: turn the model's raw reply into a validated review. */
export function parseVisualReview(raw: string, framesReviewed: number): VisualReview | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      artifactScore: clamp(parsed.artifactScore),
      compositionScore: clamp(parsed.compositionScore),
      textLegibilityScore: clamp(parsed.textLegibilityScore),
      identityConsistencyScore: clamp(parsed.identityConsistencyScore),
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.filter((issue: unknown) => typeof issue === 'string').map((issue: string) => issue.slice(0, 300)).slice(0, 10)
        : [],
      critical: parsed.critical === true,
      framesReviewed,
    };
  } catch {
    return null;
  }
}

/** A local /generated path or a remote (our own Cloudinary) URL → data URL. */
async function frameToDataUrl(source: string): Promise<string | null> {
  try {
    if (source.startsWith('http://') || source.startsWith('https://')) {
      const response = await fetch(source);
      if (!response.ok) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 4 * 1024 * 1024) return null;
      const type = response.headers.get('content-type') ?? 'image/jpeg';
      return `data:${type};base64,${bytes.toString('base64')}`;
    }
    // Local paths are served from public/ (e.g. /generated/thumbs/x.jpg).
    // Containment check: thumbnailUrl is only ever written server-side, but
    // it round-trips through video metadata — never let a ../ escape public/
    // and ship arbitrary file bytes to an LLM provider.
    const publicRoot = path.resolve(process.cwd(), 'public');
    const localPath = path.resolve(publicRoot, source.replace(/^\//, ''));
    if (!localPath.startsWith(publicRoot + path.sep)) return null;
    const bytes = await fs.readFile(localPath);
    if (bytes.length > 4 * 1024 * 1024) return null;
    return `data:image/jpeg;base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Review up to 3 sampled scene poster frames (first / middle / last scene
 * with a thumbnail). Returns null whenever a real review can't happen.
 */
export async function reviewSceneFrames(
  scenes: ResolvedScene[],
  context: { prompt: string; vertical?: string },
): Promise<VisualReview | null> {
  if (process.env.VISUAL_REVIEW === 'off') return null;
  if (!hasLlmKey()) return null;

  const withThumbs = scenes.filter((scene) => scene.thumbnailUrl);
  if (withThumbs.length === 0) return null;
  const sampled =
    withThumbs.length <= 3
      ? withThumbs
      : [withThumbs[0], withThumbs[Math.floor(withThumbs.length / 2)], withThumbs[withThumbs.length - 1]];

  const dataUrls = (await Promise.all(sampled.map((scene) => frameToDataUrl(scene.thumbnailUrl!)))).filter(
    (url): url is string => Boolean(url),
  );
  if (dataUrls.length === 0) return null;

  try {
    const response = await llm.chat.completions.create({
      model: llmModel(),
      messages: [
        {
          role: 'system',
          content:
            'You are a strict but honest video-frame reviewer for a commercial video platform. ' +
            'Score ONLY what you can actually see — never invent problems. Reply with ONLY a JSON object: ' +
            '{"artifactScore": 0-100 (100 = no rendering artifacts/glitches), ' +
            '"compositionScore": 0-100 (framing, subject placement), ' +
            '"textLegibilityScore": 0-100 (any visible caption/overlay text readable; 100 if no text visible), ' +
            '"identityConsistencyScore": 0-100 (frames plausibly show the same subject/product/property; 100 if only one frame), ' +
            '"issues": [up to 5 short concrete strings], ' +
            '"critical": true ONLY for severe defects a customer would reject outright (major artifacts, broken/garbled frames, unreadable burned-in text).}',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `These are ${dataUrls.length} sampled frames from a video generated for: "${context.prompt.slice(0, 300)}"${context.vertical ? ` (style: ${context.vertical})` : ''}. Review them.`,
            },
            ...dataUrls.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
          ],
        },
      ],
      max_tokens: 400,
      temperature: 0,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? '';
    return parseVisualReview(raw, dataUrls.length);
  } catch (error) {
    console.warn('[VisualReview] frame review failed (skipping):', error);
    return null;
  }
}
