import { describe, it, expect, afterEach } from '@jest/globals'
import {
  buildTextToVideoPayload,
  createTextToVideo,
  getRunwayTaskStatus,
  isRunwayConfigured,
} from '@/lib/runway-provider'

const ORIGINAL_ENV = process.env.RUNWAY_API_KEY

describe('isRunwayConfigured', () => {
  afterEach(() => {
    process.env.RUNWAY_API_KEY = ORIGINAL_ENV
  })

  it('is false without a key and true with one', () => {
    delete process.env.RUNWAY_API_KEY
    expect(isRunwayConfigured()).toBe(false)
    process.env.RUNWAY_API_KEY = 'test-key'
    expect(isRunwayConfigured()).toBe(true)
  })
})

describe('buildTextToVideoPayload', () => {
  it('maps aspect ratio to the documented ratio strings', () => {
    expect(buildTextToVideoPayload({
      promptText: 'a mountain sunrise',
      model: 'gen4.5',
      aspectRatio: '16:9',
      duration: 5,
    })).toEqual({
      model: 'gen4.5',
      promptText: 'a mountain sunrise',
      ratio: '1280:720',
      duration: 5,
    })

    expect(buildTextToVideoPayload({
      promptText: 'p',
      model: 'gen4.5',
      aspectRatio: '9:16',
      duration: 5,
    }).ratio).toBe('720:1280')

    expect(buildTextToVideoPayload({
      promptText: 'p',
      model: 'gen4.5',
      aspectRatio: '1:1',
      duration: 5,
    }).ratio).toBe('960:960')
  })

  it('omits seed when not given, includes it when given', () => {
    const withoutSeed = buildTextToVideoPayload({
      promptText: 'p', model: 'gen4.5', aspectRatio: '16:9', duration: 5,
    })
    expect(withoutSeed).not.toHaveProperty('seed')

    const withSeed = buildTextToVideoPayload({
      promptText: 'p', model: 'gen4.5', aspectRatio: '16:9', duration: 5, seed: 42,
    })
    expect(withSeed.seed).toBe(42)
  })

  it('accepts any model string — which ones to expose is the caller\'s choice, not this module\'s', () => {
    expect(() => buildTextToVideoPayload({
      promptText: 'p', model: 'some-future-model', aspectRatio: '16:9', duration: 5,
    })).not.toThrow()
  })

  it('rejects a duration outside [2, 10] even if a caller skips the route\'s own zod check', () => {
    expect(() => buildTextToVideoPayload({
      promptText: 'p', model: 'gen4.5', aspectRatio: '16:9', duration: 1,
    })).toThrow(/between 2 and 10/)
    expect(() => buildTextToVideoPayload({
      promptText: 'p', model: 'gen4.5', aspectRatio: '16:9', duration: 3600,
    })).toThrow(/between 2 and 10/)
  })
})

describe('createTextToVideo', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    process.env.RUNWAY_API_KEY = 'test-key'
  })
  afterEach(() => {
    process.env.RUNWAY_API_KEY = ORIGINAL_ENV
    global.fetch = originalFetch
  })

  it('throws without a configured key, before ever calling fetch', async () => {
    delete process.env.RUNWAY_API_KEY
    const mockFetch = jest.fn()
    global.fetch = mockFetch as any
    await expect(
      createTextToVideo({ promptText: 'p', model: 'gen4.5', aspectRatio: '16:9', duration: 5 }),
    ).rejects.toThrow('RUNWAY_API_KEY')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns the task id on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'task_123' }) }) as any
    const id = await createTextToVideo({ promptText: 'p', model: 'gen4.5', aspectRatio: '16:9', duration: 5 })
    expect(id).toBe('task_123')
  })

  it('sends the required auth and version headers', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 't1' }) })
    global.fetch = mockFetch as any
    await createTextToVideo({ promptText: 'p', model: 'gen4.5', aspectRatio: '16:9', duration: 5 })
    const [, init] = mockFetch.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer test-key')
    expect(init.headers['X-Runway-Version']).toBe('2024-11-06')
  })

  it('surfaces a non-ok response as a thrown error rather than swallowing it', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    }) as any
    await expect(
      createTextToVideo({ promptText: 'p', model: 'gen4.5', aspectRatio: '16:9', duration: 5 }),
    ).rejects.toThrow('429')
  })
})

describe('getRunwayTaskStatus', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    process.env.RUNWAY_API_KEY = 'test-key'
  })
  afterEach(() => {
    process.env.RUNWAY_API_KEY = ORIGINAL_ENV
    global.fetch = originalFetch
  })

  it('normalizes SUCCEEDED to completed, with its first output url', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'SUCCEEDED', output: ['https://cdn.runwayml.com/out.mp4'] }),
    }) as any
    const status = await getRunwayTaskStatus('t1')
    expect(status).toEqual({ status: 'completed', videoUrl: 'https://cdn.runwayml.com/out.mp4', error: null })
  })

  it('normalizes FAILED to failed, with its failure reason', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'FAILED', failure: 'content moderated' }),
    }) as any
    const status = await getRunwayTaskStatus('t1')
    expect(status).toEqual({ status: 'failed', videoUrl: null, error: 'content moderated' })
  })

  it('normalizes CANCELED to failed the same way as FAILED', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'CANCELED' }) }) as any
    const status = await getRunwayTaskStatus('t1')
    expect(status.status).toBe('failed')
    expect(status.videoUrl).toBeNull()
  })

  it('normalizes PENDING/RUNNING to processing, with no url', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'RUNNING' }) }) as any
    const status = await getRunwayTaskStatus('t1')
    expect(status).toEqual({ status: 'processing', videoUrl: null, error: null })
  })
})
