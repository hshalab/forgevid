/**
 * Captions.
 *
 * The pipeline used to burn in each scene's *description* over that scene's
 * time span — not the spoken narration, and not aligned to speech. Real
 * captions come from transcribing the voiceover with Whisper.
 *
 * Degrades cleanly: with no OPENAI_API_KEY (or no voiceover) we fall back to
 * scene-description cues, which is exactly the old behaviour.
 *
 * Relative imports only — reachable from the worker process.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { hasOpenAiKey, openAiApiKey } from './openai-key';
import { resolveFfmpegPath } from './ffmpeg-env';
import type * as fsTypes from 'fs';
import { withProviderReliability } from './provider-reliability';

/** Whisper rejects anything over 25MB with a 413. */
const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Whisper's hard limit is 25MB, but a narration upload may be 50MB and a
 * rendered video far more. Speech needs none of that: 16 kHz mono at 64 kbps
 * loses nothing Whisper uses, and shrinks an hour of audio to ~30MB — so this
 * also strips the video stream, which is the usual reason a file is huge.
 *
 * Returns a temp path the caller must delete, or null if the file is fine as-is.
 * Without this, captions failed silently on exactly the long recordings people
 * pay to have captioned.
 */
function compressForWhisper(inputPath: string): string | null {
  let size = 0;
  try {
    size = fs.statSync(inputPath).size;
  } catch {
    return null;
  }
  if (size <= WHISPER_MAX_BYTES) return null;

  const out = path.join(os.tmpdir(), `whisper_${Date.now()}.mp3`);
  const result = spawnSync(
    resolveFfmpegPath(),
    ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', out],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0 || !fs.existsSync(out)) {
    console.error('[Captions] Could not compress audio for Whisper; sending as-is.');
    return null;
  }
  return out;
}

export interface CaptionWord {
  word: string;
  /** Seconds from the start of the video. */
  start: number;
  end: number;
}

/**
 * Caption text repair for transcribed narration. Mutates cues in place; also
 * covers SRT/VTT export, which reads the same cues.
 *
 * 1. URLS — narrations write "ForgeVid dot com" ("punto com" in Spanish) so
 *    the TTS pronounces them naturally; captions must read "ForgeVid.com".
 *    Fixed in cue TEXT by regex and in the word-timing arrays by merging the
 *    spoken words into one timed word. Whisper sometimes omits "dot"/"punto"
 *    from its WORD list while keeping it in the text, so the word merge is
 *    text-driven: any (W, com) word pair whose normalized text contains
 *    "W.com" merges too.
 * 2. BRAND — Whisper mishears "ForgeVid" (a made-up word), e.g. "forgebeat"
 *    in Spanish. Known mishearings are rewritten to the real brand in both
 *    text and words.
 */
export function normalizeSpokenUrls(cues: CaptionCue[]): void {
  const TEXT_RE = /(\S+?)[,.]?\s+(?:dot|punto)[,.]?\s+com\b/gi;
  // Kryst brands as Whisper mishears/splits them. Each entry fixes running
  // text; two-word splits ("ring yield") also need their karaoke WORDS merged.
  const BRAND_FIXES: Array<{ re: RegExp; to: string }> = [
    { re: /\bforge[\s-]?(?:vid|vids|bid|bit|beat|bead|bed|beed|feed|fit|vit)\b/gi, to: 'ForgeVid' },
    { re: /\bring[\s-]?(?:yield|yields|yielded|shield)\b/gi, to: 'RingYield' },
    { re: /\bneuro[\s-]?(?:hires?|higher|hides)\b/gi, to: 'NeuroHires' },
  ];
  const isDot = (w: string) => /^(dot|punto)[.,]?$/i.test(w);
  const isCom = (w: string) => /^com[.,!?]*$/i.test(w);
  const stripPunct = (w: string) => w.replace(/[.,!?]+$/, '');
  const applyBrandFixes = (s: string) => BRAND_FIXES.reduce((v, b) => v.replace(b.re, b.to), s);
  const BRAND_NAMES = new Set(BRAND_FIXES.map((b) => b.to.toLowerCase()));
  /** Anchored (whole-string) versions of the brand patterns, for pair merging. */
  const BRAND_PAIR_RES = BRAND_FIXES.map(
    (b) => new RegExp(`^${b.re.source.replace(/\\b/g, '')}$`, 'i'),
  );
  // Whisper sometimes drops the spoken "dot"/"punto" ENTIRELY ("RingYield com")
  // — for our known brands, brand + "com" is unambiguous.
  const BRAND_COM_RE = new RegExp(`\\b(${BRAND_FIXES.map((b) => b.to).join('|')})[,.]?\\s+com\\b`, 'gi');

  for (const cue of cues) {
    cue.text = applyBrandFixes(cue.text.replace(TEXT_RE, '$1.com')).replace(BRAND_COM_RE, '$1.com');

    if (cue.words) {
      // Two-word brand splits: merge ("ring","yield") into one timed word so
      // the karaoke highlight covers the whole name, then brand-fix spelling.
      // Anchored full-pair match — a substring test would swallow the NEXT
      // word too ("Ring yield" + "com" -> "Ring yield com").
      for (let i = 0; i < cue.words.length - 1; i++) {
        const pair = `${stripPunct(cue.words[i].word)} ${stripPunct(cue.words[i + 1].word)}`;
        if (BRAND_PAIR_RES.some((re) => re.test(pair))) {
          const trailing = cue.words[i + 1].word.match(/[.,!?]+$/)?.[0] ?? '';
          cue.words[i].word = pair + trailing;
          cue.words[i].end = cue.words[i + 1].end;
          cue.words.splice(i + 1, 1);
          i -= 1;
        }
      }
      // Brand-fix the words FIRST so the text-driven merge below compares
      // like-for-like (the text has already been brand-fixed).
      for (const w of cue.words) {
        w.word = applyBrandFixes(w.word);
      }

      for (let i = 0; i < cue.words.length - 1; i++) {
        const a = cue.words[i];
        const b = cue.words[i + 1];
        const c = cue.words[i + 2];

        // "X" + "dot|punto" + "com" -> one timed word "X.com"
        if (c && isDot(b.word) && isCom(c.word)) {
          const trailing = c.word.match(/[.,!?]+$/)?.[0] ?? '';
          a.word = `${stripPunct(a.word)}.com${trailing}`;
          a.end = c.end;
          cue.words.splice(i + 1, 2);
          i -= 1;
          continue;
        }

        // Whisper dropped the "dot"/"punto" WORD but kept it in the text
        // ("X" + "com" where the normalized text contains "X.com"), or dropped
        // it EVERYWHERE but X is one of our brands (brand + "com" is
        // unambiguous) -> merge.
        if (
          isCom(b.word) &&
          (cue.text.toLowerCase().includes(`${stripPunct(a.word).toLowerCase()}.com`) ||
            BRAND_NAMES.has(stripPunct(a.word).toLowerCase()))
        ) {
          const trailing = b.word.match(/[.,!?]+$/)?.[0] ?? '';
          a.word = `${stripPunct(a.word)}.com${trailing}`;
          a.end = b.end;
          cue.words.splice(i + 1, 1);
          i -= 1;
        }
      }
    }
  }
}

export interface CaptionCue {
  /** Seconds from the start of the video. */
  start: number;
  end: number;
  text: string;
  /**
   * Word-level timing inside this cue (Whisper word granularity). Present only
   * on transcribed cues; scene-fallback cues have none. Powers the karaoke
   * caption style — absent words degrade cleanly to static captions.
   */
  words?: CaptionWord[];
}

export interface CaptionStyle {
  fontSize?: number;
  /** Distance from the bottom of the frame, in pixels. */
  marginBottom?: number;
  /** Wrap text at roughly this many characters per line. */
  maxCharsPerLine?: number;
  /** Text colour. Must be a validated hex value — it goes into a filtergraph. */
  fontColor?: string;
  /** Override the resolved system font (brand kit typeface). */
  fontFile?: string | null;
  /**
   * Opacity of the scrim drawn behind the text, 0..1. Zero disables it.
   *
   * A 2px black outline is enough over stock footage and useless over a white
   * kitchen — which is most of a real-estate listing. A scrim is the only thing
   * that keeps captions legible on *any* frame.
   */
  boxOpacity?: number;
  /** Scrim colour. Goes into a filtergraph, so keep it a named colour or hex. */
  boxColor?: string;
}

/** Named presets so callers don't hand-tune pixel values. */
export const CAPTION_PRESETS: Record<string, CaptionStyle> = {
  default: { fontSize: 28, marginBottom: 60, maxCharsPerLine: 42 },
  large: { fontSize: 40, marginBottom: 80, maxCharsPerLine: 32 },
  subtle: { fontSize: 22, marginBottom: 40, maxCharsPerLine: 52 },
  // Karaoke sizes itself from the frame (buildKaraokeAss); margin still applies.
  karaoke: { marginBottom: 80 },
};

/** The caption looks a user can pick at generation time. */
export type CaptionPresetName = 'default' | 'large' | 'subtle' | 'karaoke';

export function isCaptionPreset(value: unknown): value is CaptionPresetName {
  return value === 'default' || value === 'large' || value === 'subtle' || value === 'karaoke';
}

/**
 * Transcribe an audio file into timed cues with Whisper.
 * Returns null when transcription is unavailable — never throws the job away.
 */
export async function transcribeToCues(audioPath: string): Promise<CaptionCue[] | null> {
  if (!hasOpenAiKey()) {
    console.log('[Captions] No OPENAI_API_KEY — cannot transcribe, using scene captions');
    return null;
  }
  if (!fs.existsSync(audioPath)) return null;

  try {
    const { OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: openAiApiKey() });

    // A 50MB narration upload is legal here but a 413 at Whisper. Shrink first.
    const compressed = compressForWhisper(audioPath);
    const sendPath = compressed ?? audioPath;
    let result: any;
    try {
      result = await withProviderReliability('openai', () => openai.audio.transcriptions.create({
        file: fs.createReadStream(sendPath) as any,
        model: 'whisper-1',
        response_format: 'verbose_json',
        // Word timing costs nothing extra and powers the karaoke caption style.
        timestamp_granularities: ['word', 'segment'],
      }));
    } finally {
      if (compressed) fs.rmSync(compressed, { force: true });
    }

    const segments = Array.isArray(result?.segments) ? result.segments : [];
    const allWords: CaptionWord[] = (Array.isArray(result?.words) ? result.words : [])
      .map((w: any) => ({
        word: String(w.word ?? '').trim(),
        start: Number(w.start) || 0,
        end: Number(w.end) || 0,
      }))
      .filter((w: CaptionWord) => w.word.length > 0);

    // Partition words over segments SEQUENTIALLY (two pointers). The previous
    // midpoint filter dropped words straddling a segment boundary (a real
    // Spanish render lost "punto" this way, breaking the url merge); here every
    // word lands in exactly one cue — the last segment sweeps up any remainder.
    let wi = 0;
    const cues: CaptionCue[] = segments
      .map((s: any, si: number) => {
        const start = Number(s.start) || 0;
        const end = Number(s.end) || 0;
        const isLast = si === segments.length - 1;
        const words: CaptionWord[] = [];
        while (wi < allWords.length && (isLast || allWords[wi].start < end)) {
          words.push(allWords[wi]);
          wi++;
        }
        return {
          start,
          end,
          text: String(s.text ?? '').trim(),
          ...(words.length > 0 ? { words } : {}),
        };
      })
      .filter((c: CaptionCue) => c.text.length > 0 && c.end > c.start);

    normalizeSpokenUrls(cues);

    if (cues.length === 0) return null;
    console.log(`[Captions] Transcribed ${cues.length} cues from the voiceover`);
    return cues;
  } catch (error) {
    console.error('[Captions] Transcription failed, falling back to scene captions:', error);
    return null;
  }
}

/**
 * Transcribe an audio file to plain text with Whisper.
 * Returns null when unavailable — callers decide how to fail.
 */
export async function transcribeAudioToText(audioPath: string): Promise<string | null> {
  if (!hasOpenAiKey()) return null;
  if (!fs.existsSync(audioPath)) return null;

  try {
    const { OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: openAiApiKey() });

    const compressed = compressForWhisper(audioPath);
    const sendPath = compressed ?? audioPath;
    let result: any;
    try {
      result = await withProviderReliability('openai', () => openai.audio.transcriptions.create({
        file: fs.createReadStream(sendPath) as any,
        model: 'whisper-1',
        response_format: 'text',
      }));
    } finally {
      if (compressed) fs.rmSync(compressed, { force: true });
    }

    const text = typeof result === 'string' ? result : String(result?.text ?? '');
    return text.trim() || null;
  } catch (error) {
    console.error('[Captions] Audio transcription failed:', error);
    return null;
  }
}

/** Fallback cues: one per scene, spanning that scene. Mirrors the old behaviour. */
export function cuesFromScenes(
  scenes: Array<{ description: string; duration: number }>,
): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let t = 0;
  for (const scene of scenes) {
    cues.push({ start: t, end: t + scene.duration, text: scene.description });
    t += scene.duration;
  }
  return cues;
}

/**
 * Push every cue later by `offsetSeconds`.
 *
 * Cue times are relative to the scenes. Anything prepended to the render (a
 * brand intro) delays the narration, so without this every caption fires early.
 */
export function shiftCues(cues: CaptionCue[], offsetSeconds: number): CaptionCue[] {
  if (!offsetSeconds) return cues;
  return cues.map((c) => ({
    ...c,
    start: c.start + offsetSeconds,
    end: c.end + offsetSeconds,
    ...(c.words
      ? {
          words: c.words.map((w) => ({
            ...w,
            start: w.start + offsetSeconds,
            end: w.end + offsetSeconds,
          })),
        }
      : {}),
  }));
}

/** Greedy word wrap so long cues don't run off the frame. */
export function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line.length === 0) {
      line = word;
    } else if (line.length + 1 + word.length <= maxCharsPerLine) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Escape a value for FFmpeg's `drawtext=text='...'` .
 *
 * Inside single quotes a comma is literal, but a backslash, a colon and a
 * literal single quote are not, and `%` starts a strftime expansion. We drop
 * apostrophes rather than trying to re-open the quoted string.
 */
export function escapeDrawText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '')
    .replace(/%/g, '%%')
    .replace(/:/g, '\\:');
}

/**
 * Where to look for a caption font, in order.
 *
 * drawtext without an explicit `fontfile` relies on fontconfig finding a
 * "Sans" family. That works on a desktop but a slim container (our Dockerfile
 * is node:18-alpine) ships no fonts at all, so rendering would die with
 * "Cannot find a valid font". Pin an explicit file instead.
 */
/** Directories distros keep fonts in. Searched, not assumed. */
const FONT_DIRS = [
  '/usr/share/fonts',
  '/usr/local/share/fonts',
  '/System/Library/Fonts',
  '/Library/Fonts',
  'C:/Windows/Fonts',
];

/** Preferred faces, best first. Anything else is a last resort. */
const PREFERRED = [
  'dejavusans.ttf',
  'liberationsans-regular.ttf',
  'notosans-regular.ttf',
  'arial.ttf',
  'freesans.ttf',
];

/** Shallow-recursive .ttf search — distros nest fonts one or two levels deep. */
function findTtfFiles(dir: string, depth = 2): string[] {
  if (depth < 0 || !fs.existsSync(dir)) return [];
  let found: string[] = [];
  let entries: fsTypes.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found = found.concat(findTtfFiles(full, depth - 1));
    else if (/\.ttf$/i.test(entry.name)) found.push(full);
  }
  return found;
}

let cachedFont: string | null | undefined;

/**
 * Locate a usable caption font. Order: CAPTION_FONT_FILE, then a preferred face
 * found under any known font dir, then any .ttf at all. Cached.
 *
 * Searching beats hardcoding paths: Alpine, Debian and macOS all nest fonts
 * differently, and Alpine has moved the DejaVu package's install location.
 * Env is read lazily — the worker loads .env after this module is imported.
 */
export function resolveCaptionFontFile(): string | null {
  if (cachedFont !== undefined) return cachedFont;

  const explicit = process.env.CAPTION_FONT_FILE;
  if (explicit && fs.existsSync(explicit)) {
    cachedFont = explicit;
    return cachedFont;
  }

  const all = FONT_DIRS.flatMap((dir) => findTtfFiles(dir));
  const byPreference = PREFERRED.map((name) =>
    all.find((p) => p.toLowerCase().endsWith(`/${name}`)),
  ).find(Boolean);

  cachedFont = byPreference ?? all[0] ?? null;

  if (!cachedFont) {
    console.error(
      '[Captions] No caption font found — captions will be omitted. ' +
        'Install one (alpine: `apk add font-dejavu`) or set CAPTION_FONT_FILE.',
    );
  }
  return cachedFont;
}

/** Test hook: drop the cache so a changed CAPTION_FONT_FILE is picked up. */
export function __resetFontCache() {
  cachedFont = undefined;
}

/**
 * libass/font family per non-Latin script. The bundled DejaVu font has no
 * CJK/Devanagari glyphs, so these languages need Noto (installed in the Docker
 * image). Latin languages fall through to the default font.
 */
const LANG_FONT_FAMILY: Record<string, string> = {
  zh: 'Noto Sans CJK SC',
  ja: 'Noto Sans CJK JP',
  ko: 'Noto Sans CJK KR',
  hi: 'Noto Sans Devanagari',
};

const langFontCache = new Map<string, string | null>();

/** Font-FAMILY name to put in an ASS style (karaoke) for `language`. libass
 *  resolves it through fontconfig, so only the installed name matters. */
export function captionFontFamilyForLanguage(language?: string): string {
  return (language && LANG_FONT_FAMILY[language]) || 'DejaVu Sans';
}

/**
 * Font FILE for a language's script, for drawtext (which needs a path, not a
 * family). CJK/Devanagari resolve via fontconfig (fc-match) because Noto ships
 * as .ttc/.otf that resolveCaptionFontFile's .ttf scan misses; Latin languages
 * use the default caption font. Cached per language.
 */
export function resolveCaptionFontForLanguage(language?: string): string | null {
  const family = language ? LANG_FONT_FAMILY[language] : undefined;
  if (!family) return resolveCaptionFontFile();
  if (langFontCache.has(language!)) return langFontCache.get(language!)!;

  let file: string | null = null;
  try {
    const r = spawnSync('fc-match', ['-f', '%{file}', family], { encoding: 'utf8' });
    const out = (r.stdout ?? '').trim();
    if (out && fs.existsSync(out)) file = out;
  } catch {
    // fontconfig unavailable — fall back to the default font below.
  }
  const resolved = file ?? resolveCaptionFontFile();
  langFontCache.set(language!, resolved);
  return resolved;
}

/**
 * A path inside a filtergraph: `:` separates filter options, and a Windows
 * path is full of them (`C:\...`). Forward slashes + escaped colons, quoted.
 */
export function escapeFontPath(fontPath: string): string {
  return fontPath.replace(/\\/g, '/').replace(/:/g, '\\:');
}

function fmtTime(seconds: number, sep: ',' | '.'): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms, 3)}`;
}

export function cuesToSrt(cues: CaptionCue[]): string {
  return (
    cues
      .map((c, i) => `${i + 1}\n${fmtTime(c.start, ',')} --> ${fmtTime(c.end, ',')}\n${c.text}`)
      .join('\n\n') + '\n'
  );
}

export function cuesToVtt(cues: CaptionCue[]): string {
  return (
    'WEBVTT\n\n' +
    cues
      .map((c) => `${fmtTime(c.start, '.')} --> ${fmtTime(c.end, '.')}\n${c.text}`)
      .join('\n\n') +
    '\n'
  );
}

/** ASS timestamps use centiseconds: h:mm:ss.cc */
function fmtAssTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.round((clamped - Math.floor(clamped)) * 100);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/** #RRGGBB -> ASS &HAABBGGRR (note: ASS is BGR). Falls back on bad input. */
function hexToAss(hex: string | undefined, fallback: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex ?? '');
  if (!m) return fallback;
  const rr = m[1].slice(0, 2);
  const gg = m[1].slice(2, 4);
  const bb = m[1].slice(4, 6);
  return `&H00${bb}${gg}${rr}`.toUpperCase();
}

export interface KaraokeOptions {
  /** Output frame size — ASS positions/sizes are in these coordinates. */
  width: number;
  height: number;
  /** Highlight colour for the active word (#RRGGBB). Default: gold. */
  highlightColor?: string;
  /** Distance from the bottom of the frame, in pixels. */
  marginBottom?: number;
  fontSize?: number;
  /** libass font family (e.g. "Noto Sans CJK JP" for Japanese). Default DejaVu. */
  fontName?: string;
}

/**
 * Word-by-word "karaoke" captions as an ASS file for the `subtitles` filter.
 *
 * Reels/TikTok-style: bold centered lines where each word lights up exactly as
 * it is spoken, driven by Whisper's word timestamps. ASS `\k` tags flip a word
 * from SecondaryColour (white) to PrimaryColour (the highlight) natively in
 * libass, so the whole animation costs ONE subtitles filter — no drawtext
 * explosion, no per-word filter graph.
 *
 * Cues without word timing (scene-fallback captions) are rendered as plain
 * static lines in the same style, so a partial transcription still ships.
 */
export function buildKaraokeAss(cues: CaptionCue[], opts: KaraokeOptions): string {
  const fontSize = opts.fontSize ?? Math.round(opts.height * 0.055);
  const marginV = opts.marginBottom ?? Math.round(opts.height * 0.08);
  const marginH = Math.round(opts.width * 0.06);
  const highlight = hexToAss(opts.highlightColor, '&H0000D7FF'); // gold FFD700 in BGR
  // ASS font-family names must not contain commas (they'd split the style row).
  const fontName = (opts.fontName || 'DejaVu Sans').replace(/,/g, ' ');

  // \k measures from the END of the previous tag, so each word's duration runs
  // to the NEXT word's start — gaps between words stay highlighted rather than
  // flickering back and forth.
  const sanitize = (t: string) => t.replace(/[{}\\]/g, '').trim();

  const events = cues
    .map((cue) => {
      const words = (cue.words ?? []).filter((w) => sanitize(w.word).length > 0);
      if (words.length === 0) {
        const text = sanitize(cue.text);
        if (!text) return null;
        return `Dialogue: 0,${fmtAssTime(cue.start)},${fmtAssTime(cue.end)},Karaoke,,0,0,0,,${text}`;
      }
      const start = words[0].start;
      const end = Math.max(cue.end, words[words.length - 1].end);
      const body = words
        .map((w, i) => {
          const until = i + 1 < words.length ? words[i + 1].start : end;
          const cs = Math.max(1, Math.round((until - w.start) * 100));
          return `{\\k${cs}}${sanitize(w.word)}`;
        })
        .join(' ');
      return `Dialogue: 0,${fmtAssTime(start)},${fmtAssTime(end)},Karaoke,,0,0,0,,${body}`;
    })
    .filter(Boolean)
    .join('\n');

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${opts.width}`,
    `PlayResY: ${opts.height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Primary = the ACTIVE (already-sung) colour, Secondary = upcoming words.
    `Style: Karaoke,${fontName},${fontSize},${highlight},&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,${marginH},${marginH},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    events,
    '',
  ].join('\n');
}

/**
 * Build a drawtext filter chain that burns `cues` into the video.
 *
 * drawtext rather than the `subtitles` filter: no libass dependency in the
 * deploy image, and no filtergraph-escaping of a Windows `C:\...` path.
 * Returns '' when there is nothing to draw.
 */
export function buildCaptionFilter(cues: CaptionCue[], style: CaptionStyle = {}): string {
  const {
    fontSize = 28,
    marginBottom = 60,
    maxCharsPerLine = 42,
    fontColor = 'white',
    boxOpacity = 0.55,
    boxColor = 'black',
  } = { ...CAPTION_PRESETS.default, ...style };

  // A brand typeface wins, but only if it actually exists on disk.
  const brandFont = style.fontFile && fs.existsSync(style.fontFile) ? style.fontFile : null;
  // Without a font, drawtext aborts the whole render. Drop the captions instead
  // of losing the video; resolveCaptionFontFile() has already logged how to fix it.
  const font = brandFont ?? resolveCaptionFontFile();
  if (!font) return '';
  const fontOpt = `fontfile='${escapeFontPath(font)}':`;

  const opacity = Math.min(Math.max(boxOpacity, 0), 1);
  const boxed = opacity > 0;
  const boxBorder = 6;
  // drawtext draws ONE box per line. Give the lines enough room that adjacent
  // boxes never overlap — where they do, the alpha compounds and you get a
  // darker band across the middle of the caption.
  const lineGap = fontSize + (boxed ? boxBorder * 2 + 6 : 8);
  const boxOpt = boxed
    ? `box=1:boxcolor=${boxColor}@${opacity.toFixed(2)}:boxborderw=${boxBorder}:`
    : '';

  const filters: string[] = [];

  for (const cue of cues) {
    const lines = wrapText(cue.text, maxCharsPerLine);
    lines.forEach((line, lineIndex) => {
      // Stack lines upward from the bottom margin.
      const yOffset = marginBottom + (lines.length - 1 - lineIndex) * lineGap;
      filters.push(
        `drawtext=${fontOpt}text='${escapeDrawText(line)}':fontsize=${fontSize}:fontcolor=${fontColor}:` +
          `${boxOpt}borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-${yOffset}:` +
          `enable='between(t\\,${cue.start.toFixed(3)}\\,${cue.end.toFixed(3)})'`,
      );
    });
  }

  return filters.join(',');
}

/**
 * A persistent watermark in the top-right corner (free plans).
 * Returns '' when no font is available, so a missing font never kills a render.
 */
export function buildWatermarkFilter(text: string, fontSize = 22): string {
  const font = resolveCaptionFontFile();
  if (!font) return '';
  return (
    `drawtext=fontfile='${escapeFontPath(font)}':text='${escapeDrawText(text)}':` +
    `fontsize=${fontSize}:fontcolor=white@0.85:borderw=1:bordercolor=black@0.6:` +
    `x=w-text_w-20:y=20`
  );
}
