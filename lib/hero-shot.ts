/**
 * AI hero shot — one real gen4.5 clip as the OPENING scene of a
 * stock-assembled video. The rest of the video stays stock (cheap, fast);
 * the first impression becomes generated cinematic footage of exactly what
 * the prompt asked for. gen4.5 at 5s is the cheapest frontier unit
 * ($0.60 measured), priced to the customer at +1 credit — consistent with
 * the Frontier tab's own gen4.5/5s price.
 *
 * Strictly fail-open: any failure (unconfigured key, provider error,
 * timeout, download failure) returns null and the video renders with its
 * stock opening — a missing hero must never break a paid render.
 *
 * Relative imports only — reachable from the worker process.
 */
import fs from 'fs';
import path from 'path';
import {
  createTextToVideo,
  getRunwayTaskStatus,
  isRunwayConfigured,
  type RunwayAspectRatio,
} from './runway-provider';

const HERO_MODEL = 'gen4.5';
export const HERO_DURATION_SECONDS = 5;
const POLL_INTERVAL_MS = 5_000;
const POLL_DEADLINE_MS = 4 * 60 * 1000;

/** Build the generation prompt from the scene's own concrete content. */
export function heroPrompt(searchQuery: string, style?: string): string {
  const styleFlavor: Record<string, string> = {
    cinematic: 'cinematic film look, shallow depth of field',
    energetic: 'dynamic camera movement, vibrant',
    professional: 'clean corporate look, steady camera',
    modern: 'modern minimal aesthetic, smooth motion',
  };
  const flavor = styleFlavor[(style ?? '').toLowerCase()] ?? 'cinematic commercial look';
  return `Professional commercial b-roll of ${searchQuery}, ${flavor}, high production value, no text, no logos`;
}

/**
 * Generate the hero clip and download it to a local temp path the
 * assembler can consume. Returns null on ANY failure.
 */
export async function generateHeroClip(args: {
  searchQuery: string;
  style?: string;
  aspectRatio: RunwayAspectRatio;
}): Promise<{ localPath: string } | null> {
  if (!isRunwayConfigured()) return null;
  try {
    const taskId = await createTextToVideo({
      promptText: heroPrompt(args.searchQuery, args.style),
      model: HERO_MODEL,
      aspectRatio: args.aspectRatio,
      duration: HERO_DURATION_SECONDS,
    });

    const deadline = Date.now() + POLL_DEADLINE_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const status = await getRunwayTaskStatus(taskId);
      if (status.status === 'completed' && status.videoUrl) {
        const response = await fetch(status.videoUrl);
        if (!response.ok) throw new Error(`hero download failed (${response.status})`);
        const dir = path.join(process.cwd(), 'public', 'temp');
        fs.mkdirSync(dir, { recursive: true });
        const localPath = path.join(dir, `hero_${taskId.slice(0, 8)}_${Date.now()}.mp4`);
        fs.writeFileSync(localPath, Buffer.from(await response.arrayBuffer()));
        return { localPath };
      }
      if (status.status === 'failed') {
        throw new Error(status.error ?? 'hero generation failed');
      }
    }
    throw new Error('hero generation timed out');
  } catch (error) {
    console.warn('[HeroShot] falling back to stock opening:', error instanceof Error ? error.message : error);
    return null;
  }
}
