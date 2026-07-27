/**
 * Pronunciation respelling — corrects words the TTS voice reliably gets wrong,
 * by substituting a phonetically-friendlier spelling before synthesis.
 *
 * Complements lib/captions.ts's snapBrand() fuzzy matching: that fixes what
 * Whisper mis-HEARS on the way OUT of a render; this fixes what ElevenLabs
 * mis-SAYS on the way IN. Deliberately NOT applied to caption/cue text — a
 * caption should still show "ForgeVid", not the TTS-friendly "Forge Vid".
 *
 * Relative imports only — reachable from the worker process.
 */

export interface PronunciationEntry {
  /** The word/phrase as written. Matched whole-word, case-insensitive. */
  spelled: string;
  /** What to feed the TTS instead, so it comes out sounding right. */
  saysAs: string;
}

// This platform's own brand names, spoken in narration whenever a script
// names itself or cross-promotes the other two (see marketing-batch.ts's
// BRAND_FOOTERS) — a generic TTS voice tends to run these together as one
// mis-stressed word.
const BRAND_ENTRIES: PronunciationEntry[] = [
  { spelled: 'ForgeVid', saysAs: 'Forge Vid' },
  { spelled: 'RingYield', saysAs: 'Ring Yield' },
  { spelled: 'NeuroHires', saysAs: 'Neuro Hires' },
];

// A handful of vehicle makes with well-known, widely-cited TTS mispronunciations.
// Deliberately small: only names with an established, unambiguous fix, not a
// claim to cover every make.
const AUTO_ENTRIES: PronunciationEntry[] = [
  { spelled: 'Hyundai', saysAs: 'Hyun-day' },
  { spelled: 'Porsche', saysAs: 'Por-shuh' },
];

const DEFAULT_ENTRIES = [...BRAND_ENTRIES, ...AUTO_ENTRIES];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply a pronunciation dictionary to text. Longest entry first, so a
 * multi-word entry is never shadowed by a shorter one nested inside it.
 */
export function applyPronunciation(text: string, extra: PronunciationEntry[] = []): string {
  if (!text) return text;
  const entries = [...DEFAULT_ENTRIES, ...extra].sort((a, b) => b.spelled.length - a.spelled.length);
  let out = text;
  for (const entry of entries) {
    out = out.replace(new RegExp(`\\b${escapeRegex(entry.spelled)}\\b`, 'gi'), entry.saysAs);
  }
  return out;
}
