jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    video: { findFirst: jest.fn(), update: jest.fn() },
  },
}))
jest.mock('@/lib/learning-system', () => ({ recordCustomerEvaluation: jest.fn() }))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { recordCustomerEvaluation } from '@/lib/learning-system'
import { GET, PATCH } from '@/app/api/videos/[videoId]/quality-review/route'

const session = getServerSession as jest.MockedFunction<typeof getServerSession>
const mockedVideo = prisma.video as jest.Mocked<typeof prisma.video>
const mockedRecord = recordCustomerEvaluation as jest.Mock

function props(videoId = 'video-1') {
  return { params: Promise.resolve({ videoId }) }
}

function patchReq(body: unknown) {
  return { json: async () => body } as any
}

const reviewVideo = {
  id: 'video-1',
  status: 'REVIEW_REQUIRED',
  metadata: JSON.stringify({ qualityGate: { passed: false, issues: ['black frames'] }, factCheck: { flagged: false } }),
  url: 'https://cdn.example.com/v.mp4',
  fileUrl: 'https://cdn.example.com/v.mp4',
  thumbnail: null,
}

describe('quality review (/api/videos/[videoId]/quality-review)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    session.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockedVideo.findFirst.mockResolvedValue(reviewVideo as any)
  })

  it('requires authentication on both verbs', async () => {
    session.mockResolvedValue(null)
    expect((await GET({} as any, props())).status).toBe(401)
    expect((await PATCH(patchReq({ action: 'accept' }), props())).status).toBe(401)
  })

  it('404s for a video the caller does not own — ownership is in the query itself', async () => {
    mockedVideo.findFirst.mockResolvedValue(null)
    const response = await GET({} as any, props('not-mine'))
    expect(response.status).toBe(404)
    expect(mockedVideo.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'not-mine', userId: 'user-1' },
    }))
  })

  it('GET surfaces the persisted quality gate and fact check', async () => {
    const response = await GET({} as any, props())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.qualityGate).toEqual({ passed: false, issues: ['black frames'] })
    expect(body.previewUrl).toBe('https://cdn.example.com/v.mp4')
  })

  it('accept flips REVIEW_REQUIRED to COMPLETED and records the customer evaluation', async () => {
    const response = await PATCH(patchReq({ action: 'accept', rating: 4 }), props())
    expect(response.status).toBe(200)
    expect(mockedVideo.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'video-1' },
      data: { status: 'COMPLETED' },
    }))
    expect(mockedRecord).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', videoId: 'video-1', accepted: true, rating: 4,
    }))
  })

  it('409s an accept for a video that is not awaiting review', async () => {
    mockedVideo.findFirst.mockResolvedValue({ ...reviewVideo, status: 'COMPLETED' } as any)
    const response = await PATCH(patchReq({ action: 'accept' }), props())
    expect(response.status).toBe(409)
    expect(mockedVideo.update).not.toHaveBeenCalled()
  })

  it('409s a reject for a video that is not awaiting review — no phantom evaluations', async () => {
    mockedVideo.findFirst.mockResolvedValue({ ...reviewVideo, status: 'COMPLETED' } as any)
    const response = await PATCH(patchReq({ action: 'reject' }), props())
    expect(response.status).toBe(409)
    expect(mockedRecord).not.toHaveBeenCalled()
  })

  it('reject records the evaluation without publishing the video', async () => {
    const response = await PATCH(patchReq({ action: 'reject', notes: 'wrong footage' }), props())
    expect(response.status).toBe(200)
    expect(mockedVideo.update).not.toHaveBeenCalled()
    expect(mockedRecord).toHaveBeenCalledWith(expect.objectContaining({
      accepted: false, editSummary: 'wrong footage',
    }))
  })

  it('rejects an unknown action', async () => {
    const response = await PATCH(patchReq({ action: 'publish' }), props())
    expect(response.status).toBe(400)
    expect(mockedRecord).not.toHaveBeenCalled()
  })

  it('ignores an out-of-range rating rather than persisting it', async () => {
    await PATCH(patchReq({ action: 'accept', rating: 11 }), props())
    expect(mockedRecord).toHaveBeenCalledWith(expect.objectContaining({ rating: null }))
  })
})
