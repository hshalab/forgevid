jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))
jest.mock('@/lib/moderation', () => ({
  moderateText: jest.fn(),
  recordModerationBlock: jest.fn(),
}))
jest.mock('@/lib/runway-provider', () => ({
  createTextToVideo: jest.fn(),
  getRunwayTaskStatus: jest.fn(),
  isRunwayConfigured: jest.fn(),
  // Real constants, not mocks — the route's zod schema is built from these
  // at module load, so stubbing them out would break every parse.
  MIN_DURATION_SECONDS: 2,
  MAX_DURATION_SECONDS: 10,
  RUNWAY_ASPECT_RATIOS: ['16:9', '9:16', '1:1'],
}))
jest.mock('@/lib/quota', () => ({
  checkGenerationQuota: jest.fn(),
  settleGenerationEntitlement: jest.fn(),
}))
jest.mock('@/lib/provider-job-poll', () => ({ pollProviderJobToCompletion: jest.fn() }))
jest.mock('@/lib/plan', () => ({ allowsFrontierGeneration: jest.fn(), getUserPlan: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: { video: { create: jest.fn() } },
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { moderateText } from '@/lib/moderation'
import { allowsFrontierGeneration, getUserPlan } from '@/lib/plan'
import { checkGenerationQuota, settleGenerationEntitlement } from '@/lib/quota'
import { pollProviderJobToCompletion } from '@/lib/provider-job-poll'
import { createTextToVideo, getRunwayTaskStatus, isRunwayConfigured } from '@/lib/runway-provider'
import { GET, POST } from '@/app/api/videos/runway/generate/route'

const session = getServerSession as jest.MockedFunction<typeof getServerSession>
const video = prisma.video as jest.Mocked<typeof prisma.video>
const mockedModerate = moderateText as jest.Mock
const mockedAllows = allowsFrontierGeneration as jest.Mock
const mockedCheckQuota = checkGenerationQuota as jest.Mock
const mockedSettle = settleGenerationEntitlement as jest.Mock
const mockedCreate = createTextToVideo as jest.Mock
const mockedIsConfigured = isRunwayConfigured as jest.Mock
const mockedPoll = pollProviderJobToCompletion as jest.Mock

function request(body: unknown) {
  return { json: async () => body } as any
}

describe('POST /api/videos/runway/generate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    session.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockedModerate.mockResolvedValue({ allowed: true, categories: [] })
    mockedIsConfigured.mockReturnValue(true)
    mockedAllows.mockReturnValue(true)
    mockedCheckQuota.mockResolvedValue({ allowed: true, plan: 'pro', usePurchasedCredit: false })
  })

  it('requires authentication', async () => {
    session.mockResolvedValue(null)
    const response = await POST(request({ promptText: 'a mountain sunrise' }))
    expect(response.status).toBe(401)
  })

  it('rejects an invalid body', async () => {
    const response = await POST(request({ promptText: 'ab' })) // below min length
    expect(response.status).toBe(400)
  })

  it('returns 503 when Runway is not configured, before ever checking quota', async () => {
    mockedIsConfigured.mockReturnValue(false)
    const response = await POST(request({ promptText: 'a mountain sunrise' }))
    expect(response.status).toBe(503)
    expect(mockedCheckQuota).not.toHaveBeenCalled()
    expect(mockedModerate).not.toHaveBeenCalled()
  })

  it('rejects when quota is exhausted, before ever moderating the prompt', async () => {
    mockedCheckQuota.mockResolvedValue({ allowed: false, reason: 'Monthly limit reached', upgradeRequired: true })
    const response = await POST(request({ promptText: 'a mountain sunrise' }))
    expect(response.status).toBe(429)
    expect(mockedModerate).not.toHaveBeenCalled()
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('rejects a non-Pro plan even with purchased credits available, before ever moderating the prompt', async () => {
    mockedCheckQuota.mockResolvedValue({ allowed: true, plan: 'free', usePurchasedCredit: true })
    mockedAllows.mockReturnValue(false)
    const response = await POST(request({ promptText: 'a mountain sunrise' }))
    expect(response.status).toBe(403)
    expect(mockedModerate).not.toHaveBeenCalled()
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('blocks a prompt the moderation policy rejects — after the free gates, before spending on the provider call', async () => {
    mockedModerate.mockResolvedValue({ allowed: false, categories: ['violence'], reason: 'Blocked by our content policy.' })
    const response = await POST(request({ promptText: 'a violent scene' }))
    expect(response.status).toBe(422)
    // Quota WAS checked (it's a free, in-process check, done first) —
    // only the real, billed provider call is what moderation prevents.
    expect(mockedCheckQuota).toHaveBeenCalled()
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('starts a generation for a valid request and returns a new videoId', async () => {
    mockedCreate.mockResolvedValue('task_123')
    video.create.mockResolvedValue({ id: 'new-video-1' } as any)

    const response = await POST(request({ promptText: 'a mountain sunrise', model: 'veo3.1', duration: 8 }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.videoId).toBe('new-video-1')
    expect(mockedCreate).toHaveBeenCalledWith({
      promptText: 'a mountain sunrise',
      model: 'veo3.1',
      aspectRatio: '16:9',
      duration: 8,
      seed: undefined,
    })
    expect(video.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-1', status: 'QUEUED' }),
    }))
    expect(mockedSettle).toHaveBeenCalledWith('user-1', 'new-video-1', 8, expect.anything())

    expect(mockedPoll).toHaveBeenCalledWith(expect.objectContaining({
      videoId: 'new-video-1',
      userId: 'user-1',
      providerName: 'runway',
      prompt: 'a mountain sunrise',
    }))
    const pollArgs = mockedPoll.mock.calls[0][0]
    expect(pollArgs.successCost()).toEqual({ runwaySeconds: 8 })

    // checkStatus just delegates to getRunwayTaskStatus(taskId) — Runway's
    // own status normalization (see tests/lib/runway-provider.test.ts) means
    // there's nothing left for this route to adapt.
    const mockedGetStatus = getRunwayTaskStatus as jest.Mock
    mockedGetStatus.mockResolvedValue({ status: 'processing', videoUrl: null, error: null })
    await pollArgs.checkStatus()
    expect(mockedGetStatus).toHaveBeenCalledWith('task_123')
  })
})

describe('GET /api/videos/runway/generate (availability pre-flight)', () => {
  const mockedGetPlan = getUserPlan as jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    session.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockedGetPlan.mockResolvedValue('pro')
    mockedAllows.mockReturnValue(true)
    mockedIsConfigured.mockReturnValue(true)
  })

  it('requires authentication', async () => {
    session.mockResolvedValue(null)
    const response = await GET()
    expect(response.status).toBe(401)
  })

  it('returns 403 with upgradeRequired for a non-Pro plan', async () => {
    mockedGetPlan.mockResolvedValue('free')
    mockedAllows.mockReturnValue(false)
    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(403)
    expect(body.upgradeRequired).toBe(true)
  })

  it('returns 503 when Runway is not configured', async () => {
    mockedIsConfigured.mockReturnValue(false)
    const response = await GET()
    expect(response.status).toBe(503)
  })

  it('returns the curated model list, credit cost, and bounds', async () => {
    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.models.map((m: { id: string }) => m.id)).toEqual([
      'gen4.5', 'gen4_turbo', 'veo3.1', 'seedance2', 'kling3.0_pro',
    ])
    expect(body.models.every((m: { label?: string }) => typeof m.label === 'string' && m.label.length > 0)).toBe(true)
    expect(body.creditCost).toBe(2)
    expect(body.minDuration).toBe(2)
    expect(body.maxDuration).toBe(10)
    expect(body.aspectRatios).toEqual(['16:9', '9:16', '1:1'])
  })
})
