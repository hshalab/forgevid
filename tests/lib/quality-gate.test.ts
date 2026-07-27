import { describe, it, expect, beforeEach } from '@jest/globals'
// NOTE: `jest` itself is intentionally the ambient global here, not imported
// from '@jest/globals' — with this repo's next/jest (SWC) transform, importing
// it breaks jest.mock() hoisting and the mock silently never applies.

jest.mock('@/lib/ffmpeg-env', () => ({
  runFfmpeg: jest.fn(),
  supportsFilter: jest.fn(),
  // Pure regex parsing, no process spawn — use the real implementation
  // rather than hand-maintaining a duplicate of its parsing logic here.
  parseDurationSeconds: jest.requireActual('@/lib/ffmpeg-env').parseDurationSeconds,
}))

import { runFfmpeg, supportsFilter } from '@/lib/ffmpeg-env'
import { runQualityGate, scenesForIssues } from '@/lib/quality-gate'
import type { ResolvedScene } from '@/lib/video-generator'

const mockRunFfmpeg = runFfmpeg as jest.Mock
const mockSupportsFilter = supportsFilter as jest.Mock

const BANNER_OK =
  "Duration: 00:00:15.00, start: 0.000000, bitrate: 1200 kb/s\n" +
  "  Stream #0:0: Video: h264, yuv420p, 1080x1920, 30 fps\n" +
  "  Stream #0:1: Audio: aac, 44100 Hz, stereo\n"

/**
 * The probe call (`-hide_banner -i file`, no -vf/-af) always gets `banner`.
 * A detection call is routed by its filter name, which is unique to that call
 * (e.g. 'blackdetect') — never by '-i', which every single call shares.
 */
function mockRuns(banner: string, byFilterName: Record<string, string> = {}) {
  mockRunFfmpeg.mockImplementation((args: string[]) => {
    const joined = args.join(' ')
    for (const [needle, stdout] of Object.entries(byFilterName)) {
      if (joined.includes(needle)) return stdout
    }
    return banner
  })
}

describe('runQualityGate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSupportsFilter.mockReturnValue(true)
  })

  const expected = { expectedDurationSec: 15, expectedWidth: 1080, expectedHeight: 1920, requireAudio: true }

  it('passes a clean render with no issues', async () => {
    mockRuns(BANNER_OK)
    const report = await runQualityGate('/tmp/out.mp4', expected)
    expect(report.passed).toBe(true)
    expect(report.score).toBe(100)
    expect(report.issues).toEqual([])
    expect(report.probed).toEqual({ durationSec: 15, width: 1080, height: 1920, hasAudio: true })
  })

  it('fails closed on zero/unreadable duration', async () => {
    mockRuns('no duration banner here')
    const report = await runQualityGate('/tmp/out.mp4', expected)
    expect(report.passed).toBe(false)
    expect(report.score).toBe(0)
    expect(report.issues[0].code).toBe('zero_duration')
  })

  it('flags a resolution mismatch as a warning, not a failure', async () => {
    const banner = BANNER_OK.replace('1080x1920', '640x360')
    mockRuns(banner)
    const report = await runQualityGate('/tmp/out.mp4', expected)
    expect(report.passed).toBe(true)
    expect(report.issues.map((i) => i.code)).toContain('resolution_mismatch')
    expect(report.issues.find((i) => i.code === 'resolution_mismatch')?.severity).toBe('warn')
    expect(report.score).toBeLessThan(100)
  })

  it('fails when audio was required but no audio stream is present', async () => {
    const banner = BANNER_OK.replace('  Stream #0:1: Audio: aac, 44100 Hz, stereo\n', '')
    mockRuns(banner)
    const report = await runQualityGate('/tmp/out.mp4', expected)
    expect(report.passed).toBe(false)
    expect(report.issues.map((i) => i.code)).toContain('no_audio_stream')
  })

  it('fails on excessive black frames and reports their time ranges', async () => {
    mockRuns(BANNER_OK, { blackdetect: 'black_start:2.000000 black_end:5.500000\n' })
    const report = await runQualityGate('/tmp/out.mp4', expected)
    expect(report.passed).toBe(false)
    const issue = report.issues.find((i) => i.code === 'black_frames')
    expect(issue).toBeDefined()
    expect(issue?.ranges).toEqual([{ start: 2, end: 5.5 }])
  })

  it('fails on excessive frozen frames', async () => {
    mockRuns(BANNER_OK, {
      freezedetect: 'freeze_start: 1.000000\nfreeze_end: 9.000000\nfreeze_duration: 8.000000\n',
    })
    const report = await runQualityGate('/tmp/out.mp4', expected)
    expect(report.passed).toBe(false)
    expect(report.issues.map((i) => i.code)).toContain('frozen_frames')
  })

  it('fails when audio is present but mostly silent', async () => {
    mockRuns(BANNER_OK, { silencedetect: 'silence_start: 0\nsilence_duration: 14.000000\n' })
    const report = await runQualityGate('/tmp/out.mp4', expected)
    expect(report.passed).toBe(false)
    expect(report.issues.map((i) => i.code)).toContain('silent_audio')
  })

  it('does not run silencedetect when audio was not required', async () => {
    const banner = BANNER_OK.replace('  Stream #0:1: Audio: aac, 44100 Hz, stereo\n', '')
    mockRuns(banner)
    const report = await runQualityGate('/tmp/out.mp4', { ...expected, requireAudio: false })
    expect(report.passed).toBe(true)
    expect(report.issues).toEqual([])
  })

  it('skips detection filters the resolved ffmpeg build does not support', async () => {
    mockSupportsFilter.mockReturnValue(false)
    // Would fail the gate if blackdetect actually ran despite being unsupported.
    mockRuns(BANNER_OK, { blackdetect: 'black_start:0 black_end:14\n' })
    const report = await runQualityGate('/tmp/out.mp4', expected)
    expect(report.passed).toBe(true)
    expect(report.issues).toEqual([])
  })
})

describe('scenesForIssues', () => {
  function scene(index: number, duration: number): ResolvedScene {
    return {
      id: `scene-${index}`,
      index,
      description: `scene ${index}`,
      keywords: [],
      duration,
      visualElements: [],
      clipUrl: `https://example.com/${index}.mp4`,
      matchedQuery: 'q',
    }
  }

  it('maps a black-frame range back to the overlapping scene', () => {
    const scenes = [scene(0, 5), scene(1, 5), scene(2, 5)] // 0-5, 5-10, 10-15
    const indices = scenesForIssues(scenes, [
      { code: 'black_frames', message: '', severity: 'fail', ranges: [{ start: 6, end: 8 }] },
    ])
    expect(indices).toEqual(new Set([1]))
  })

  it('ignores warn-severity issues and issues with no ranges', () => {
    const scenes = [scene(0, 5), scene(1, 5)]
    const indices = scenesForIssues(scenes, [
      { code: 'resolution_mismatch', message: '', severity: 'warn', ranges: [{ start: 0, end: 5 }] },
      { code: 'duration_mismatch', message: '', severity: 'fail' },
    ])
    expect(indices.size).toBe(0)
  })

  it('can flag multiple scenes when a range spans a scene boundary', () => {
    const scenes = [scene(0, 5), scene(1, 5), scene(2, 5)]
    const indices = scenesForIssues(scenes, [
      { code: 'frozen_frames', message: '', severity: 'fail', ranges: [{ start: 4, end: 11 }] },
    ])
    expect(indices).toEqual(new Set([0, 1, 2]))
  })
})
