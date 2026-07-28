/**
 * Frontier AI video generation via Runway's API (v1) — one integration that
 * reaches Runway's own Gen models AND the third-party frontier models Runway
 * hosts behind the same account/key. Confirmed LIVE on this account (not
 * guessed): gen4.5/gen3a_turbo (Runway), veo3/veo3.1 (Google), seedance2
 * (ByteDance), kling3.0/klingO3 (Kuaishou). NOTE: the org's model LIST is
 * broader than what /v1/text_to_video accepts — gen4_turbo appears in the
 * org list but is rejected by text_to_video; the curated list in the route
 * uses only endpoint-validated models. Verified end-to-end 2026-07-28 with
 * a real gen4.5 generation (task created, polled to SUCCEEDED, video URL
 * returned, 60 credits spent). This generates NEW video from a text prompt,
 * unlike the stock-footage assembler (lib/video-generator.ts) — real,
 * opt-in, billed per second, never a replacement for the free path.
 *
 * Which specific models ForgeVid chooses to expose in its own UI is a
 * product decision, not a fact about Runway's API — that curated list lives
 * in app/api/videos/runway/generate/route.ts, not here. This module accepts
 * any Runway model string.
 *
 * Contract confirmed against docs.dev.runwayml.com (fetched 2026-07-27):
 * base URL, auth header, version header, and the async task shape (POST
 * creates a task id, GET /v1/tasks/{id} polls it) all came directly from
 * Runway's own docs. The text_to_video request fields follow the officially
 * documented example for Runway's create() calls (model/promptText/ratio/
 * duration/seed) — Runway's own consistent naming across endpoints. Fails
 * visibly: if the real contract differs, the error surfaces to the caller,
 * never faked.
 *
 * Relative imports only — reachable from the worker process.
 */
import { withProviderReliability } from './provider-reliability';

const API_BASE = 'https://api.dev.runwayml.com/v1';
const API_VERSION = '2024-11-06';

// gen4.5's documented range — the one duration bound this integration can
// actually verify. Enforced HERE (not just in the route's zod schema) so a
// future second caller of this module can't slip an uncapped duration
// through to a real, per-second-billed API. Exported so the route's zod
// schema and its GET pre-flight derive from the same numbers instead of
// keeping their own copies.
export const MIN_DURATION_SECONDS = 2;
export const MAX_DURATION_SECONDS = 10;

export function isRunwayConfigured(): boolean {
  return Boolean(process.env.RUNWAY_API_KEY);
}

function apiKey(): string {
  const key = process.env.RUNWAY_API_KEY;
  if (!key) throw new Error('AI video generation is unavailable (RUNWAY_API_KEY is not configured)');
  return key;
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey()}`,
    'X-Runway-Version': API_VERSION,
    ...extra,
  };
}

/** The aspect ratios this integration maps to Runway ratio strings — single source for the route's schema and pre-flight. */
export const RUNWAY_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;
export type RunwayAspectRatio = (typeof RUNWAY_ASPECT_RATIOS)[number];

const RATIO_BY_ASPECT: Record<RunwayAspectRatio, string> = {
  '16:9': '1280:720',
  '9:16': '720:1280',
  '1:1': '960:960',
};

export interface RunwayGenerationArgs {
  promptText: string;
  /** Any Runway model string — which ones ForgeVid exposes is the caller's choice, not this module's. */
  model: string;
  aspectRatio: RunwayAspectRatio;
  /** Seconds, clamped to [2, 10] — see MIN/MAX_DURATION_SECONDS above. */
  duration: number;
  seed?: number;
}

/** The exact request body Runway's text_to_video endpoint expects. Pure and pinned by tests. */
export function buildTextToVideoPayload(args: RunwayGenerationArgs): Record<string, unknown> {
  if (args.duration < MIN_DURATION_SECONDS || args.duration > MAX_DURATION_SECONDS) {
    throw new Error(`Runway duration must be between ${MIN_DURATION_SECONDS} and ${MAX_DURATION_SECONDS} seconds`);
  }
  return {
    model: args.model,
    promptText: args.promptText,
    ratio: RATIO_BY_ASPECT[args.aspectRatio],
    duration: args.duration,
    ...(args.seed !== undefined ? { seed: args.seed } : {}),
  };
}

/** Start a generation. Returns the provider's task id for polling. */
export async function createTextToVideo(args: RunwayGenerationArgs): Promise<string> {
  const response = await withProviderReliability('runway', () => fetch(`${API_BASE}/text_to_video`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(buildTextToVideoPayload(args)),
  }));
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Runway generation failed to start (${response.status}): ${detail.slice(0, 200)}`);
  }
  const data: any = await response.json();
  const id = data?.id;
  if (!id) throw new Error('Runway returned no task id');
  return String(id);
}

export interface RunwayTaskStatus {
  status: 'processing' | 'completed' | 'failed';
  videoUrl: string | null;
  error: string | null;
}

/**
 * Poll a generation task, normalizing Runway's own status vocabulary
 * (SUCCEEDED/FAILED/CANCELED/RUNNING/PENDING) into the same
 * processing/completed/failed shape lib/avatar-provider.ts and
 * lib/video-translate.ts already return — the normalization belongs in the
 * provider client, not in whichever route happens to call it.
 */
export async function getRunwayTaskStatus(taskId: string): Promise<RunwayTaskStatus> {
  const response = await withProviderReliability('runway', () => fetch(
    `${API_BASE}/tasks/${encodeURIComponent(taskId)}`,
    { headers: authHeaders() },
  ));
  if (!response.ok) {
    throw new Error(`Runway task status check failed (${response.status})`);
  }
  const data: any = await response.json();
  const rawStatus = String(data?.status ?? 'PENDING');
  if (rawStatus === 'SUCCEEDED') {
    const output = Array.isArray(data?.output) ? data.output : [];
    return { status: 'completed', videoUrl: output[0] ?? null, error: null };
  }
  if (rawStatus === 'FAILED' || rawStatus === 'CANCELED') {
    return {
      status: 'failed',
      videoUrl: null,
      error: String(data?.failure ?? `Runway generation ${rawStatus.toLowerCase()}`),
    };
  }
  return { status: 'processing', videoUrl: null, error: null };
}
