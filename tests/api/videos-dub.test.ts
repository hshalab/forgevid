jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))
jest.mock('@/lib/video-translate', () => ({
  createVideoTranslation: jest.fn(),
  getVideoTranslationStatus: jest.fn(),
  isVideoTranslateConfigured: jest.fn(),
}))
jest.mock('@/lib/quota', () => ({
  checkGenerationQuota: jest.fn(),
  settleGenerationEntitlement: jest.fn(),
}))
jest.mock('@/lib/provider-job-poll', () => ({ pollProviderJobToCompletion: jest.fn() }))
jest.mock('@/lib/plan', () => ({ allowsVideoDubbing: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    video: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  },
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { allowsVideoDubbing } from '@/lib/plan'
import { checkGenerationQuota, settleGenerationEntitlement } from '@/lib/quota'
import { pollProviderJobToCompletion } from '@/lib/provider-job-poll'
import { createVideoTranslation, isVideoTranslateConfigured } from '@/lib/video-translate'
import { POST } from '@/app/api/videos/[videoId]/dub/route'

const session = getServerSession as jest.MockedFunction<typeof getServerSession>
const video = prisma.video as jest.Mocked<typeof prisma.video>
const mockedAllowsDubbing = allowsVideoDubbing as jest.Mock
const mockedCheckQuota = checkGenerationQuota as jest.Mock
const mockedSettle = settleGenerationEntitlement as jest.Mock
const mockedCreateTranslation = createVideoTranslation as jest.Mock
const mockedIsConfigured = isVideoTranslateConfigured as jest.Mock
const mockedPoll = pollProviderJobToCompletion as jest.Mock

function request(body: unknown) {
  return { json: async () => body } as any
}

const COMPLETED_SOURCE = {
  userId: 'user-1',
  status: 'COMPLETED',
  fileUrl: 'https://cdn.example.com/source.mp4',
  url: 'https://cdn.example.com/source.mp4',
  duration: 30,
  title: 'My Avatar Video',
}

describe('POST /api/videos/[videoId]/dub', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    session.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockedIsConfigured.mockReturnValue(true)
    mockedAllowsDubbing.mockReturnValue(true)
    mockedCheckQuota.mockResolvedValue({ allowed: true, plan: 'pro', usePurchasedCredit: false })
  })

  function params(videoId = 'video-1') {
    return { params: Promise.resolve({ videoId }) }
  }

  it('requires authentication', async () => {
    session.mockResolvedValue(null)
    const response = await POST(request({ targetLanguage: 'Spanish' }), params())
    expect(response.status).toBe(401)
  })

  it('returns 404 for a video the caller does not own', async () => {
    video.findUnique.mockResolvedValueOnce({ userId: 'someone-else' } as any) // requireVideoOwner's own lookup
    const response = await POST(request({ targetLanguage: 'Spanish' }), params())
    expect(response.status).toBe(404)
  })

  it('rejects an invalid body', async () => {
    video.findUnique.mockResolvedValueOnce({ userId: 'user-1' } as any)
    const response = await POST(request({ targetLanguage: '' }), params())
    expect(response.status).toBe(400)
  })

  it('rejects a source video that has not completed rendering', async () => {
    video.findUnique
      .mockResolvedValueOnce({ userId: 'user-1' } as any) // requireVideoOwner
      .mockResolvedValueOnce({ ...COMPLETED_SOURCE, status: 'PROCESSING' } as any) // source lookup
    const response = await POST(request({ targetLanguage: 'Spanish' }), params())
    expect(response.status).toBe(422)
    expect(mockedCreateTranslation).not.toHaveBeenCalled()
  })

  it('rejects a source video with no recorded duration rather than guessing one', async () => {
    video.findUnique
      .mockResolvedValueOnce({ userId: 'user-1' } as any)
      .mockResolvedValueOnce({ ...COMPLETED_SOURCE, duration: null } as any)
    const response = await POST(request({ targetLanguage: 'Spanish' }), params())
    expect(response.status).toBe(422)
    expect(mockedCheckQuota).not.toHaveBeenCalled()
  })

  it('returns 503 when HeyGen is not configured', async () => {
    video.findUnique
      .mockResolvedValueOnce({ userId: 'user-1' } as any)
      .mockResolvedValueOnce(COMPLETED_SOURCE as any)
    mockedIsConfigured.mockReturnValue(false)
    const response = await POST(request({ targetLanguage: 'Spanish' }), params())
    expect(response.status).toBe(503)
  })

  it('rejects when quota is exhausted', async () => {
    video.findUnique
      .mockResolvedValueOnce({ userId: 'user-1' } as any)
      .mockResolvedValueOnce(COMPLETED_SOURCE as any)
    mockedCheckQuota.mockResolvedValue({ allowed: false, reason: 'Monthly limit reached', upgradeRequired: true })
    const response = await POST(request({ targetLanguage: 'Spanish' }), params())
    expect(response.status).toBe(429)
    expect(mockedCreateTranslation).not.toHaveBeenCalled()
  })

  it('rejects a non-Pro plan even with purchased credits available', async () => {
    video.findUnique
      .mockResolvedValueOnce({ userId: 'user-1' } as any)
      .mockResolvedValueOnce(COMPLETED_SOURCE as any)
    mockedCheckQuota.mockResolvedValue({ allowed: true, plan: 'free', usePurchasedCredit: true })
    mockedAllowsDubbing.mockReturnValue(false)
    const response = await POST(request({ targetLanguage: 'Spanish' }), params())
    expect(response.status).toBe(403)
    expect(mockedCreateTranslation).not.toHaveBeenCalled()
  })

  it('starts a dub job for a valid request and returns a new videoId', async () => {
    video.findUnique
      .mockResolvedValueOnce({ userId: 'user-1' } as any)
      .mockResolvedValueOnce(COMPLETED_SOURCE as any)
    mockedCreateTranslation.mockResolvedValue(['vt_123'])
    video.create.mockResolvedValue({ id: 'new-video-1' } as any)

    const response = await POST(request({ targetLanguage: 'Spanish' }), params())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.videoId).toBe('new-video-1')
    expect(mockedCreateTranslation).toHaveBeenCalledWith({
      videoUrl: 'https://cdn.example.com/source.mp4',
      outputLanguages: ['Spanish'],
      mode: 'speed',
    })
    expect(video.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-1', status: 'QUEUED' }),
    }))
    expect(mockedSettle).toHaveBeenCalledWith('user-1', 'new-video-1', 30, expect.anything())

    // pollProviderJobToCompletion itself is mocked (its own behavior is
    // covered by tests/lib/provider-job-poll.test.ts); here we only check
    // this route wires it correctly — the right provider name, and a
    // successCost that bills HeyGen's REAL reported duration, falling back
    // to the pre-flight estimate only when HeyGen didn't return one.
    expect(mockedPoll).toHaveBeenCalledWith(expect.objectContaining({
      videoId: 'new-video-1',
      userId: 'user-1',
      providerName: 'heygen',
      prompt: expect.stringContaining('Spanish'),
    }))
    const pollArgs = mockedPoll.mock.calls[0][0]
    expect(pollArgs.successCost({ durationSeconds: 45 })).toEqual({ dubSeconds: 45 })
    expect(pollArgs.successCost({ durationSeconds: null })).toEqual({ dubSeconds: 30 })
  })
})
