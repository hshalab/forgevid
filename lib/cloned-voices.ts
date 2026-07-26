/**
 * Voice cloning via ElevenLabs "instant voice cloning" (POST /v1/voices/add).
 *
 * Real integration, fail-visibly: no key => callers get a 503, never a fake
 * voice id. Cloned voices are stored per user and become valid `voiceId`
 * values for generation. Pro plans only (lib/plan.ts.allowsVoiceCloning).
 *
 * NOTE: the live API call is unverified in this environment (no
 * ELEVENLABS_API_KEY); the request shape follows ElevenLabs' documented
 * multipart contract (fields: name, files[]).
 *
 * Relative imports only — reachable from the worker process.
 */

import { prisma } from './prisma';
import { isKnownVoice, DEFAULT_VOICE_ID } from './voice-catalog';
import { withProviderReliability } from './provider-reliability';

export interface ClonedVoiceInfo {
  id: string;
  providerVoiceId: string;
  name: string;
  cloned: true;
}

export function isVoiceCloningConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

export async function listClonedVoices(userId: string): Promise<ClonedVoiceInfo[]> {
  const rows = await prisma.clonedVoice.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    providerVoiceId: r.providerVoiceId,
    name: r.name,
    cloned: true as const,
  }));
}

/**
 * A requested voiceId is valid if it is a catalog voice OR a cloned voice the
 * user owns. Anything else falls back to the default — never sent upstream.
 */
export async function resolveVoiceIdForUser(
  userId: string,
  requested?: string | null,
): Promise<string> {
  if (!requested) return DEFAULT_VOICE_ID;
  if (isKnownVoice(requested)) return requested;

  try {
    const owned = await prisma.clonedVoice.findFirst({
      where: { userId, providerVoiceId: requested },
      select: { id: true },
    });
    if (owned) return requested;
  } catch (error) {
    console.error('[ClonedVoices] Ownership lookup failed:', error);
  }
  return DEFAULT_VOICE_ID;
}

/**
 * Clone a voice from an audio sample. Returns the stored voice, or throws with
 * an actionable message — it never invents a voice id.
 */
export async function cloneVoiceFromSample(args: {
  userId: string;
  name: string;
  sample: Buffer;
  sampleFilename: string;
  sampleMimeType: string;
}): Promise<ClonedVoiceInfo> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('Voice cloning is unavailable (ELEVENLABS_API_KEY is not configured)');
  }

  const form = new FormData();
  form.append('name', args.name);
  form.append(
    'files',
    new Blob([new Uint8Array(args.sample)], { type: args.sampleMimeType }),
    args.sampleFilename,
  );

  const response = await withProviderReliability('elevenlabs', () => fetch('https://api.elevenlabs.io/v1/voices/add', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  }));

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Voice cloning failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  const data = (await response.json()) as { voice_id?: string };
  if (!data.voice_id) {
    throw new Error('Voice cloning failed: the provider returned no voice id');
  }

  const row = await prisma.clonedVoice.upsert({
    where: {
      userId_providerVoiceId: { userId: args.userId, providerVoiceId: data.voice_id },
    },
    create: { userId: args.userId, providerVoiceId: data.voice_id, name: args.name },
    update: { name: args.name },
  });

  return { id: row.id, providerVoiceId: row.providerVoiceId, name: row.name, cloned: true };
}
