/**
 * Generate REAL music beds with ElevenLabs sound-generation, replacing the
 * sine-tone placeholders from make-music-beds.ts. Original generated audio:
 * ElevenLabs' paid-plan terms grant commercial use of generated output, so
 * provenance is clean — and measured live (2026-07-28), sound-generation
 * bills ZERO TTS characters on the Creator tier, so this never competes
 * with the growth machine's narration quota.
 *
 * Each bed is ~21s (the endpoint's practical cap), prompted as a seamless
 * loop — the assembler already loops music with -stream_loop -1 — then
 * loudness-normalized to ~-20 LUFS, which lib/video-generator.ts's mixing
 * chain assumes ("music arrives already normalised to about -20 LUFS").
 *
 *   npx tsx scripts/make-eleven-beds.ts        # writes public/music/*.mp3 + tracks.json
 *
 * Idempotent: re-running regenerates every bed (new takes) — listen before
 * committing; keep the takes you like.
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const BEDS = [
  {
    id: 'calm-bed',
    title: 'Still Waters (ElevenLabs)',
    moods: ['calm', 'professional', 'modern', 'corporate', 'sad'],
    prompt:
      'Soft minimal corporate background music, warm piano and gentle synth pads, slow tempo, calm and trustworthy, seamless loop, instrumental, no vocals, no melody spikes',
  },
  {
    id: 'uplift-bed',
    title: 'Open Road (ElevenLabs)',
    moods: ['happy', 'energetic', 'uplifting', 'bright'],
    prompt:
      'Upbeat modern advertising background music, driving light percussion, bright plucks and claps, optimistic and energetic, seamless loop, instrumental, no vocals',
  },
  {
    id: 'cinematic-bed',
    title: 'Skyline (ElevenLabs)',
    moods: ['cinematic', 'dramatic', 'premium', 'epic'],
    prompt:
      'Cinematic ambient background bed, deep warm strings and airy pads, slowly building, premium and expansive film trailer feel, seamless loop, instrumental, no vocals, no percussion hits',
  },
  {
    id: 'luxury-bed',
    title: 'Estate (ElevenLabs)',
    moods: ['luxury', 'elegant', 'sophisticated', 'real-estate'],
    prompt:
      'Elegant solo piano background music with soft room ambience, sophisticated and understated luxury real estate feel, slow and spacious, seamless loop, instrumental, no vocals',
  },
];

async function generateBed(prompt: string): Promise<Buffer> {
  const response = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY ?? '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: prompt, duration_seconds: 21, prompt_influence: 0.3 }),
  });
  if (!response.ok) {
    throw new Error(`sound-generation failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function loudnorm(inputPath: string, outputPath: string) {
  // Same resolution order the renderer uses; loudnorm to the -20 LUFS the
  // mixing chain assumes, with a true-peak ceiling so loops never clip.
  const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static') || 'ffmpeg';
  const result = spawnSync(
    ffmpeg,
    ['-y', '-i', inputPath, '-af', 'loudnorm=I=-20:TP=-1.5:LRA=7', '-ar', '44100', '-b:a', '160k', outputPath],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`loudnorm failed: ${(result.stderr ?? '').slice(-300)}`);
  }
}

async function main() {
  if (!process.env.ELEVENLABS_API_KEY) {
    console.error('ELEVENLABS_API_KEY is not set');
    process.exit(1);
  }
  const musicDir = path.join(process.cwd(), 'public', 'music');
  const tracks: Array<Record<string, unknown>> = [];

  for (const bed of BEDS) {
    console.log(`[beds] generating ${bed.id}…`);
    const raw = await generateBed(bed.prompt);
    const rawPath = path.join(musicDir, `${bed.id}.raw.mp3`);
    const outPath = path.join(musicDir, `${bed.id}.mp3`);
    fs.writeFileSync(rawPath, raw);
    loudnorm(rawPath, outPath);
    fs.unlinkSync(rawPath);
    console.log(`  ${bed.id}.mp3: ${fs.statSync(outPath).size} bytes, normalized to -20 LUFS`);
    tracks.push({
      id: bed.id,
      title: bed.title,
      moods: bed.moods,
      file: `${bed.id}.mp3`,
      license:
        'Original audio generated with ElevenLabs sound-generation (paid plan, commercial license) by scripts/make-eleven-beds.ts.',
    });
  }

  fs.writeFileSync(path.join(musicDir, 'tracks.json'), JSON.stringify(tracks, null, 2) + '\n');
  console.log(`[beds] tracks.json updated with ${tracks.length} beds`);
}

main().catch((error) => {
  console.error('[beds] fatal:', error);
  process.exit(1);
});
