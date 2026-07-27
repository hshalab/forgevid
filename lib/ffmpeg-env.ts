/**
 * Which ffmpeg binary we run, and what it can do.
 *
 * `@ffmpeg-installer/ffmpeg` pins a 2018 build (N-92722). That binary has no
 * `xfade` (added in ffmpeg 4.3, 2020). Worse, the code called
 * `setFfmpegPath(installer.path)` unconditionally, so the Dockerfile's
 * `apk add ffmpeg` was overridden and the ancient bundled binary ran in
 * production too.
 *
 * Resolution order: FFMPEG_PATH > ffmpeg-static (a known-modern 6.x build) >
 * a system `ffmpeg` on PATH > @ffmpeg-installer. A system binary is preferred
 * over the ancient bundled one but NOT over ffmpeg-static, because a distro
 * ffmpeg may itself predate 4.3.
 *
 * Capabilities are then probed rather than assumed, so a feature that needs a
 * newer filter degrades instead of failing the render.
 *
 * Relative imports only — reachable from the worker process.
 */

import { execFile, spawnSync } from 'child_process';

let cachedPath: string | undefined;
let cachedFilters: Set<string> | undefined;

function works(binary: string): boolean {
  try {
    return spawnSync(binary, ['-hide_banner', '-version'], { encoding: 'utf8' }).status === 0;
  } catch {
    return false;
  }
}

/** Absolute path (or bare command) of the ffmpeg we should run. */
export function resolveFfmpegPath(): string {
  if (cachedPath) return cachedPath;

  const explicit = process.env.FFMPEG_PATH;
  if (explicit && works(explicit)) {
    cachedPath = explicit;
    return cachedPath;
  }

  // ffmpeg-static ships a modern build (6.x) with xfade and zoompan.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const staticPath = require('ffmpeg-static') as string | null;
    if (staticPath && works(staticPath)) {
      cachedPath = staticPath;
      return cachedPath;
    }
  } catch {
    // not installed — fall through
  }

  if (works('ffmpeg')) {
    cachedPath = 'ffmpeg';
    console.log('[ffmpeg-env] using the system ffmpeg on PATH');
    return cachedPath;
  }

  // Last resort: the pinned 2018 build. Missing xfade; features degrade.
  //
  // This must never happen silently. It DID: webpack bundled ffmpeg-static, so
  // its `path.join(__dirname, ...)` pointed nowhere, the check above failed, and
  // every render the web app produced quietly used this 2018 binary — hard cuts
  // instead of the cross-fades the user asked for. The suites never saw it
  // because plain node resolves ffmpeg-static correctly.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  cachedPath = require('@ffmpeg-installer/ffmpeg').path as string;
  console.warn(
    '[ffmpeg-env] WARNING: falling back to the 2018 @ffmpeg-installer build. ' +
      'It has no xfade, so scene transitions will degrade to hard cuts. ' +
      'Install ffmpeg-static, or set FFMPEG_PATH to a modern binary.',
  );
  return cachedPath;
}

/** Names of every filter the resolved ffmpeg exposes. */
export function availableFilters(): Set<string> {
  if (cachedFilters) return cachedFilters;

  cachedFilters = new Set<string>();
  try {
    const result = spawnSync(resolveFfmpegPath(), ['-hide_banner', '-filters'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    for (const line of `${result.stdout ?? ''}`.split('\n')) {
      // "  ... name    V->V   description"
      const match = line.match(/^\s*[A-Z.]{3}\s+(\S+)\s/);
      if (match) cachedFilters.add(match[1]);
    }
  } catch (error) {
    console.error('[ffmpeg] Could not probe filters:', error);
  }
  return cachedFilters;
}

export function supportsFilter(name: string): boolean {
  return availableFilters().has(name);
}

/**
 * Run the resolved ffmpeg binary for a one-shot analysis pass and return its
 * combined stderr+stdout. No ffprobe binary ships with this project (only
 * ffmpeg-static), so callers that need stream info or detection-filter output
 * (see quality-gate.ts) parse ffmpeg's own text banner/filter logs instead of
 * a separate probe call.
 *
 * Async (execFile, not spawnSync): this pipeline can run inline in the
 * Next.js API process as a fire-and-forget fallback when Redis isn't
 * configured (see generation-pipeline.ts) — a synchronous spawn here would
 * block that whole process's event loop, stalling every other concurrent
 * request for as long as ffmpeg takes to analyze the file, not just this
 * one's render. A non-zero exit (e.g. a probe-only `-f null -` run) still
 * carries the analysis output on the error object, so it resolves either way
 * — the text is what callers parse, not the exit code.
 */
export function runFfmpeg(args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      resolveFfmpegPath(),
      args,
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs },
      // execFile still hands back stdout/stderr on a non-zero exit — a
      // probe-only `-f null -` run often exits that way — so a truthy
      // `error` here is never a reason to discard what ffmpeg printed.
      (_error, stdout, stderr) => resolve(`${stderr ?? ''}${stdout ?? ''}`),
    );
  });
}

/** Parse the duration ffmpeg -i prints to its banner (stderr), in seconds. 0 if absent/unparseable. */
export function parseDurationSeconds(bannerText: string): number {
  const match = bannerText.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** Test hook. */
export function __resetFfmpegEnvCache() {
  cachedPath = undefined;
  cachedFilters = undefined;
}
