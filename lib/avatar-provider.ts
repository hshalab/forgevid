/**
 * AI avatar videos via HeyGen (v2 API).
 *
 * Real integration, fail-visibly: no HEYGEN_API_KEY => callers get a 503 and
 * nothing is faked. Pro plans only (lib/plan.ts.allowsAvatars).
 *
 * NOTE: the live API calls are unverified in this environment (no key). The
 * request/response shapes follow HeyGen's documented v2 contract
 * (POST /v2/video/generate, GET /v1/video_status.get). If the provider drifts,
 * the error surfaces to the caller — it is never swallowed.
 *
 * Relative imports only — reachable from the worker process.
 */

import type { AspectRatio } from './video-generator';
import { withProviderReliability } from './provider-reliability';

const API_BASE = 'https://api.heygen.com';

export function isAvatarProviderConfigured(): boolean {
  return Boolean(process.env.HEYGEN_API_KEY);
}

function apiKey(): string {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) throw new Error('Avatar generation is unavailable (HEYGEN_API_KEY is not configured)');
  return key;
}

export interface AvatarInfo {
  avatarId: string;
  name: string;
  previewImageUrl: string | null;
}

/** Pixel dimensions HeyGen should render at, per our aspect presets (1080p tier). */
export function avatarDimension(aspectRatio: AspectRatio): { width: number; height: number } {
  switch (aspectRatio) {
    case '9:16':
      return { width: 720, height: 1280 };
    case '1:1':
      return { width: 1080, height: 1080 };
    case '16:9':
    default:
      return { width: 1280, height: 720 };
  }
}

/**
 * The v2 video-generate payload. Pure and exported so the contract we THINK
 * we're speaking is pinned by tests even though the live call can't run here.
 */
export function buildAvatarVideoPayload(args: {
  script: string;
  avatarId: string;
  aspectRatio: AspectRatio;
  voiceId?: string | null;
}): Record<string, unknown> {
  const { width, height } = avatarDimension(args.aspectRatio);
  return {
    video_inputs: [
      {
        character: { type: 'avatar', avatar_id: args.avatarId, avatar_style: 'normal' },
        voice: args.voiceId
          ? { type: 'text', input_text: args.script, voice_id: args.voiceId }
          : { type: 'text', input_text: args.script },
      },
    ],
    dimension: { width, height },
  };
}

/** List the account's available avatars. */
export async function listAvatars(): Promise<AvatarInfo[]> {
  const response = await withProviderReliability('heygen', () => fetch(`${API_BASE}/v2/avatars`, {
    headers: { 'X-Api-Key': apiKey(), Accept: 'application/json' },
  }));
  if (!response.ok) {
    throw new Error(`Avatar list failed (${response.status})`);
  }
  const data: any = await response.json();
  const avatars = data?.data?.avatars ?? [];
  return avatars
    .map((a: any) => ({
      avatarId: String(a.avatar_id ?? ''),
      name: String(a.avatar_name ?? a.avatar_id ?? 'Avatar'),
      previewImageUrl: a.preview_image_url ?? null,
    }))
    .filter((a: AvatarInfo) => a.avatarId);
}

/** Start an avatar render. Returns the provider's video id for polling. */
export async function createAvatarVideo(args: {
  script: string;
  avatarId: string;
  aspectRatio: AspectRatio;
  voiceId?: string | null;
}): Promise<string> {
  const response = await withProviderReliability('heygen', () => fetch(`${API_BASE}/v2/video/generate`, {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(buildAvatarVideoPayload(args)),
  }));
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Avatar render failed to start (${response.status}): ${detail.slice(0, 200)}`);
  }
  const data: any = await response.json();
  const videoId = data?.data?.video_id;
  if (!videoId) throw new Error('Avatar provider returned no video id');
  return String(videoId);
}

export interface AvatarVideoStatus {
  status: 'processing' | 'completed' | 'failed';
  videoUrl: string | null;
  error: string | null;
}

/** Poll a render. Terminal states: completed (with url) or failed (with reason). */
export async function getAvatarVideoStatus(providerVideoId: string): Promise<AvatarVideoStatus> {
  const response = await withProviderReliability('heygen', () => fetch(
    `${API_BASE}/v1/video_status.get?video_id=${encodeURIComponent(providerVideoId)}`,
    { headers: { 'X-Api-Key': apiKey(), Accept: 'application/json' } },
  ));
  if (!response.ok) {
    throw new Error(`Avatar status check failed (${response.status})`);
  }
  const data: any = await response.json();
  const status = String(data?.data?.status ?? 'processing');
  if (status === 'completed') {
    return { status: 'completed', videoUrl: data?.data?.video_url ?? null, error: null };
  }
  if (status === 'failed') {
    return {
      status: 'failed',
      videoUrl: null,
      error: String(data?.data?.error?.message ?? 'Avatar render failed'),
    };
  }
  return { status: 'processing', videoUrl: null, error: null };
}
