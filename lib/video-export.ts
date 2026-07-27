/**
 * Timeline renderer for the editor.
 *
 * The previous implementation treated `clip.assetId` as a filesystem path and
 * silently skipped anything that failed `fs.existsSync` — every asset lives on
 * a CDN, so real exports rendered nothing. It also built filter labels that
 * were never mapped to the output, ignored text tracks, and leaked temp files.
 *
 * This version composites for real:
 *   1. normalize each video clip to a common codec/size/fps intermediate
 *      (trimmed, gaps filled with black so timeline timing is preserved)
 *   2. concat those intermediates (concat demuxer)
 *   3. one final pass: drawtext overlays for text clips + adelay/amix of the
 *      audio tracks, then encode to the requested format/quality
 *
 * Callers pass resolved media URLs (or local paths) — this module does no DB
 * access, so it can run inside the worker process.
 *
 * Known scope limit: audio embedded in video clips is dropped; audio comes from
 * audio tracks. Multi-video-track layering (picture-in-picture) is not composited.
 */

import fs from 'fs';
import path from 'path';
import { safeFetch } from './safe-fetch';
import {
  buildWatermarkFilter,
  escapeDrawText,
  escapeFontPath,
  resolveCaptionFontFile,
} from './captions';
import { resolveFfmpegPath } from './ffmpeg-env';

let ffmpeg: any;

async function getFFmpeg() {
  if (!ffmpeg) {
    const fluentFfmpeg = await import('fluent-ffmpeg');
    ffmpeg = fluentFfmpeg.default;
    // Prefer a system ffmpeg over the bundled 2018 build (see lib/ffmpeg-env.ts).
    ffmpeg.setFfmpegPath(resolveFfmpegPath());
  }
  return ffmpeg;
}

export interface ExportSettings {
  format: 'mp4' | 'mov' | 'webm';
  quality: 'sd' | 'hd' | '4k';
  fps: number;
  /**
   * Burned-in watermark for free plans. Resolved SERVER-SIDE from the video
   * owner's plan — without this, the editor export was a clean-video loophole
   * around the generation path's plan gate.
   */
  watermarkText?: string | null;
  preset?:
    | 'social-youtube'
    | 'social-tiktok'
    | 'social-instagram'
    | 'social-facebook'
    | 'social-twitter'
    | 'social-linkedin'
    | 'custom';
}

/** A timeline clip whose media has already been resolved to a URL or local path. */
export interface ExportClip {
  id: string;
  /** Remote URL or absolute local path. Not required for text clips. */
  source?: string;
  /** Seconds on the timeline. */
  startTime: number;
  /** Seconds of timeline occupied. */
  duration: number;
  /** Seconds into the source to start from. */
  trimStart?: number;
  muted?: boolean;
  /** Text clips only. */
  text?: string;
}

export interface ExportTrack {
  id: string;
  type: 'video' | 'audio' | 'text';
  clips: ExportClip[];
  muted?: boolean;
}

interface EncodingSettings {
  size: string;
  fps: number;
  videoCodec: string;
  audioCodec: string;
  videoBitrate: string;
  audioBitrate: string;
  ffmpegPreset: string;
}

/** Resolve codec/size/bitrate from the requested quality or social preset. */
export function getEncodingSettings(settings: ExportSettings): EncodingSettings {
  const base = {
    fps: settings.fps || 30,
    videoCodec: settings.format === 'webm' ? 'libvpx-vp9' : 'libx264',
    audioCodec: settings.format === 'webm' ? 'libopus' : 'aac',
  };

  switch (settings.preset) {
    case 'social-youtube':
      return { ...base, size: '1920x1080', videoBitrate: '8M', audioBitrate: '192k', ffmpegPreset: 'fast' };
    case 'social-tiktok':
      return { ...base, size: '1080x1920', videoBitrate: '5M', audioBitrate: '128k', ffmpegPreset: 'fast' };
    case 'social-instagram':
      return { ...base, size: '1080x1080', videoBitrate: '5M', audioBitrate: '128k', ffmpegPreset: 'fast' };
    case 'social-facebook':
      return { ...base, size: '1920x1080', videoBitrate: '6M', audioBitrate: '160k', ffmpegPreset: 'fast' };
    case 'social-twitter':
      return { ...base, size: '1280x720', videoBitrate: '4M', audioBitrate: '128k', ffmpegPreset: 'fast' };
    case 'social-linkedin':
      return { ...base, size: '1920x1080', videoBitrate: '6M', audioBitrate: '160k', ffmpegPreset: 'fast' };
  }

  switch (settings.quality) {
    case '4k':
      return { ...base, size: '3840x2160', videoBitrate: '20M', audioBitrate: '192k', ffmpegPreset: 'slow' };
    case 'hd':
      return { ...base, size: '1920x1080', videoBitrate: '5M', audioBitrate: '128k', ffmpegPreset: 'medium' };
    case 'sd':
    default:
      return { ...base, size: '1280x720', videoBitrate: '2M', audioBitrate: '96k', ffmpegPreset: 'fast' };
  }
}

function tempDir(): string {
  const dir = path.join(process.cwd(), 'public', 'temp');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isRemote(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

/** Fetch a remote asset into temp; local paths are returned as-is. */
async function materialize(source: string, hint: string): Promise<string> {
  if (!isRemote(source)) {
    if (!fs.existsSync(source)) {
      throw new Error(`Asset not found on disk: ${source}`);
    }
    return source;
  }

  const filepath = path.join(tempDir(), `asset_${Date.now()}_${hint}`);
  const response = await safeFetch(source, {
    maxBytes: 250 * 1024 * 1024,
    timeoutMs: 30_000,
    acceptTypes: ['image', 'video', 'audio', 'application/octet-stream'],
  });
  fs.writeFileSync(filepath, response.body);
  return filepath;
}

function runFfmpeg(build: (cmd: any) => any): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = build(ffmpeg());
    cmd
      .on('end', () => resolve())
      .on('error', (err: Error, _stdout: string, stderr: string) =>
        reject(new Error(`${err.message}${stderr ? `\n${stderr}` : ''}`)),
      )
      .run();
  });
}


/** Normalize one video clip (trimmed) to a common intermediate. */
async function renderVideoSegment(
  clip: ExportClip,
  enc: EncodingSettings,
  index: number,
): Promise<string> {
  const src = await materialize(clip.source!, `v${index}.mp4`);
  const out = path.join(tempDir(), `seg_${Date.now()}_${index}.mp4`);
  const [w, h] = enc.size.split('x');

  await runFfmpeg((cmd) =>
    cmd
      .input(src)
      .inputOptions(clip.trimStart ? [`-ss ${clip.trimStart}`] : [])
      .outputOptions([
        `-t ${clip.duration}`,
        '-c:v libx264',
        '-preset ultrafast',
        '-crf 23',
        '-an',
        `-r ${enc.fps}`,
        '-pix_fmt yuv420p',
      ])
      // videoFilters(), not outputOptions(['-vf', ...]) — see note in the final pass.
      .videoFilters(
        `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
      )
      .output(out),
  );
  return out;
}

/** Black filler so gaps in the timeline preserve timing. */
async function renderBlackSegment(
  duration: number,
  enc: EncodingSettings,
  index: number,
): Promise<string> {
  const out = path.join(tempDir(), `gap_${Date.now()}_${index}.mp4`);
  await runFfmpeg((cmd) =>
    cmd
      .input(`color=black:s=${enc.size}:r=${enc.fps}`)
      .inputFormat('lavfi')
      .outputOptions([
        `-t ${duration}`,
        '-c:v libx264',
        '-preset ultrafast',
        '-crf 23',
        '-an',
        '-pix_fmt yuv420p',
      ])
      .videoFilters('setsar=1')
      .output(out),
  );
  return out;
}

/**
 * Render a timeline to a video file. Returns `outputPath`.
 * Throws on failure — callers must surface the error, never a placeholder.
 */
export async function exportTimelineVideo(
  tracks: ExportTrack[],
  settings: ExportSettings,
  outputPath: string,
): Promise<string> {
  await getFFmpeg();
  const enc = getEncodingSettings(settings);
  const cleanup: string[] = [];

  try {
    const videoTrack = tracks.find((t) => t.type === 'video' && t.clips.length > 0);
    if (!videoTrack) {
      throw new Error('Timeline has no video clips to export');
    }

    // 1. Build ordered, gap-filled video segments.
    const ordered = [...videoTrack.clips].sort((a, b) => a.startTime - b.startTime);
    const segments: string[] = [];
    let cursor = 0;
    let i = 0;

    for (const clip of ordered) {
      if (!clip.source) throw new Error(`Video clip ${clip.id} has no source`);
      const gap = clip.startTime - cursor;
      if (gap > 0.05) {
        const black = await renderBlackSegment(gap, enc, i++);
        segments.push(black);
        cleanup.push(black);
      }
      const seg = await renderVideoSegment(clip, enc, i++);
      segments.push(seg);
      cleanup.push(seg);
      cursor = clip.startTime + clip.duration;
    }

    // Total timeline length = end of the last video clip.
    const timelineDuration = cursor;

    // 2. Concat the segments.
    const listPath = path.join(tempDir(), `list_${Date.now()}.txt`);
    fs.writeFileSync(listPath, segments.map((s) => `file '${s.replace(/\\/g, '/')}'`).join('\n'));
    cleanup.push(listPath);

    // 3. Collect audio clips from unmuted audio tracks.
    const audioClips: Array<{ file: string; startTime: number; duration: number; trimStart: number }> = [];
    for (const track of tracks.filter((t) => t.type === 'audio' && !t.muted)) {
      for (const clip of track.clips) {
        if (!clip.source || clip.muted) continue;
        const file = await materialize(clip.source, `a${audioClips.length}`);
        if (isRemote(clip.source)) cleanup.push(file);
        audioClips.push({
          file,
          startTime: clip.startTime,
          duration: clip.duration,
          trimStart: clip.trimStart ?? 0,
        });
      }
    }

    // 4. Text overlays from text tracks.
    const textClips = tracks
      .filter((t) => t.type === 'text')
      .flatMap((t) => t.clips)
      .filter((c) => c.text && c.text.trim().length > 0);

    // 5. Final pass: overlays + audio mix + encode.
    //
    // The filtergraph goes through fluent's complexFilter(), which passes it as a
    // SINGLE argv entry. outputOptions() splits its entries on whitespace, so a
    // drawtext value like "Hello World" would be torn in half there.
    const filters: string[] = [];

    // Without a font, drawtext aborts the render — drop the overlays instead.
    const font = resolveCaptionFontFile();
    const fontOpt = font ? `fontfile='${escapeFontPath(font)}':` : null;

    // Always terminate the video chain in [vout] so the -map is uniform.
    const overlayParts: string[] = [];
    if (textClips.length > 0 && fontOpt) {
      overlayParts.push(
        textClips
          .map(
            (c) =>
              `drawtext=${fontOpt}text='${escapeDrawText(c.text!)}':fontsize=36:fontcolor=white:borderw=2:` +
              `bordercolor=black:x=(w-text_w)/2:y=h-80:` +
              `enable='between(t\\,${c.startTime}\\,${c.startTime + c.duration})'`,
          )
          .join(','),
      );
    }
    // Free-plan watermark — same builder the generation path uses.
    if (settings.watermarkText) {
      const wm = buildWatermarkFilter(settings.watermarkText);
      if (wm) overlayParts.push(wm);
    }
    const textChain = overlayParts.length > 0 ? overlayParts.join(',') : 'null';
    filters.push(`[0:v]${textChain}[vout]`);

    if (audioClips.length > 0) {
      audioClips.forEach((a, idx) => {
        const delayMs = Math.max(0, Math.round(a.startTime * 1000));
        // Input index is idx+1 — input 0 is the concatenated video.
        filters.push(
          `[${idx + 1}:a]atrim=start=${a.trimStart}:duration=${a.duration},` +
            `asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs}[a${idx}]`,
        );
      });
      const mixInputs = audioClips.map((_, idx) => `[a${idx}]`).join('');
      // apad keeps the mix from ending before the video. The output is bounded
      // by an explicit -t below: `-shortest` is unreliable for streams coming
      // out of filter_complex (it never terminates against apad's infinite pad).
      filters.push(
        `${mixInputs}amix=inputs=${audioClips.length}:dropout_transition=0,apad[aout]`,
      );
    }

    const maps = audioClips.length > 0 ? ['vout', 'aout'] : ['vout'];

    await runFfmpeg((cmd) => {
      cmd.input(listPath).inputOptions(['-f concat', '-safe 0']);
      for (const a of audioClips) cmd.input(a.file);

      cmd.complexFilter(filters.join(';'), maps);

      const opts: string[] = [
        // Timeline length is known exactly; bound the output deterministically.
        '-t', String(timelineDuration),
        '-c:v', enc.videoCodec,
        '-b:v', enc.videoBitrate,
        '-r', String(enc.fps),
        '-pix_fmt', 'yuv420p',
        '-preset', enc.ffmpegPreset,
        '-movflags', '+faststart',
        '-max_muxing_queue_size', '1024',
      ];
      if (audioClips.length > 0) {
        opts.push('-c:a', enc.audioCodec, '-b:a', enc.audioBitrate);
      } else {
        opts.push('-an');
      }

      return cmd.outputOptions(opts).output(outputPath);
    });

    return outputPath;
  } finally {
    for (const file of cleanup) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch (error) {
        console.error('[Video Export] Cleanup error:', error);
      }
    }
  }
}
