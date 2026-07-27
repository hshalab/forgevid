import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import {
  buildVideoTranslationPayload,
  createVideoTranslation,
  getVideoTranslationStatus,
  isVideoTranslateConfigured,
} from '@/lib/video-translate'

const ORIGINAL_ENV = process.env.HEYGEN_API_KEY

describe('isVideoTranslateConfigured', () => {
  afterEach(() => {
    process.env.HEYGEN_API_KEY = ORIGINAL_ENV
  })

  it('is false without a key and true with one', () => {
    delete process.env.HEYGEN_API_KEY
    expect(isVideoTranslateConfigured()).toBe(false)
    process.env.HEYGEN_API_KEY = 'test-key'
    expect(isVideoTranslateConfigured()).toBe(true)
  })
})

describe('buildVideoTranslationPayload', () => {
  it('matches the documented v3 request shape', () => {
    const payload = buildVideoTranslationPayload({
      videoUrl: 'https://cdn.example.com/video.mp4',
      outputLanguages: ['Spanish'],
    })
    expect(payload).toEqual({
      video: { type: 'url', url: 'https://cdn.example.com/video.mp4' },
      output_languages: ['Spanish'],
      mode: 'speed',
    })
  })

  it('defaults mode to speed and omits callback_url when not given', () => {
    const payload = buildVideoTranslationPayload({
      videoUrl: 'https://cdn.example.com/video.mp4',
      outputLanguages: ['French'],
    })
    expect(payload).not.toHaveProperty('callback_url')
    expect((payload as any).mode).toBe('speed')
  })

  it('passes through precision mode and callback_url when given', () => {
    const payload = buildVideoTranslationPayload({
      videoUrl: 'https://cdn.example.com/video.mp4',
      outputLanguages: ['Spanish', 'French'],
      mode: 'precision',
      callbackUrl: 'https://forgevid.com/api/webhooks/heygen',
    })
    expect(payload).toEqual({
      video: { type: 'url', url: 'https://cdn.example.com/video.mp4' },
      output_languages: ['Spanish', 'French'],
      mode: 'precision',
      callback_url: 'https://forgevid.com/api/webhooks/heygen',
    })
  })
})

describe('createVideoTranslation', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    process.env.HEYGEN_API_KEY = 'test-key'
  })
  afterEach(() => {
    process.env.HEYGEN_API_KEY = ORIGINAL_ENV
    global.fetch = originalFetch
  })

  it('throws without a configured key, before ever calling fetch', async () => {
    delete process.env.HEYGEN_API_KEY
    const mockFetch = jest.fn()
    global.fetch = mockFetch as any
    await expect(
      createVideoTranslation({ videoUrl: 'https://cdn.example.com/v.mp4', outputLanguages: ['Spanish'] }),
    ).rejects.toThrow('HEYGEN_API_KEY')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns the video_translation_ids array on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { video_translation_ids: ['vt_1'] } }),
    }) as any
    const ids = await createVideoTranslation({
      videoUrl: 'https://cdn.example.com/v.mp4',
      outputLanguages: ['Spanish'],
    })
    expect(ids).toEqual(['vt_1'])
  })

  it('surfaces a non-ok response as a thrown error rather than swallowing it', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => 'video url is not reachable',
    }) as any
    await expect(
      createVideoTranslation({ videoUrl: 'https://cdn.example.com/v.mp4', outputLanguages: ['Spanish'] }),
    ).rejects.toThrow('422')
  })
})

describe('getVideoTranslationStatus', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    process.env.HEYGEN_API_KEY = 'test-key'
  })
  afterEach(() => {
    process.env.HEYGEN_API_KEY = ORIGINAL_ENV
    global.fetch = originalFetch
  })

  it('maps a completed job to its video url and duration', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { status: 'completed', video_url: 'https://cdn.example.com/dubbed.mp4', duration: 42.5 },
      }),
    }) as any
    const status = await getVideoTranslationStatus('vt_1')
    expect(status).toEqual({
      status: 'completed',
      videoUrl: 'https://cdn.example.com/dubbed.mp4',
      error: null,
      durationSeconds: 42.5,
    })
  })

  it('treats a missing/non-numeric duration on a completed job as null, not 0 or NaN', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { status: 'completed', video_url: 'https://cdn.example.com/dubbed.mp4' } }),
    }) as any
    const status = await getVideoTranslationStatus('vt_1')
    expect(status.durationSeconds).toBeNull()
  })

  it('maps a failed job to its failure_message', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { status: 'failed', failure_message: 'source video unreadable' } }),
    }) as any
    const status = await getVideoTranslationStatus('vt_1')
    expect(status).toEqual({ status: 'failed', videoUrl: null, error: 'source video unreadable', durationSeconds: null })
  })

  it('maps pending/running to a non-terminal status with no url', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { status: 'running' } }),
    }) as any
    const status = await getVideoTranslationStatus('vt_1')
    expect(status).toEqual({ status: 'running', videoUrl: null, error: null, durationSeconds: null })
  })
})
