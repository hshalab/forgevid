/**
 * Post-render quality gate — catches a broken export BEFORE it reaches a
 * customer: black or frozen video, missing/silent narration, wrong duration
 * or resolution. Runs on the local render (before upload), reusing the same
 * resolved ffmpeg binary the assembler uses (see ffmpeg-env.ts) so detection
 * never disagrees with what actually encoded the file.
 *
 * No ffprobe binary ships with this project (only ffmpeg-static), so stream
 * info is read off `ffmpeg -i <file>`'s stderr banner instead of a separate
 * probe call. Detection filters are probed via supportsFilter() and skipped
 * when the resolved ffmpeg build doesn't expose them — a missing filter
 * degrades the check, it never fails the render.
 */
import { runFfmpeg, supportsFilter } from './ffmpeg-env';
import type { ResolvedScene } from './video-generator';

export type QualityIssueCode =
  | 'zero_duration'
  | 'duration_mismatch'
  | 'resolution_mismatch'
  | 'no_audio_stream'
  | 'black_frames'
  | 'frozen_frames'
  | 'silent_audio';

export interface QualityIssue {
  code: QualityIssueCode;
  message: string;
  severity: 'warn' | 'fail';
  /** Seconds into the timeline, when the issue can be localized to a range. */
  ranges?: Array<{ start: number; end: number }>;
}

export interface QualityReport {
  passed: boolean;
  /** 0-100; only informational — `passed` is what gates a retry. */
  score: number;
  issues: QualityIssue[];
  probed: { durationSec: number | null; width: number | null; height: number | null; hasAudio: boolean };
}

export interface QualityExpectations {
  expectedDurationSec: number;
  expectedWidth: number;
  expectedHeight: number;
  /** True when narration and/or music was requested for this render. */
  requireAudio: boolean;
}

function probeStreamInfo(filePath: string) {
  const out = runFfmpeg(['-hide_banner', '-i', filePath]);
  const durMatch = out.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durationSec = durMatch
    ? Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3])
    : null;
  const resMatch = out.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  const width = resMatch ? Number(resMatch[1]) : null;
  const height = resMatch ? Number(resMatch[2]) : null;
  const hasAudio = /Stream #\d+:\d+.*?Audio:/.test(out);
  return { durationSec, width, height, hasAudio };
}

function detectBlack(filePath: string): { totalSec: number; ranges: Array<{ start: number; end: number }> } {
  if (!supportsFilter('blackdetect')) return { totalSec: 0, ranges: [] };
  const out = runFfmpeg(['-hide_banner', '-i', filePath, '-vf', 'blackdetect=d=0.5:pic_th=0.98', '-an', '-f', 'null', '-']);
  const ranges: Array<{ start: number; end: number }> = [];
  for (const m of out.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)) {
    ranges.push({ start: Number(m[1]), end: Number(m[2]) });
  }
  const totalSec = ranges.reduce((n, r) => n + (r.end - r.start), 0);
  return { totalSec, ranges };
}

function detectFreeze(filePath: string): { totalSec: number; ranges: Array<{ start: number; end: number }> } {
  if (!supportsFilter('freezedetect')) return { totalSec: 0, ranges: [] };
  const out = runFfmpeg(['-hide_banner', '-i', filePath, '-vf', 'freezedetect=n=-60dB:d=2', '-an', '-f', 'null', '-']);
  const starts = [...out.matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...out.matchAll(/freeze_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const ranges: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) ranges.push({ start: starts[i], end: ends[i] });
  const totalSec = ranges.reduce((n, r) => n + (r.end - r.start), 0);
  return { totalSec, ranges };
}

function detectSilence(filePath: string): { totalSec: number; count: number } {
  if (!supportsFilter('silencedetect')) return { totalSec: 0, count: 0 };
  const out = runFfmpeg(['-hide_banner', '-i', filePath, '-af', 'silencedetect=noise=-35dB:d=1', '-vn', '-f', 'null', '-']);
  const durations = [...out.matchAll(/silence_duration:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  return { totalSec: durations.reduce((n, v) => n + v, 0), count: durations.length };
}

/** Analyze a finished local render against what it was supposed to be. */
export function runQualityGate(filePath: string, expected: QualityExpectations): QualityReport {
  const probed = probeStreamInfo(filePath);
  const issues: QualityIssue[] = [];

  if (!probed.durationSec || probed.durationSec <= 0) {
    issues.push({ code: 'zero_duration', message: 'Render has zero or unreadable duration', severity: 'fail' });
    return { passed: false, score: 0, issues, probed };
  }

  let score = 100;

  const durationDelta = Math.abs(probed.durationSec - expected.expectedDurationSec);
  if (durationDelta > Math.max(2, expected.expectedDurationSec * 0.15)) {
    issues.push({
      code: 'duration_mismatch',
      message: `Rendered ${probed.durationSec.toFixed(1)}s, expected ~${expected.expectedDurationSec.toFixed(1)}s`,
      severity: 'fail',
    });
    score -= 30;
  }

  if (probed.width !== expected.expectedWidth || probed.height !== expected.expectedHeight) {
    issues.push({
      code: 'resolution_mismatch',
      message: `Rendered ${probed.width}x${probed.height}, expected ${expected.expectedWidth}x${expected.expectedHeight}`,
      severity: 'warn',
    });
    score -= 10;
  }

  if (expected.requireAudio && !probed.hasAudio) {
    issues.push({
      code: 'no_audio_stream',
      message: 'Narration or music was requested but the render has no audio stream',
      severity: 'fail',
    });
    score -= 40;
  }

  const black = detectBlack(filePath);
  if (black.totalSec > Math.max(1, probed.durationSec * 0.08)) {
    issues.push({
      code: 'black_frames',
      message: `${black.totalSec.toFixed(1)}s of black frames across ${black.ranges.length} segment(s)`,
      severity: 'fail',
      ranges: black.ranges,
    });
    score -= 35;
  }

  const freeze = detectFreeze(filePath);
  if (freeze.totalSec > Math.max(1.5, probed.durationSec * 0.1)) {
    issues.push({
      code: 'frozen_frames',
      message: `${freeze.totalSec.toFixed(1)}s of frozen video across ${freeze.ranges.length} segment(s)`,
      severity: 'fail',
      ranges: freeze.ranges,
    });
    score -= 25;
  }

  if (expected.requireAudio && probed.hasAudio) {
    const silence = detectSilence(filePath);
    if (silence.totalSec > probed.durationSec * 0.6) {
      issues.push({
        code: 'silent_audio',
        message: `${silence.totalSec.toFixed(1)}s of ${probed.durationSec.toFixed(1)}s is silent — narration/music likely missing`,
        severity: 'fail',
      });
      score -= 35;
    }
  }

  score = Math.max(0, score);
  const passed = !issues.some((i) => i.severity === 'fail');
  return { passed, score, issues, probed };
}

/**
 * Map issue time ranges back to the scenes they fall in, using each scene's
 * cumulative position on the timeline (in the same order they were rendered).
 * Only 'fail'-severity, range-bearing issues (black/frozen frames) point at a
 * specific scene — a duration/resolution/audio mismatch is global.
 */
export function scenesForIssues(scenes: ResolvedScene[], issues: QualityIssue[]): Set<number> {
  const indices = new Set<number>();
  const ranged = issues.filter((i) => i.severity === 'fail' && i.ranges && i.ranges.length > 0);
  if (ranged.length === 0) return indices;

  let cursor = 0;
  const bounds = scenes.map((s) => {
    const start = cursor;
    cursor += s.duration;
    return { start, end: cursor };
  });

  for (const issue of ranged) {
    for (const range of issue.ranges ?? []) {
      bounds.forEach((b, idx) => {
        // Overlap test: the flagged range and this scene's span intersect.
        if (range.start < b.end && range.end > b.start) indices.add(idx);
      });
    }
  }
  return indices;
}
