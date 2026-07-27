/**
 * Stock-footage video generator with scene-by-scene matching.
 *
 * Decomposed into three composable stages so scenes are first-class and can be
 * persisted, edited, and re-rendered without re-deriving them from the prompt:
 *
 *   planScenes(script, duration)   -> PlannedScene[]   (GPT scene decomposition)
 *   resolveSceneClips(scenes)      -> ResolvedScene[]  (Pexels footage matching)
 *   assembleVideo(scenes, ...)     -> public URL       (FFmpeg + voiceover + upload)
 *
 * Failures are surfaced, never papered over with someone else's demo video.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { createLlmClient, llmModel } from './ai/llm';
import { uploadImage as uploadCloudinaryImage, uploadVideo as uploadCloudinaryVideo } from './cloudinary';
import { selectMusicPath } from './music-library';
import { DEFAULT_TTS_MODEL, DEFAULT_VOICE_ID } from './voice-catalog';
import {
  buildCaptionFilter,
  buildKaraokeAss,
  buildWatermarkFilter,
  captionFontFamilyForLanguage,
  CAPTION_PRESETS,
  cuesFromScenes,
  escapeFontPath,
  normalizeSpokenUrls,
  resolveCaptionFontForLanguage,
  shiftCues,
  transcribeToCues,
  type CaptionCue,
  type CaptionPresetName,
  type CaptionStyle,
} from './captions';
import { overlayPosition, type Branding, type LogoPosition } from './brand-kit';
import {
  DEFAULT_TRANSITION,
  buildXfadeChain,
  clampTransitionDuration,
  paddedClipDurations,
  type TransitionConfig,
} from './transitions';
import { safeFetch } from './safe-fetch';
import { parseDurationSeconds, resolveFfmpegPath, supportsFilter } from './ffmpeg-env';
import { buildKenBurnsFilter, directionForScene } from './ken-burns';
import type { UserMediaItem } from './user-media';
import { withProviderReliability } from './provider-reliability';
import { buildSceneQueries } from './stock-query';
import { buildLowerThirdFilter, type LowerThird } from './lower-third';
import {
  buildAlignedNarration,
  concatSceneVoiceovers,
  pacedDuration,
  synthesizeSceneVoiceovers,
  type SceneVoiceover,
} from './voiceover';
import { runQualityGate, scenesForIssues, type QualityReport } from './quality-gate';

// Dynamic imports to avoid webpack bundling issues
let ffmpeg: any;
let createClient: any;
let OpenAI: any;

let ffmpegBin = '';

async function initializeModules() {
  if (!ffmpeg) {
    const fluentFfmpeg = await import('fluent-ffmpeg');
    ffmpeg = fluentFfmpeg.default;
    // Prefer a system ffmpeg: the bundled installer pins a 2018 build with no
    // xfade. See lib/ffmpeg-env.ts.
    ffmpegBin = resolveFfmpegPath();
    ffmpeg.setFfmpegPath(ffmpegBin);
  }
  if (!createClient) {
    const pexels = await import('pexels');
    createClient = pexels.createClient;
  }
  if (!OpenAI) {
    const openai = await import('openai');
    OpenAI = openai.OpenAI;
  }
}

let pexelsClient: any = null;

/** A scene as planned from the script, before footage is chosen. */
export interface PlannedScene {
  id: string;
  index: number;
  /** Prose for the human editing this scene. NOT spoken, NOT a search term. */
  description: string;
  /**
   * The words actually SPOKEN over this scene, and shown as its caption.
   *
   * Without this, `description` was narrated verbatim — so a commercial's
   * voiceover read its own stage directions out loud ("Close-up of coffee beans
   * pouring into a grinder"). A description tells an editor what is on screen;
   * narration is copy written to be heard. Optional: scenes planned before this
   * existed fall back to the description, exactly as they used to sound.
   */
  narration?: string;
  /**
   * A literal, filmable search phrase for the stock provider. Kept separate
   * from `description` because using prose as a query retrieved a makeup clip
   * for "close-up of a person's smile". Optional: scenes planned before this
   * existed fall back to a sanitized description (lib/stock-query.ts).
   */
  searchQuery?: string;
  keywords: string[];
  duration: number;
  visualElements: string[];
}

/**
 * The words spoken over a scene and printed in its captions.
 *
 * `description` is the fallback so that videos generated before narration
 * existed re-render identically instead of falling silent.
 */
export function spokenLine(scene: Pick<PlannedScene, 'description' | 'narration'>): string {
  const line = scene.narration?.trim();
  return line && line.length > 0 ? line : scene.description;
}

/**
 * Drop scenes the model invented with nothing to say.
 *
 * GPT likes to append a closing card — "Fade out to black with the price and
 * contact details displayed" — carrying an EMPTY narration. spokenLine() then
 * falls back to the description, and an estate agent's voiceover ends by
 * reading a stage direction aloud. (Whisper caught this in a real listing ad.)
 *
 * The fallback itself is still right for scenes planned before `narration`
 * existed — those have no narration at all, anywhere. So only prune when the
 * plan clearly uses narration and this particular scene has none: that is a
 * card, not a legacy scene.
 */
export function dropSilentScenes(scenes: PlannedScene[]): PlannedScene[] {
  const usesNarration = scenes.some((s) => (s.narration ?? '').trim().length > 0);
  if (!usesNarration) return scenes;

  const kept = scenes.filter((s) => (s.narration ?? '').trim().length > 0);
  if (kept.length === 0) return scenes;

  // Renumber so ids stay contiguous (scene-1, scene-2, ...).
  return kept.map((s, i) => ({ ...s, id: sceneId(i), index: i }));
}

/**
 * Cut a plan down to the number of assets the user actually supplied.
 *
 * `resolveSceneClips` fills scenes with the user's media in order and covers
 * the remainder with stock. That is right for "use my product shots"; it is
 * wrong for an estate agent who uploads five photos of a house and gets a
 * sixth shot of somebody else's kitchen. Whichever the caller wants, the plan
 * has to agree with it BEFORE durations are normalised, or the video's runtime
 * is spread across scenes that get dropped.
 *
 * Returns the plan unchanged when there is no media, or when the plan already
 * fits inside it.
 */
export function clampScenesToMedia(scenes: PlannedScene[], mediaCount: number): PlannedScene[] {
  if (mediaCount <= 0 || scenes.length <= mediaCount) return scenes;
  return scenes.slice(0, mediaCount).map((s, i) => ({ ...s, id: sceneId(i), index: i }));
}

/** A planned scene with its chosen stock clip. */
export interface ResolvedScene extends PlannedScene {
  clipUrl: string;
  matchedQuery: string;
  /**
   * Stills get Ken Burns motion instead of being held static. Optional so scenes
   * persisted before this existed still load (they were all videos).
   */
  mediaType?: 'video' | 'image';
  /** Poster frame of this scene, extracted at assembly time. */
  thumbnailUrl?: string;
}

export interface VideoClip {
  url: string;
  duration: number;
  type: 'video' | 'image';
}

/** Output shape. Drives both the render size and the stock-footage search. */
export type AspectRatio = '16:9' | '9:16' | '1:1';

export const ASPECT_PRESETS: Record<
  AspectRatio,
  { width: number; height: number; orientation: 'landscape' | 'portrait' | 'square' }
> = {
  '16:9': { width: 1920, height: 1080, orientation: 'landscape' },
  '9:16': { width: 1080, height: 1920, orientation: 'portrait' },
  '1:1': { width: 1080, height: 1080, orientation: 'square' },
};

export function aspectPreset(aspectRatio: AspectRatio = '16:9') {
  return ASPECT_PRESETS[aspectRatio] ?? ASPECT_PRESETS['16:9'];
}

/**
 * Actual output frame for a render. Draft mode halves each dimension —
 * quarter the pixels, so previews encode several times faster.
 */
export function renderDims(
  aspectRatio: AspectRatio,
  quality: RenderQuality = 'full',
): { width: number; height: number } {
  const { width, height } = aspectPreset(aspectRatio);
  if (quality === 'draft') {
    return { width: Math.round(width / 2), height: Math.round(height / 2) };
  }
  if (quality === '4k') {
    // 16:9 -> 3840x2160, 9:16 -> 2160x3840, 1:1 -> 2160x2160.
    return { width: width * 2, height: height * 2 };
  }
  return { width, height };
}

export type RenderQuality = 'draft' | 'full' | '4k';

/** scale+pad filter that fits source footage into the target frame. */
function fitFilterFor(width: number, height: number): string {
  return (
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`
  );
}

/**
 * Language of the spoken narration and burned-in captions. The stock-footage
 * search always stays English (libraries index English); only what is heard and
 * shown changes. Defaults to English.
 */
// Latin languages use the bundled DejaVu caption font; CJK (zh/ja/ko) and
// Devanagari (hi) render through Noto fonts installed in the Docker image and
// selected per-language in lib/captions.ts.
export type NarrationLanguage = 'en' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'zh' | 'ja' | 'ko' | 'hi';

/** Language names the scriptwriter is told to write narration in. */
export const NARRATION_LANGUAGE_NAMES: Record<NarrationLanguage, string> = {
  en: 'English',
  es: 'Latin-American Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Brazilian Portuguese',
  zh: 'Simplified Chinese (Mandarin)',
  ja: 'Japanese',
  ko: 'Korean',
  hi: 'Hindi',
};

export interface GenerationOptions {
  prompt: string;
  style: string;
  duration: number;
  addOns: string[];
  aspectRatio?: AspectRatio;
  /** Mood tag used to pick a music track; defaults to `style`. */
  mood?: string;
  /** ElevenLabs voice id for the narration. */
  voiceId?: string;
  /** Narration + caption language ('es' = Spanish). Stock search stays English. */
  language?: NarrationLanguage;
  /** Plan-gated branding (watermark / logo / intro / outro). */
  branding?: Branding | null;
  /** Cross-fade between scenes; null for hard cuts. */
  transition?: TransitionConfig | null;
  /** The user's own assets, filling scenes in order before stock is searched. */
  userMedia?: UserMediaItem[];
  /** 'draft' = fast preview, 'full' (default), '4k' = paid plans. */
  renderQuality?: RenderQuality;
  /**
   * Caption look. Named presets size static captions; 'karaoke' switches to
   * word-by-word highlight captions (Reels/TikTok style).
   */
  captionPreset?: CaptionPresetName;
  /** Append a two-second "Created with ForgeVid" bookend. */
  forgeVidEndCard?: boolean;
  /** Presenter picture-in-picture overlay (see AssembleOptions.pip). */
  pip?: { url: string; position?: LogoPosition; widthFraction?: number } | null;
  /**
   * A natural human voice: path to the user's own narration recording. When
   * set, AI TTS (and per-scene pacing) is skipped; captions come from Whisper.
   */
  voiceoverPath?: string | null;
  /**
   * The user's own background music. Overrides the bundled library, which is
   * empty unless the operator has licensed tracks into public/music.
   */
  musicPath?: string | null;
  /**
   * Use ONLY the caller's media: never pad the plan with stock footage. An
   * estate agent's listing must show their five photos, not four of theirs and
   * one of somebody else's kitchen.
   */
  mediaOnly?: boolean;
  /** Address + price burned into the opening seconds. */
  lowerThird?: LowerThird | null;
  /** Clips this user has already rejected — never serve them again. */
  excludeClipUrls?: string[];
  /**
   * Campaign variations. Reuse ONE pre-planned scene body across every variant
   * so a hook/CTA/aspect test changes exactly one variable.
   */
  presetScenes?: PlannedScene[];
  /** Override the opening line (the hook — ~70% of ad performance). */
  hookNarration?: string;
  /** Footage query for the hook, so the picture matches the new opening words. */
  hookSearchQuery?: string;
  /** Override the closing line (the call to action). */
  ctaNarration?: string;
}

function sceneId(index: number): string {
  return `scene-${index + 1}`;
}

function isCloudinaryConfigured(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

async function persistGeneratedVideo(outputPath: string, outputFilename: string): Promise<string> {
  const localUrl = `/generated/${outputFilename}`;

  if (!isCloudinaryConfigured()) {
    console.log('[Video Generator] Cloudinary not configured — keeping local generated file');
    return localUrl;
  }

  try {
    const uploadResult = await uploadCloudinaryVideo(outputPath, {
      folder: 'forgevid/generated-ai-videos',
      resource_type: 'video',
    });

    try {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    } catch (cleanupError) {
      console.error('[Video Generator] Failed to cleanup local file after upload:', cleanupError);
    }

    console.log('[Video Generator] ✓ Persisted to Cloudinary:', uploadResult.secure_url);
    return uploadResult.secure_url;
  } catch (uploadError) {
    console.error('[Video Generator] Cloudinary upload failed, keeping local file:', uploadError);
    return localUrl;
  }
}

/**
 * Duration of a media file, in seconds.
 *
 * `ffmpeg -i` prints it to stderr and exits non-zero (no output specified);
 * @ffmpeg-installer ships no ffprobe, so parse that. Returns 0 on failure.
 */
function probeDurationSeconds(filePath: string): number {
  const result = spawnSync(ffmpegBin, ['-hide_banner', '-i', filePath], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return parseDurationSeconds(`${result.stderr ?? ''}`);
}

/** Re-encode a clip to the render's frame size/fps so concat is seamless. */
async function normalizeClip(source: string, fit: string, outPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ffmpeg(source)
      .outputOptions([
        '-c:v libx264',
        '-preset ultrafast',
        '-crf 23',
        '-an',
        '-r 30',
        '-pix_fmt yuv420p',
      ])
      .videoFilters(fit)
      .output(outPath)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .run();
  });
}

/**
 * Grab a poster frame from a rendered video and persist it.
 *
 * Best-effort: a missing thumbnail must never fail a generation, so every
 * failure path returns null. Must run before the local render is deleted.
 */
async function extractThumbnail(
  videoPath: string,
  atSeconds: number,
  label = '',
): Promise<string | null> {
  try {
    const outputDir = path.join(process.cwd(), 'public', 'generated');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const filename = `thumb_${Date.now()}${label ? `_${label}` : ''}.jpg`;
    const thumbPath = path.join(outputDir, filename);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .inputOptions([`-ss ${atSeconds.toFixed(2)}`])
        .outputOptions(['-frames:v 1', '-q:v 3'])
        .output(thumbPath)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .run();
    });

    if (!fs.existsSync(thumbPath)) return null;

    if (isCloudinaryConfigured()) {
      try {
        const upload = await uploadCloudinaryImage(thumbPath, { folder: 'forgevid/thumbnails' });
        fs.unlinkSync(thumbPath);
        return upload.secure_url;
      } catch (error) {
        console.error('[Video Generator] Thumbnail upload failed, keeping local:', error);
      }
    }
    return `/generated/${filename}`;
  } catch (error) {
    console.error('[Video Generator] Thumbnail extraction failed (non-fatal):', error);
    return null;
  }
}

/**
 * Generate voiceover audio via ElevenLabs. Returns the .mp3 path, or null when
 * no key is configured (voiceover is optional — the video still renders).
 */
async function generateVoiceover(narration: string, voiceId?: string): Promise<string | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.log('[Video Generator] No ElevenLabs API key — skipping voiceover');
    return null;
  }

  try {
    const textToSpeak = narration.slice(0, 2000);
    // Validated upstream (catalog or cloned voice) — use verbatim.
    const voice = voiceId || DEFAULT_VOICE_ID;
    console.log(`[Video Generator] Generating voiceover (${textToSpeak.length} chars, voice ${voice})...`);

    const response = await withProviderReliability('elevenlabs', () => fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}`,
      {
        method: 'POST',
        headers: {
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text: textToSpeak,
          model_id: DEFAULT_TTS_MODEL,
          voice_settings: { stability: 0.6, similarity_boost: 0.6 },
        }),
      }
    ));

    if (!response.ok) {
      console.error(`[Video Generator] ElevenLabs error: ${response.status} ${response.statusText}`);
      return null;
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const tempDir = path.join(process.cwd(), 'public', 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const voiceoverPath = path.join(tempDir, `voiceover_${Date.now()}.mp3`);
    fs.writeFileSync(voiceoverPath, audioBuffer);
    return voiceoverPath;
  } catch (error) {
    console.error('[Video Generator] Voiceover generation failed:', error);
    return null;
  }
}

export function isStockProviderConfigured(): boolean {
  return Boolean(process.env.PEXELS_API_KEY);
}

/**
 * Search Pexels for stock video. Returns [] when unavailable — callers decide
 * how to fail. We never substitute unrelated sample footage.
 */
export async function searchStockVideos(
  query: string,
  limit: number = 5,
  orientation: 'landscape' | 'portrait' | 'square' = 'landscape',
): Promise<VideoClip[]> {
  await initializeModules();

  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return [];

  if (!pexelsClient && createClient) {
    pexelsClient = createClient(apiKey);
  }
  if (!pexelsClient) return [];

  try {
    const response: any = await withProviderReliability('pexels', () => pexelsClient.videos.search({
      query,
      per_page: limit,
      size: 'large',
      // Matching orientation matters: landscape footage in a 9:16 frame is
      // mostly letterbox.
      orientation,
    }));

    if ('videos' in response && response.videos) {
      return response.videos
        .map((video: any) => {
          const videoFiles = video.video_files || [];
          const hdFile = videoFiles.find(
            (f: any) => f.quality === 'hd' || (f.quality === 'sd' && f.width >= 1280)
          );
          const bestFile = hdFile || videoFiles[0];
          return {
            url: bestFile?.link || '',
            duration: video.duration || 5,
            type: 'video' as const,
          };
        })
        .filter((v: { url: string }) => v.url);
    }
  } catch (error) {
    console.error('[Video Generator] Pexels API error:', error);
  }

  return [];
}

/**
 * Search Pexels photos. Used when no video matches a scene — a still with Ken
 * Burns motion beats failing the whole generation.
 */
export async function searchStockPhotos(
  query: string,
  limit: number = 5,
  orientation: 'landscape' | 'portrait' | 'square' = 'landscape',
): Promise<VideoClip[]> {
  await initializeModules();

  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return [];
  if (!pexelsClient && createClient) pexelsClient = createClient(apiKey);
  if (!pexelsClient) return [];

  try {
    const response: any = await withProviderReliability('pexels', () =>
      pexelsClient.photos.search({ query, per_page: limit, orientation }));
    if ('photos' in response && response.photos) {
      return response.photos
        .map((photo: any) => ({
          url: photo.src?.large2x || photo.src?.large || photo.src?.original || '',
          duration: 0,
          type: 'image' as const,
        }))
        .filter((p: { url: string }) => p.url);
    }
  } catch (error) {
    console.error('[Video Generator] Pexels photo search error:', error);
  }
  return [];
}

/**
 * Map a MediaAsset url to a file on disk.
 *
 * Locally-stored assets (uploaded product shots, images imported from a site)
 * carry a PUBLIC-relative url like `/uploads/site/x.jpg`, not a filesystem
 * path — feeding that straight to ffmpeg looks for `C:\uploads\...` and fails.
 * A leading slash is therefore resolved under public/. Anything else is taken
 * as a real path, which is what keeps assembleVideo testable offline.
 *
 * The containment check is belt-and-braces: these urls come from our own
 * database, but a `..` segment must never escape public/.
 */
export function resolveLocalSource(url: string): string {
  if (!url.startsWith('/')) return url;
  const publicDir = path.resolve(process.cwd(), 'public');
  const resolved = path.resolve(publicDir, `.${url}`);
  const prefix = publicDir + path.sep;
  if (resolved !== publicDir && !resolved.startsWith(prefix)) {
    throw new Error(`Refusing to read a scene source outside public/: ${url}`);
  }
  return resolved;
}

/**
 * Where a scene's source ended up, and whether WE created that file.
 *
 * `downloaded` is not a nicety: cleanup deletes only files it created, and the
 * old code inferred that by comparing the returned string to the input url. The
 * moment a local url needed resolving (`/uploads/x.jpg` -> an absolute path)
 * that heuristic silently flipped, and cleanup began deleting the user's own
 * uploads. Say it explicitly instead.
 */
interface MaterializedFile {
  path: string;
  downloaded: boolean;
}

/**
 * Download a remote file into public/temp. A local source is resolved to a
 * path and never copied, which keeps assembleVideo testable without network.
 */
async function downloadFile(url: string, filename: string): Promise<MaterializedFile> {
  if (!/^https?:\/\//i.test(url)) {
    const local = resolveLocalSource(url);
    if (!fs.existsSync(local)) throw new Error(`Scene source not found on disk: ${url}`);
    return { path: local, downloaded: false };
  }
  const tempDir = path.join(process.cwd(), 'public', 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const filepath = path.join(tempDir, filename);
  const response = await safeFetch(url, {
    maxBytes: 250 * 1024 * 1024,
    timeoutMs: 30_000,
    acceptTypes: ['image', 'video', 'audio', 'application/octet-stream'],
  });
  fs.writeFileSync(filepath, response.body);
  return { path: filepath, downloaded: true };
}

/**
 * Rescale scene durations so they sum to the requested total.
 *
 * The model's per-scene durations are advisory and frequently wrong: it will
 * happily return five 12-second scenes for a "15 second" video (that shipped a
 * 62s render from a 15s request). We keep the model's RELATIVE weighting — some
 * scenes deserve to linger — but the total is ours to enforce, with a 1s floor
 * so no scene is too short to register.
 */
export function normalizeSceneDurations(
  scenes: PlannedScene[],
  totalDuration: number,
): PlannedScene[] {
  if (scenes.length === 0) return scenes;
  const target = Math.max(scenes.length, totalDuration); // at least 1s per scene
  const rawSum = scenes.reduce((sum, s) => sum + Math.max(0, s.duration), 0);

  // No usable weights from the model — split evenly.
  if (rawSum <= 0) {
    const each = Number((target / scenes.length).toFixed(2));
    return scenes.map((s) => ({ ...s, duration: each }));
  }

  const scale = target / rawSum;
  const scaled = scenes.map((s) => ({
    ...s,
    duration: Math.max(1, Number((Math.max(0, s.duration) * scale).toFixed(2))),
  }));

  // The 1s floor can push the sum off target; put the drift on the longest
  // scene so the total lands exactly on the request.
  const scaledSum = scaled.reduce((sum, s) => sum + s.duration, 0);
  const drift = Number((target - scaledSum).toFixed(2));
  if (Math.abs(drift) >= 0.01) {
    let longest = 0;
    for (let i = 1; i < scaled.length; i++) {
      if (scaled[i].duration > scaled[longest].duration) longest = i;
    }
    scaled[longest].duration = Math.max(1, Number((scaled[longest].duration + drift).toFixed(2)));
  }
  return scaled;
}

/**
 * Stage 1 — decompose the script into scenes with GPT.
 */
export async function planScenes(
  script: string,
  totalDuration: number,
  language: NarrationLanguage = 'en',
): Promise<PlannedScene[]> {
  await initializeModules();

  // Only the spoken/shown text changes language. searchQuery + keywords stay
  // English because they are sent verbatim to a stock library that indexes it.
  const languageRule =
    language !== 'en'
      ? `\n\nOUTPUT LANGUAGE — write EVERY "narration" value in natural, fluent ${NARRATION_LANGUAGE_NAMES[language]}. Keep "searchQuery" and "keywords" in English (they are sent verbatim to a stock-footage library that indexes English). "description" may stay English; it is never shown or spoken.`
      : '';

  const withIds = (raw: any[]): PlannedScene[] =>
    normalizeSceneDurations(
      dropSilentScenes(
        raw
        .filter((s) => s && typeof s.description === 'string')
        .map((s, i) => ({
          id: sceneId(i),
          index: i,
          description: String(s.description),
          narration: typeof s.narration === 'string' ? s.narration : undefined,
          searchQuery: typeof s.searchQuery === 'string' ? s.searchQuery : undefined,
          keywords: Array.isArray(s.keywords) ? s.keywords.map(String) : [],
          duration: Number(s.duration) > 0 ? Number(s.duration) : Math.max(1, totalDuration / raw.length),
          visualElements: Array.isArray(s.visualElements) ? s.visualElements.map(String) : [],
        })),
      ),
      totalDuration,
    );

  try {
    const openai = createLlmClient();

    const response = await openai.chat.completions.create({
      model: llmModel('fast'),
      messages: [
        {
          role: 'system',
          content: `You are a video production assistant. Parse the video script into individual scenes for stock footage matching.

For each scene provide:
1. "description" — prose for a human editor: what is on screen. Never spoken.
2. "narration" — THE WORDS SPOKEN ALOUD over this scene, and shown as its
   caption. This is copy written to be HEARD, not a description of the picture.
   Read end to end across all scenes it must flow as one continuous script.
     - never narrate the shot itself ("close-up of...", "we see...")
     - if the source text is an advert, this is the ad copy; if it is a story,
       this is the storytelling
     - LENGTH MATTERS. Speech runs at about 2.5 words per second, and the
       finished video is cut to the length of the narration. Across ALL scenes
       the narration must total roughly ${Math.round(totalDuration * 2.5)} words
       for this ${totalDuration}-second video, split in proportion to each
       scene's duration. Writing less makes the video come out short.
   Bad:  "Close-up of coffee beans pouring into a grinder"
   Good: "It starts with beans picked at their peak."
3. "searchQuery" — a STOCK FOOTAGE SEARCH TERM, not prose. 2-4 concrete,
   filmable nouns naming what is literally on screen. This string is sent to a
   stock library verbatim, so:
     - no camera language ("close-up of", "over-the-shoulder", "cut to")
     - no emotions or abstractions ("satisfaction", "smile", "success",
       "premium"). Stock libraries answer those with beauty and lifestyle
       clips instead of your subject.
     - name the SUBJECT and its SETTING.
   Bad:  "Close-up of a person's smile watching the finished video"
   Good: "person editing video on laptop"
4. "keywords" — 3-5 single visual nouns, used as backup queries.
5. "duration" — seconds; distribute ${totalDuration}s total across all scenes.
6. "visualElements" — key objects in frame.

Return ONLY a JSON array with this structure:
[
  {
    "description": "Flour scattered across a wooden countertop in morning light",
    "narration": "Every loaf begins the same way.",
    "searchQuery": "flour wooden countertop",
    "keywords": ["flour", "baking", "countertop", "kitchen"],
    "duration": 5,
    "visualElements": ["flour dust", "wooden counter", "baking preparation"]
  }
]

Hard rules:
- EVERY scene must have non-empty "narration". A scene with nothing to say does
  not exist.
- Do NOT invent a title card, end card, logo screen, "fade to black", or any
  scene showing text. There is no such footage, and the voice would end up
  reading the stage direction aloud. Put the call to action in the LAST real
  scene's narration instead.

Be specific and focus on filmable, real-world visuals. Avoid abstract concepts.${languageRule}`,
        },
        { role: 'user', content: `Parse this script into scenes:\n\n${script}` },
      ],
      // 8k so a multi-scene script's JSON isn't truncated mid-object (the 2k
      // default was "Unexpected end of JSON input" -> fell back to 1 scene).
      max_tokens: 8192,
      temperature: 0.3,
    });

    let content = (response.choices[0]?.message?.content || '').trim();

    // Strip markdown fences, then fall back to extracting the JSON array.
    if (content.startsWith('```')) {
      const lines = content.split('\n');
      if (lines[0].trim().match(/^```(json)?$/)) lines.shift();
      if (lines[lines.length - 1].trim() === '```') lines.pop();
      content = lines.join('\n').trim();
    }
    const jsonMatch = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (jsonMatch) content = jsonMatch[0];

    const parsed = JSON.parse(content);
    const raw = Array.isArray(parsed) ? parsed : parsed.scenes || [];
    const scenes = withIds(raw);

    if (scenes.length > 0) {
      console.log(`[Video Generator] Planned ${scenes.length} scenes`);
      return scenes;
    }
  } catch (error) {
    console.error('[Video Generator] Scene planning failed:', error);
  }

  // Degrade to a single scene rather than failing the whole job.
  return [
    {
      id: sceneId(0),
      index: 0,
      description: script.substring(0, 100),
      keywords: await extractKeywordsLegacy(script, 'cinematic'),
      duration: totalDuration,
      visualElements: [],
    },
  ];
}

/** Legacy keyword extraction, used when scene planning degrades. */
async function extractKeywordsLegacy(prompt: string, style: string): Promise<string[]> {
  try {
    const openai = createLlmClient();

    const response = await openai.chat.completions.create({
      model: llmModel('fast'),
      messages: [
        {
          role: 'system',
          content:
            'Extract 3-5 visual keywords from the video description that would be good search terms for finding stock footage. Return ONLY a comma-separated list of keywords. Focus on locations, objects, actions, and visual elements that can be filmed. Avoid abstract concepts.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2048,
      temperature: 0.3,
    });

    const extracted = (response.choices[0]?.message?.content || '')
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k.length > 2);

    if (extracted.length > 0) return extracted.slice(0, 5);
  } catch (error) {
    console.error('[Video Generator] AI keyword extraction failed:', error);
  }

  const commonWords = ['a', 'an', 'the', 'is', 'are', 'was', 'were', 'for', 'with', 'about', 'create', 'make', 'video', 'generate', 'prompt', 'description', 'short', 'animated'];
  const words = prompt
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 3 && !commonWords.includes(word));

  const styleKeywords: Record<string, string[]> = {
    cinematic: ['nature', 'landscape', 'sunset'],
    modern: ['city', 'technology', 'business'],
    energetic: ['sports', 'action', 'movement'],
    professional: ['office', 'meeting', 'workplace'],
  };

  return [...new Set([...words.slice(0, 3), ...(styleKeywords[style] || [])])].slice(0, 5);
}

/**
 * Pick a stock clip for one scene. Tries the scene description first (better
 * semantic match than a bare keyword), then each keyword. Skips any clip URL in
 * `exclude` so scenes don't reuse the same footage.
 */
export async function resolveSceneClip(
  scene: PlannedScene,
  exclude: Set<string> = new Set(),
  aspectRatio: AspectRatio = '16:9',
): Promise<ResolvedScene | null> {
  const { orientation } = aspectPreset(aspectRatio);
  // The scene's own search phrase first, then a sanitized description, then
  // keywords. Never the raw prose: see lib/stock-query.ts for why.
  const queries = buildSceneQueries(scene);

  for (const query of queries) {
    const candidates = await searchStockVideos(query, 5, orientation);
    const fresh = candidates.filter((c) => !exclude.has(c.url));
    if (fresh.length > 0) {
      return { ...scene, clipUrl: fresh[0].url, matchedQuery: query, mediaType: 'video' };
    }
  }

  // No footage: a still with Ken Burns motion beats failing the generation.
  for (const query of queries) {
    const photos = await searchStockPhotos(query, 5, orientation);
    const fresh = photos.filter((p) => !exclude.has(p.url));
    if (fresh.length > 0) {
      console.log(`[Video Generator] Scene ${scene.index + 1}: no video, using a photo`);
      return { ...scene, clipUrl: fresh[0].url, matchedQuery: query, mediaType: 'image' };
    }
  }

  return null;
}

/**
 * Stage 2 — choose footage for every scene. Throws if no provider is
 * configured or if a scene cannot be matched, rather than silently shipping
 * unrelated sample footage.
 */
export async function resolveSceneClips(
  scenes: PlannedScene[],
  aspectRatio: AspectRatio = '16:9',
  userMedia: UserMediaItem[] = [],
  /** Clips this user already rejected. We never offer them again. */
  excludeUrls: Set<string> = new Set(),
): Promise<ResolvedScene[]> {
  // The user's own media fills scenes in order; stock only covers the rest. So
  // Pexels is only required when there is a scene it must actually cover.
  const scenesNeedingStock = Math.max(0, scenes.length - userMedia.length);
  if (scenesNeedingStock > 0 && !isStockProviderConfigured()) {
    throw new Error(
      `No stock footage provider configured (PEXELS_API_KEY), and your media only ` +
        `covers ${userMedia.length} of ${scenes.length} scenes.`,
    );
  }

  // Seeded with the user's rejections, so the search skips them from the start.
  const used = new Set<string>(excludeUrls);
  const resolved: ResolvedScene[] = [];

  for (const scene of scenes) {
    const own = userMedia[scene.index];
    if (own) {
      used.add(own.url);
      resolved.push({
        ...scene,
        clipUrl: own.url,
        matchedQuery: own.name,
        mediaType: own.mediaType,
      });
      console.log(`[Video Generator] ✓ Scene ${scene.index + 1} uses your media "${own.name}"`);
      continue;
    }

    const match = await resolveSceneClip(scene, used, aspectRatio);
    if (!match) {
      throw new Error(`No stock footage found for scene ${scene.index + 1}: "${scene.description}"`);
    }
    used.add(match.clipUrl);
    resolved.push(match);
    console.log(`[Video Generator] ✓ Scene ${scene.index + 1} matched "${match.matchedQuery}"`);
  }

  return resolved;
}

/**
 * Stage 3 — download, trim, concat, caption, add voiceover, and upload.
 * Takes an explicit scene list so re-renders can skip planning/resolving.
 */
export interface AssembleOptions {
  /** Absolute path to a background music file. Looped and ducked under narration. */
  musicPath?: string | null;
  /** Music level before ducking (0-1). */
  musicVolume?: number;
  /**
   * Reuse an existing voiceover instead of synthesizing a new one. Lets a
   * re-render skip a paid TTS call — and makes the assembler testable offline.
   */
  voiceoverPath?: string | null;
  /** ElevenLabs voice id; unknown ids fall back to the default. */
  voiceId?: string | null;
  /**
   * Pre-computed caption cues. When omitted, the voiceover is transcribed with
   * Whisper; failing that we fall back to one cue per scene.
   */
  cues?: CaptionCue[] | null;
  captionStyle?: CaptionStyle;
  /**
   * 'karaoke' renders word-by-word highlight captions (Reels/TikTok style) via
   * an ASS subtitles filter, using Whisper word timestamps. Cues without word
   * timing fall back to static captions in the same look.
   */
  captionAnimation?: 'karaoke' | null;
  /** Narration language — selects a CJK/Devanagari caption font when needed. */
  language?: NarrationLanguage;
  /** Plan-gated branding: watermark, logo, intro/outro, caption colour/font. */
  branding?: Branding | null;
  /** Cross-fade between scenes. Pass null for hard cuts. */
  transition?: TransitionConfig | null;
  /**
   * Pre-synthesized per-scene narration (test injection). When present — or
   * when per-scene TTS succeeds — the AUDIO decides each scene's duration.
   */
  sceneVoiceovers?: SceneVoiceover[] | null;
  /**
   * A lower third burned into the opening seconds — the address and price an
   * estate agent expects to see on screen.
   */
  lowerThird?: LowerThird | null;
  /** Set false to keep GPT's scene durations even when narration is per-scene. */
  paceToNarration?: boolean;
  /** 'draft' = fast half-res preview, '4k' = double resolution (paid plans). */
  renderQuality?: RenderQuality;
  /**
   * Picture-in-picture: a presenter clip overlaid in a corner over the whole
   * video ("salesperson talking over the walkaround"). VIDEO ONLY — its audio
   * is dropped; the voice belongs to the narration track (upload the presenter
   * audio via narrationAssetId). Plays once, then yields to the main picture.
   */
  pip?: { url: string; position?: LogoPosition; widthFraction?: number } | null;
  /** Append a two-second "Created with ForgeVid" bookend. */
  forgeVidEndCard?: boolean;
}

export interface AssembleResult {
  videoUrl: string;
  /** The cues actually burned in — persist these for SRT/VTT export. */
  cues: CaptionCue[];
  /** Poster frame URL, or null if extraction failed (never fatal). */
  thumbnailUrl: string | null;
  /**
   * The scenes as actually rendered: narration-paced durations and per-scene
   * thumbnails. Persist THESE, not the input, or the editor drifts from the video.
   */
  scenes: ResolvedScene[];
  /** Post-render quality check of the local file, before it was uploaded. */
  quality: QualityReport;
}

export async function assembleVideo(
  inputScenes: ResolvedScene[],
  addOns: string[] = [],
  aspectRatio: AspectRatio = '16:9',
  options: AssembleOptions = {},
): Promise<AssembleResult> {
  await initializeModules();

  if (inputScenes.length === 0) throw new Error('Cannot assemble a video with no scenes');

  const renderQuality = options.renderQuality ?? 'full';
  const { width: outW, height: outH } = renderDims(aspectRatio, renderQuality);
  const fit = fitFilterFor(outW, outH);
  // Music arrives already normalised to about -20 LUFS (generated beds are baked
  // that way; uploads are normalised on the way in), so this is a plain gain.
  //
  // The old default of 0.25 sat the bed near -32 dB, and `amix` without
  // normalize=0 took another 6 dB off both stems — about -38 dB, which is
  // present in the waveform and inaudible to a human. 0.6 puts it roughly
  // 20 dB under the narration: audible in the gaps, invisible under speech.
  const musicVolume = options.musicVolume ?? 0.6;
  const branding = options.branding ?? null;

  const tempDir = path.join(process.cwd(), 'public', 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const wantVoiceover = addOns.length === 0 || addOns.includes('voiceover');
  const wantSubtitles = addOns.length === 0 || addOns.includes('subtitles');

  // Work on a copy: pacing and thumbnails mutate durations/urls, and the
  // caller persists whatever we return.
  let scenes = inputScenes.map((s) => ({ ...s }));

  /** Source media handed to ffmpeg (may be a caller-owned local path). */
  const sources: string[] = [];
  /** Only files WE created — everything here gets deleted in `finally`. */
  const tempFiles: string[] = [];
  const trimmed: string[] = [];
  let voiceoverPath: string | null = null;
  let fileListPath = '';

  try {
    // ---- Narration-paced scenes (per-scene TTS, cached) ---------------------
    // The audio decides each scene's duration: scenes are cut to speech instead
    // of speech being trimmed/padded to GPT's guessed durations.
    let sceneCues: CaptionCue[] | null = null;
    if (wantVoiceover && !options.voiceoverPath) {
      const segments =
        options.sceneVoiceovers ??
        (await synthesizeSceneVoiceovers(
          // What is SPOKEN is the narration, never the stage direction.
          scenes.map((s) => ({ id: s.id, description: spokenLine(s) })),
          options.voiceId,
        ));

      if (segments && segments.length === scenes.length) {
        if (options.paceToNarration !== false) {
          // A scene is never SHORTER than its line (the voice would be cut off)
          // and never shorter than the length the user asked for. Speech is a
          // floor, not the answer — otherwise a 25-second advert whose copy runs
          // 13 seconds silently becomes a 13-second advert.
          scenes = scenes.map((s, i) => ({
            ...s,
            duration: Math.max(pacedDuration(segments[i]), s.duration),
          }));
        }

        // Each line is delayed to its own scene's start, so extra runtime lands
        // as pauses BETWEEN lines rather than sliding the whole script early.
        const sceneStarts: number[] = [];
        let cursor = 0;
        for (const s of scenes) {
          sceneStarts.push(cursor);
          cursor += s.duration;
        }
        const concatPath = path.join(tempDir, `narration_${Date.now()}.m4a`);
        voiceoverPath = await buildAlignedNarration(segments, sceneStarts, cursor, concatPath);
        tempFiles.push(concatPath);

        // Exact per-scene cues: each line spans its own (audio-derived) scene.
        let t = 0;
        sceneCues = scenes.map((s, i) => {
          const cue = { start: t, end: t + segments[i].durationSeconds, text: spokenLine(s) };
          t += s.duration;
          return cue;
        });
        console.log(
          `[Video Generator] Narration-paced: ${segments.filter((s) => s.cached).length}/${segments.length} segments from cache`,
        );
      }
    }

    const scenesDuration = scenes.reduce((sum, s) => sum + s.duration, 0);
    const narration = scenes.map(spokenLine).join(' ').replace(/\s+/g, ' ').trim();
    // Fetch footage and synthesize narration in parallel.
    const [clipPaths, vo] = await Promise.all([
      (async () => {
        const paths: string[] = [];
        for (const scene of scenes) {
          const ext = scene.mediaType === 'image' ? 'jpg' : 'mp4';
          const filename = `scene_${Date.now()}_${scene.index}.${ext}`;
          const source = await downloadFile(scene.clipUrl, filename);
          paths.push(source.path);
          // Only a downloaded copy is ours to delete; a local source is not.
          if (source.downloaded) tempFiles.push(source.path);
        }
        return paths;
      })(),
      // Priority: injected file > per-scene narration (already concatenated
      // above) > whole-narration fallback synthesis.
      options.voiceoverPath
        ? Promise.resolve(options.voiceoverPath)
        : voiceoverPath
          ? Promise.resolve(voiceoverPath)
          : wantVoiceover
            ? generateVoiceover(narration, options.voiceId ?? undefined)
            : Promise.resolve(null),
    ]);
    sources.push(...clipPaths);
    const isFallbackSynth = !options.voiceoverPath && !voiceoverPath && !!vo;
    voiceoverPath = vo;
    // Only a whole-narration file we synthesized here is ours to delete; the
    // per-scene concat is already in tempFiles, cache segments never are.
    if (isFallbackSynth && voiceoverPath) tempFiles.push(voiceoverPath);

    // Cross-fades overlap clips, so each clip but the last is rendered longer by
    // the transition duration — that keeps the total equal to sum(sceneDurations),
    // which keeps the narration in sync and caption cues valid.
    const sceneDurations = scenes.map((s) => s.duration);
    let requested = options.transition === null ? null : options.transition ?? DEFAULT_TRANSITION;

    // xfade needs ffmpeg >= 4.3. Degrade to hard cuts rather than failing.
    if (requested && !supportsFilter('xfade')) {
      console.warn(
        `[Video Generator] This ffmpeg has no xfade filter (needs >= 4.3) — ` +
          `rendering hard cuts. Install a newer ffmpeg or set FFMPEG_PATH.`,
      );
      requested = null;
    }

    const transitionDuration = requested
      ? clampTransitionDuration(requested.duration, sceneDurations)
      : 0;
    const transition: TransitionConfig | null =
      requested && transitionDuration > 0
        ? { type: requested.type, duration: transitionDuration }
        : null;
    const clipDurations = paddedClipDurations(sceneDurations, transitionDuration);

    const kenBurnsAvailable = supportsFilter('zoompan');

    // Trim each clip to its (possibly padded) duration. A still is looped and
    // given Ken Burns motion — held static it reads as a broken video.
    for (let i = 0; i < scenes.length; i++) {
      const trimmedPath = path.join(tempDir, `trimmed_${Date.now()}_${i}.mp4`);
      const isStill = scenes[i].mediaType === 'image';
      const clipDuration = clipDurations[i];

      await new Promise<void>((resolve, reject) => {
        const cmd = ffmpeg(sources[i]);

        if (isStill) {
          // A single image must be looped to fill the clip's duration.
          cmd.inputOptions(['-loop 1']);
        } else {
          // A stock VIDEO clip shorter than its scene must also be looped, or
          // the picture runs out before the narration and the video track
          // underruns the (longer) audio. -stream_loop -1 loops the input;
          // setDuration (-t) below caps it, so a clip already long enough is
          // simply cut at clipDuration exactly as before — only short clips
          // are affected.
          cmd.inputOptions(['-stream_loop -1']);
        }

        cmd
          .setDuration(clipDuration)
          .outputOptions([
            '-c:v libx264',
            '-preset ultrafast',
            '-crf 23',
            '-an',
            '-r 30',
            '-pix_fmt yuv420p',
            '-movflags +faststart',
          ])
          .videoFilters(
            isStill && kenBurnsAvailable
              ? buildKenBurnsFilter({
                  width: outW,
                  height: outH,
                  fps: 30,
                  durationSeconds: clipDuration,
                  direction: directionForScene(i),
                })
              : fit,
          )
          .output(trimmedPath)
          .on('end', () => resolve())
          .on('error', (err: Error) => reject(err))
          .run();
      });
      trimmed.push(trimmedPath);
    }

    // Per-scene poster frames, so the editor shows what each scene looks like
    // instead of a text-only list. Best-effort; taken from the trimmed clips
    // BEFORE the cross-fade pass merges them into one file.
    for (let i = 0; i < scenes.length; i++) {
      const at = Math.min(0.5, Math.max(0.1, scenes[i].duration / 2));
      const thumb = await extractThumbnail(trimmed[i], at, `s${i + 1}`);
      if (thumb) scenes[i] = { ...scenes[i], thumbnailUrl: thumb };
    }

    // Cross-fade the scenes into ONE clip, so the rest of the pipeline (bookend
    // concat, captions, audio) is untouched. Skipped for a single scene.
    if (transition && trimmed.length > 1) {
      const chain = buildXfadeChain(clipDurations, transition);
      const fadedPath = path.join(tempDir, `xfade_${Date.now()}.mp4`);

      await new Promise<void>((resolve, reject) => {
        const cmd = ffmpeg();
        for (const clip of trimmed) cmd.input(clip);
        cmd
          .complexFilter(chain.filters.join(';'), [chain.outputLabel])
          .outputOptions([
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', '23',
            '-an',
            '-r', '30',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
          ])
          .output(fadedPath)
          .on('end', () => resolve())
          .on('error', (err: Error) => reject(err))
          .run();
      });

      tempFiles.push(...trimmed);
      trimmed.length = 0;
      trimmed.push(fadedPath);
      console.log(
        `[Video Generator] Applied ${transition.type} transitions (${transition.duration}s)`,
      );
    }

    // Brand intro/outro bookend the scenes. They must be normalized to the same
    // codec/size/fps or the concat demuxer produces a broken stream.
    let introDuration = 0;
    let outroDuration = 0;

    const prepareBookend = async (url: string, label: string): Promise<string> => {
      const src = await downloadFile(url, `${label}_${Date.now()}.mp4`);
      if (src.downloaded) tempFiles.push(src.path);
      const normalized = path.join(tempDir, `${label}_norm_${Date.now()}.mp4`);
      await normalizeClip(src.path, fit, normalized);
      tempFiles.push(normalized);
      return normalized;
    };

    if (branding?.introUrl) {
      try {
        const intro = await prepareBookend(branding.introUrl, 'intro');
        introDuration = probeDurationSeconds(intro);
        trimmed.unshift(intro);
      } catch (error) {
        console.error('[Video Generator] Intro failed, skipping (non-fatal):', error);
      }
    }
    if (branding?.outroUrl) {
      try {
        const outro = await prepareBookend(branding.outroUrl, 'outro');
        outroDuration = probeDurationSeconds(outro);
        trimmed.push(outro);
      } catch (error) {
        console.error('[Video Generator] Outro failed, skipping (non-fatal):', error);
      }
    }
    if (options.forgeVidEndCard) {
      try {
        const endCard = path.join(tempDir, `forgevid_endcard_${Date.now()}.mp4`);
        const fontSize = Math.max(28, Math.round(outW / 22));
        await new Promise<void>((resolve, reject) => {
          ffmpeg()
            .input(`color=c=0x0f172a:s=${outW}x${outH}:d=2:r=30`)
            .inputFormat('lavfi')
            .videoFilters([
              `drawtext=text='Created with ForgeVid':fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2`,
            ])
            .outputOptions(['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an'])
            .output(endCard)
            .on('end', () => resolve())
            .on('error', (error: Error) => reject(error))
            .run();
        });
        tempFiles.push(endCard);
        trimmed.push(endCard);
        outroDuration += 2;
      } catch (error) {
        console.error('[Video Generator] ForgeVid end card failed, skipping (non-fatal):', error);
      }
    }

    const timelineDuration = introDuration + scenesDuration + outroDuration;

    fileListPath = path.join(tempDir, `filelist_${Date.now()}.txt`);
    fs.writeFileSync(fileListPath, trimmed.map((c) => `file '${c.replace(/\\/g, '/')}'`).join('\n'));

    const outputFilename = `generated_video_${Date.now()}.mp4`;
    const outputDir = path.join(process.cwd(), 'public', 'generated');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, outputFilename);
    // Set inside the ffmpeg command Promise below (hasAudio there is scene-local);
    // read afterward to size the quality gate's audio expectation correctly.
    let renderedHasAudio = false;

    // Real captions come from transcribing the narration. Without a voiceover
    // (or without an OpenAI key) fall back to one cue per scene.
    let cues: CaptionCue[] = [];
    if (wantSubtitles) {
      // Per-scene narration cues are speech-aligned AND free — but they carry
      // no WORD timestamps, so karaoke rendered them as static lines. When the
      // karaoke style is on, spend the Whisper pass to get word timing; static
      // captions keep preferring the free per-scene cues.
      const wantKaraoke = options.captionAnimation === 'karaoke';
      let transcribed: CaptionCue[] | null = null;
      if (!options.cues && voiceoverPath && (wantKaraoke || !sceneCues)) {
        transcribed = await transcribeToCues(voiceoverPath);
      }
      cues =
        options.cues ??
        transcribed ??
        sceneCues ??
        cuesFromScenes(scenes.map((s) => ({ description: spokenLine(s), duration: s.duration })));

      // Authored narration writes urls as "dot com"/"punto com" for the TTS;
      // captions must still read "ForgeVid.com". Transcribed cues are already
      // normalized inside transcribeToCues (this is idempotent); this covers
      // the scene-text sources too.
      normalizeSpokenUrls(cues);

      // A brand intro delays the narration; shift the cues to match.
      cues = shiftCues(cues, introDuration);
    }

    // A brand font uploaded through /api/brand-kit/font lives in cloud storage;
    // ffmpeg needs a real file. Localize it once for captions AND lower thirds.
    let brandFontFile = branding?.fontFile ?? null;
    if (brandFontFile && /^https?:\/\//i.test(brandFontFile)) {
      try {
        const font = await downloadFile(brandFontFile, `brandfont_${Date.now()}.ttf`);
        brandFontFile = font.path;
        if (font.downloaded) tempFiles.push(font.path);
      } catch (error) {
        console.error('[Video Generator] Brand font fetch failed, using system font:', error);
        brandFontFile = null;
      }
    }

    // CJK/Devanagari need a Noto font; a Latin brand font can't render them, so
    // the language font wins for those scripts. Latin languages keep the brand
    // font (or the default, resolved inside buildCaptionFilter).
    const nonLatin = ['zh', 'ja', 'ko', 'hi'].includes(options.language ?? '');
    const captionFontFile = nonLatin
      ? resolveCaptionFontForLanguage(options.language)
      : brandFontFile;

    const captionStyle: CaptionStyle = {
      ...options.captionStyle,
      ...(branding?.captionColor ? { fontColor: branding.captionColor } : {}),
      ...(captionFontFile ? { fontFile: captionFontFile } : {}),
    };

    let textFilter = '';
    if (cues.length > 0 && options.captionAnimation === 'karaoke') {
      // One subtitles filter renders the whole word-by-word animation; a
      // per-word drawtext graph would blow past Windows' argv limit on any
      // video longer than a few sentences.
      const assPath = path.join(tempDir, `captions_${Date.now()}.ass`);
      fs.writeFileSync(
        assPath,
        buildKaraokeAss(cues, {
          width: outW,
          height: outH,
          highlightColor: branding?.captionColor ?? undefined,
          marginBottom: captionStyle.marginBottom,
          // libass resolves this family via fontconfig — Noto for CJK/Devanagari.
          fontName: captionFontFamilyForLanguage(options.language),
        }),
      );
      tempFiles.push(assPath);
      textFilter = `subtitles='${escapeFontPath(assPath)}'`;
    } else if (cues.length > 0) {
      textFilter = buildCaptionFilter(cues, captionStyle);
    }
    const watermarkFilter = branding?.watermarkText
      ? buildWatermarkFilter(branding.watermarkText)
      : '';

    // Drawn before the captions so a long address never sits on top of them.
    const lowerThirdFilter = options.lowerThird
      ? buildLowerThirdFilter(options.lowerThird, {
          fontFile: brandFontFile,
          // captionColor is already hex-validated by resolveBranding, so the
          // accent bar can safely reuse it and match the brand.
          accentColor: branding?.captionColor ?? undefined,
        })
      : '';

    // Split at the PiP boundary: `fit` must run before the presenter overlay,
    // but text (captions, lower third, watermark) must draw AFTER it — or the
    // presenter clip covers the captions (seen in a real frame, not theory).
    const preOverlayFilter = fit;
    const textOverlayFilter = [lowerThirdFilter, textFilter, watermarkFilter]
      .filter(Boolean)
      .join(',');

    const musicPath = options.musicPath ?? null;

    // Materialize the brand logo up front — it becomes an extra ffmpeg input.
    let logoPath: string | null = null;
    if (branding?.logoUrl) {
      try {
        const logo = await downloadFile(branding.logoUrl, `logo_${Date.now()}.png`);
        logoPath = logo.path;
        if (logo.downloaded) tempFiles.push(logo.path);
      } catch (error) {
        console.error('[Video Generator] Logo fetch failed, skipping (non-fatal):', error);
        logoPath = null;
      }
    }

    // Materialize the picture-in-picture presenter clip the same way.
    let pipPath: string | null = null;
    if (options.pip?.url) {
      try {
        const pip = await downloadFile(options.pip.url, `pip_${Date.now()}.mp4`);
        pipPath = pip.path;
        if (pip.downloaded) tempFiles.push(pip.path);
      } catch (error) {
        console.error('[Video Generator] PiP fetch failed, skipping (non-fatal):', error);
        pipPath = null;
      }
    }

    await new Promise<void>((resolve, reject) => {
      const command = ffmpeg().input(fileListPath).inputOptions(['-f concat', '-safe 0']);

      // Input indices: 0 = concatenated video, then voiceover, music, logo.
      let inputIndex = 0;
      let voiceIndex = -1;
      let musicIndex = -1;
      let logoIndex = -1;
      if (voiceoverPath) {
        command.input(voiceoverPath);
        voiceIndex = ++inputIndex;
      }
      if (musicPath) {
        // Loop a short track to cover the whole video; -t below bounds the output.
        command.input(musicPath).inputOptions(['-stream_loop -1']);
        musicIndex = ++inputIndex;
      }
      if (logoPath) {
        // A still image must loop, or it appears for a single frame.
        command.input(logoPath).inputOptions(['-loop 1']);
        logoIndex = ++inputIndex;
      }
      let pipIndex = -1;
      if (pipPath) {
        command.input(pipPath);
        pipIndex = ++inputIndex;
      }

      // ffmpeg accepts either -vf or -filter_complex, never both — so the video
      // chain lives in the complex graph now that audio needs one. The picture
      // builds in stages: fit -> +pip -> text (captions over the pip) -> +logo
      // -> pixel format.
      const filters: string[] = [];
      let vLabel = 'vbase';
      filters.push(`[0:v]${preOverlayFilter}[vbase]`);
      if (pipIndex > 0) {
        // Even width keeps yuv420p happy; height follows the clip's own ratio.
        const pipW = Math.max(2, Math.round((outW * (options.pip?.widthFraction ?? 0.28)) / 2) * 2);
        filters.push(`[${pipIndex}:v]scale=${pipW}:-2[pipv]`);
        // eof_action=pass: a presenter clip shorter than the video plays once
        // and yields — looping a talking head restarts their speech visually.
        filters.push(
          `[${vLabel}][pipv]overlay=${overlayPosition(options.pip?.position ?? 'bottom-right', 32)}:eof_action=pass[vpip]`,
        );
        vLabel = 'vpip';
      }
      if (textOverlayFilter) {
        filters.push(`[${vLabel}]${textOverlayFilter}[vtext]`);
        vLabel = 'vtext';
      }
      if (logoIndex > 0) {
        filters.push(`[${logoIndex}:v]format=rgba,colorchannelmixer=aa=${branding!.logoOpacity}[logo]`);
        filters.push(
          `[${vLabel}][logo]overlay=${overlayPosition(branding!.logoPosition)}:format=auto[vlogo]`,
        );
        vLabel = 'vlogo';
      }
      filters.push(`[${vLabel}]format=yuv420p[vout]`);

      // sidechaincompress requires both inputs in the same format.
      const AFMT = 'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo';

      /**
       * Gain only. Loudness normalisation belongs at BAKE time, not here:
       * `loudnorm` runs with a multi-second lookahead, which delays the music
       * relative to the sidechain key and lands the duck in the wrong place.
       * Our beds are normalised when generated (scripts/make-music-beds.ts),
       * and an uploaded track is normalised when it is uploaded.
       */
      const MUSIC_CHAIN = `${AFMT},volume=${musicVolume}`;

      if (voiceIndex > 0 && musicIndex > 0) {
        // Duck the music using the narration as the sidechain key.
        //
        // The key MUST be padded with silence: sidechaincompress stops as soon
        // as its sidechain input ends, which would kill the music the instant
        // narration finishes. Padding lets the compressor release back to full
        // volume and keep the music playing to the end of the video.
        filters.push(`[${voiceIndex}:a]${AFMT},asplit=2[vo][vokeyraw]`);
        filters.push(`[vokeyraw]apad[vokey]`);
        filters.push(`[${musicIndex}:a]${MUSIC_CHAIN}[mus]`);
        // level_sc boosts the DETECTOR's copy of the key, not the audio.
        //
        // Without it the compressor never fired: a narration at -35 dBFS sits
        // far below threshold=0.05 (~-26 dB), so the music was mixed at a
        // constant level and the "ducking" this project believed it had was an
        // amix artefact. With level_sc=4 a real voiceover ducks the bed by ~14 dB
        // and a quiet one still by ~2 dB, instead of by nothing at all.
        filters.push(
          `[mus][vokey]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400:level_sc=4[musduck]`,
        );
        // duration=longest keeps the (looped) music going past the narration.
        // normalize=0 is essential: amix otherwise divides every input by the
        // input count, quietly taking 6 dB off BOTH the voice and the music and
        // burying a bed that was already sitting politely underneath.
        filters.push(
          `[vo][musduck]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[aout]`,
        );
      } else if (voiceIndex > 0) {
        filters.push(`[${voiceIndex}:a]${AFMT}[aout]`);
      } else if (musicIndex > 0) {
        filters.push(`[${musicIndex}:a]${MUSIC_CHAIN}[aout]`);
      }

      const hasAudio = voiceIndex > 0 || musicIndex > 0;
      renderedHasAudio = hasAudio;
      const maps = hasAudio ? ['vout', 'aout'] : ['vout'];

      const outputOptions = [
        // Bound the output: music is looped infinitely, and -shortest is
        // unreliable for streams coming out of filter_complex.
        '-t', String(timelineDuration),
        '-c:v', 'libx264',
        // Draft previews trade quality for speed; exports stay slow/18.
        '-preset', renderQuality === 'draft' ? 'ultrafast' : 'slow',
        '-crf', renderQuality === 'draft' ? '30' : '18',
        '-r', '30',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-max_muxing_queue_size', '1024',
      ];

      if (hasAudio) {
        outputOptions.push('-c:a', 'aac', '-b:a', '192k');
      } else {
        outputOptions.push('-an');
      }

      command
        // complexFilter(), not outputOptions(['-vf', ...]): fluent splits an array
        // entry containing EXACTLY ONE space (custom.js: `split.length === 2`), so
        // a two-word caption like "Opening shot" tears the filter in half.
        .complexFilter(filters.join(';'), maps)
        .outputOptions(outputOptions)
        .output(outputPath)
        .on('progress', (p: any) => console.log(`[Video Generator] Assembly ${p.percent?.toFixed(1) || 0}%`))
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .run();
    });

    // Check the local file BEFORE persisting — persistGeneratedVideo deletes it
    // once uploaded, and there is nothing to inspect afterward.
    const quality = await runQualityGate(outputPath, {
      expectedDurationSec: timelineDuration,
      expectedWidth: outW,
      expectedHeight: outH,
      requireAudio: renderedHasAudio,
    });
    if (!quality.passed) {
      console.warn(
        `[Video Generator] Quality gate flagged this render (score ${quality.score}): ` +
          quality.issues.map((i) => i.message).join('; '),
      );
    }

    // Grab the poster frame BEFORE persisting — persistGeneratedVideo deletes
    // the local render once it is uploaded. Take it ~1s in, past any fade-in.
    const thumbnailUrl = await extractThumbnail(outputPath, Math.min(1, timelineDuration / 2));

    const videoUrl = await persistGeneratedVideo(outputPath, outputFilename);
    return { videoUrl, cues, thumbnailUrl, scenes, quality };
  } finally {
    // Always clean temp artifacts, even on failure. Never the caller's media —
    // a synthesized voiceover is already in tempFiles; an injected one is not,
    // and neither is the music track.
    for (const file of [...tempFiles, ...trimmed, fileListPath]) {
      if (!file) continue;
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch (error) {
        console.error('[Video Generator] Cleanup error:', error);
      }
    }
  }
}

/**
 * Full generation returning BOTH the video URL and the scene structure, so the
 * caller can persist scenes for later editing / re-rendering.
 */
export async function generateVideoWithScenes(
  options: GenerationOptions,
): Promise<{
  videoUrl: string;
  scenes: ResolvedScene[];
  cues: CaptionCue[];
  thumbnailUrl: string | null;
  quality: QualityReport;
}> {
  const {
    prompt,
    duration,
    addOns,
    aspectRatio = '16:9',
    mood,
    voiceId,
    branding,
    transition,
    userMedia = [],
  } = options;

  // A campaign variation reuses ONE pre-planned body across every variant, so
  // the only thing that differs between two variants is the axis being tested
  // (the hook, the CTA, the aspect ratio). Re-planning per variant would change
  // the body too and make the A/B test meaningless.
  let planned = options.presetScenes
    ? options.presetScenes.map((s) => ({ ...s }))
    : await planScenes(prompt, duration, options.language ?? 'en');
  if (planned.length === 0) throw new Error('Failed to plan any scenes from the script');

  // Hook / CTA overrides: swap ONLY the opening or closing line (and, for the
  // hook, its footage query, so the picture matches the new words).
  if (options.hookNarration && planned.length > 0) {
    planned[0] = {
      ...planned[0],
      narration: options.hookNarration,
      ...(options.hookSearchQuery ? { searchQuery: options.hookSearchQuery } : {}),
    };
  }
  if (options.ctaNarration && planned.length > 0) {
    const last = planned.length - 1;
    planned[last] = { ...planned[last], narration: options.ctaNarration };
  }

  if (options.mediaOnly) {
    if (userMedia.length === 0) {
      throw new Error('mediaOnly was requested but no media was supplied');
    }
    // Trim the plan to the assets, then re-spread the runtime over what is left.
    planned = normalizeSceneDurations(clampScenesToMedia(planned, userMedia.length), duration);
  }

  const resolved = await resolveSceneClips(
    planned,
    aspectRatio,
    userMedia,
    new Set(options.excludeClipUrls ?? []),
  );

  // Music is opt-out. The user's own track wins; otherwise fall back to the
  // bundled library, which is silently skipped when empty (no track is licensed).
  const wantMusic = !addOns || addOns.length === 0 || addOns.includes('music');
  const musicPath = wantMusic
    ? options.musicPath ?? selectMusicPath(mood ?? options.style)
    : null;

  const assembleOptions = {
    musicPath,
    voiceId,
    branding,
    transition,
    language: options.language,
    renderQuality: options.renderQuality,
    voiceoverPath: options.voiceoverPath ?? null,
    lowerThird: options.lowerThird ?? null,
    pip: options.pip ?? null,
    forgeVidEndCard: options.forgeVidEndCard,
    ...(options.captionPreset
      ? {
          captionStyle: CAPTION_PRESETS[options.captionPreset],
          captionAnimation: options.captionPreset === 'karaoke' ? ('karaoke' as const) : null,
        }
      : {}),
  };

  let assembled = await assembleVideo(resolved, addOns || [], aspectRatio, assembleOptions);

  // One targeted retry: when the gate localizes black/frozen frames to
  // specific scenes, swap just those scenes' stock clip and re-assemble once.
  // Never swaps a scene backed by the user's OWN media — a different pick
  // isn't available, and a bad upload is the user's input, not ours to fix.
  // A duration/resolution/audio-stream issue isn't scene-local, so there is
  // nothing to swap for those; they pass through unretried.
  if (!assembled.quality.passed) {
    const flagged = [...scenesForIssues(resolved, assembled.quality.issues)].filter(
      (idx) => resolved[idx] && !userMedia[resolved[idx].index],
    );
    if (flagged.length > 0) {
      console.warn(
        `[Video Generator] Quality gate retry: re-picking footage for scene(s) ` +
          flagged.map((i) => i + 1).join(', '),
      );
      const retryResolved = [...resolved];
      for (const idx of flagged) {
        const swapped = await resolveSceneClip(
          planned[idx],
          new Set([...(options.excludeClipUrls ?? []), resolved[idx].clipUrl]),
          aspectRatio,
        );
        if (swapped) retryResolved[idx] = swapped;
      }
      const retryAssembled = await assembleVideo(retryResolved, addOns || [], aspectRatio, assembleOptions);
      // Keep the retry only if it's no worse — a flaky gate check shouldn't
      // discard a render that was actually fine.
      if (retryAssembled.quality.score >= assembled.quality.score) {
        assembled = retryAssembled;
      }
    }
  }

  console.log(
    `[Video Generator] ✅ Generated ${aspectRatio} video with ${assembled.scenes.length} scenes` +
      (assembled.quality.passed ? '' : ` (quality gate: ${assembled.quality.score}/100)`),
  );
  // Return the scenes as RENDERED (narration-paced durations, per-scene thumbs)
  // so what gets persisted matches the video.
  return {
    videoUrl: assembled.videoUrl,
    scenes: assembled.scenes,
    cues: assembled.cues,
    thumbnailUrl: assembled.thumbnailUrl,
    quality: assembled.quality,
  };
}

/** Backwards-compatible wrapper returning just the URL. */
export async function generateVideoFromPrompt(options: GenerationOptions): Promise<string> {
  const { videoUrl } = await generateVideoWithScenes(options);
  return videoUrl;
}

export type { CaptionCue } from './captions';

/** Remove generated/temp files older than 24h. */
export function cleanupOldVideos() {
  const generatedDir = path.join(process.cwd(), 'public', 'generated');
  const tempDir = path.join(process.cwd(), 'public', 'temp');

  const cleanDirectory = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;

    for (const file of fs.readdirSync(dir)) {
      const filepath = path.join(dir, file);
      try {
        if (now - fs.statSync(filepath).mtimeMs > maxAge) {
          fs.unlinkSync(filepath);
        }
      } catch (error) {
        console.error(`[Video Generator] Failed to cleanup ${file}:`, error);
      }
    }
  };

  cleanDirectory(generatedDir);
  cleanDirectory(tempDir);
}
