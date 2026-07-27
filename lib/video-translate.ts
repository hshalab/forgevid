/**
 * Full video dub/translation via HeyGen's Video Translate API (v3) — voice
 * cloning AND lip-sync on an EXISTING rendered video, not just a fresh
 * avatar script. Same HEYGEN_API_KEY / account as lib/avatar-provider.ts
 * (HeyGen's pay-as-you-go API credits cover both), confirmed live via
 * developers.heygen.com/reference/create-video-translation and
 * .../reference/get-video-translation (fetched 2026-07-27) — request/response
 * shapes below are copied from that reference, not guessed.
 *
 * This is the premium alternative to lib/localize.ts: that one re-synthesizes
 * narration over the SAME stock footage (free beyond existing OpenAI/
 * ElevenLabs cost, no lip-sync since b-roll has no face to sync); this one
 * actually dubs the finished video with a synced mouth, which only matters —
 * and is only worth ~$2/minute of HeyGen billing — for an avatar-presenter
 * video where a face is talking on screen.
 *
 * Real integration, fail-visibly: no HEYGEN_API_KEY => callers get a clear
 * error and nothing is faked. The live API calls themselves are unverified in
 * this environment (no key) — if the provider drifts, the error surfaces to
 * the caller, exactly like avatar-provider.ts.
 *
 * Relative imports only — reachable from the worker process.
 */
import { withProviderReliability } from './provider-reliability';

const API_BASE = 'https://api.heygen.com';

export function isVideoTranslateConfigured(): boolean {
  return Boolean(process.env.HEYGEN_API_KEY);
}

function apiKey(): string {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) throw new Error('Video dubbing is unavailable (HEYGEN_API_KEY is not configured)');
  return key;
}

export type VideoTranslateMode = 'speed' | 'precision';

/**
 * The v3 create-translation payload. Pure and exported so the contract is
 * pinned by tests even though the live call can't run here. `outputLanguages`
 * are language NAMES ("Spanish"), not ISO codes — HeyGen's own field name and
 * the reference doc doesn't enumerate a fixed accepted list.
 */
export function buildVideoTranslationPayload(args: {
  videoUrl: string;
  outputLanguages: string[];
  mode?: VideoTranslateMode;
  callbackUrl?: string;
}): Record<string, unknown> {
  return {
    video: { type: 'url', url: args.videoUrl },
    output_languages: args.outputLanguages,
    mode: args.mode ?? 'speed',
    ...(args.callbackUrl ? { callback_url: args.callbackUrl } : {}),
  };
}

/** Start a dub job. Returns one video_translation_id per requested language, in order. */
export async function createVideoTranslation(args: {
  videoUrl: string;
  outputLanguages: string[];
  mode?: VideoTranslateMode;
}): Promise<string[]> {
  const response = await withProviderReliability('heygen', () => fetch(`${API_BASE}/v3/video-translations`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(buildVideoTranslationPayload(args)),
  }));
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Video dub failed to start (${response.status}): ${detail.slice(0, 200)}`);
  }
  const data: any = await response.json();
  const ids = data?.data?.video_translation_ids;
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('Video dub provider returned no job id');
  return ids.map(String);
}

export interface VideoTranslationStatus {
  status: 'pending' | 'running' | 'completed' | 'failed';
  videoUrl: string | null;
  error: string | null;
  /**
   * The DUBBED output's actual duration, straight from HeyGen — not the
   * source video's. Translated speech routinely runs longer or shorter than
   * the source (per-language pacing, speed vs precision mode), so this is
   * what billing/quota for the finished job must use, not the pre-flight
   * estimate. Null until the job completes.
   */
  durationSeconds: number | null;
}

/** Poll a dub job. Terminal states: completed (with url) or failed (with reason). */
export async function getVideoTranslationStatus(videoTranslationId: string): Promise<VideoTranslationStatus> {
  const response = await withProviderReliability('heygen', () => fetch(
    `${API_BASE}/v3/video-translations/${encodeURIComponent(videoTranslationId)}`,
    { headers: { 'x-api-key': apiKey(), Accept: 'application/json' } },
  ));
  if (!response.ok) {
    throw new Error(`Video dub status check failed (${response.status})`);
  }
  const data: any = await response.json();
  const status = String(data?.data?.status ?? 'pending');
  if (status === 'completed') {
    const duration = Number(data?.data?.duration);
    return {
      status: 'completed',
      videoUrl: data?.data?.video_url ?? null,
      error: null,
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
    };
  }
  if (status === 'failed') {
    return {
      status: 'failed',
      videoUrl: null,
      error: String(data?.data?.failure_message ?? 'Video dub failed'),
      durationSeconds: null,
    };
  }
  return {
    status: status === 'running' ? 'running' : 'pending',
    videoUrl: null,
    error: null,
    durationSeconds: null,
  };
}
