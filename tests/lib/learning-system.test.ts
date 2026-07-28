jest.mock('@/lib/prisma', () => ({
  prisma: {
    generationEvaluation: { upsert: jest.fn(), updateMany: jest.fn() },
    providerObservation: { create: jest.fn() },
    video: { findFirst: jest.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import {
  recordCustomerEvaluation,
  recordProviderObservation,
  upsertGenerationEvaluation,
} from '@/lib/learning-system'

const mockedEval = prisma.generationEvaluation as jest.Mocked<typeof prisma.generationEvaluation>
const mockedObs = prisma.providerObservation as jest.Mocked<typeof prisma.providerObservation>
const mockedVideo = prisma.video as jest.Mocked<typeof prisma.video>

describe('learning-system', () => {
  beforeEach(() => jest.clearAllMocks())

  it('upserts one evaluation per video, keyed by videoId', async () => {
    await upsertGenerationEvaluation({
      userId: 'user-1',
      videoId: 'video-1',
      provider: 'stock-assembler',
      model: 'scene-assembler',
      promptVersion: 'v2',
      qualityScore: 80,
      qualityPassed: true,
      factualPassed: false,
    })
    const call = mockedEval.upsert.mock.calls[0][0]
    expect(call.where).toEqual({ videoId: 'video-1' })
    expect(call.create).toEqual(expect.objectContaining({
      videoId: 'video-1', userId: 'user-1', promptVersion: 'v2', qualityPassed: true, factualPassed: false,
    }))
    expect(call.update).toEqual(expect.objectContaining({ qualityScore: 80 }))
  })

  it('truncates oversized failure reasons instead of persisting unbounded text', async () => {
    await upsertGenerationEvaluation({
      userId: 'user-1', videoId: 'video-1', provider: 'p', failureReason: 'x'.repeat(5000),
    })
    const call = mockedEval.upsert.mock.calls[0][0]
    expect((call.create as any).failureReason).toHaveLength(1000)
  })

  it('records provider observations with error codes capped at 200 chars', async () => {
    await recordProviderObservation({
      provider: 'runway', operation: 'frontier_video', latencyMs: 1200,
      succeeded: false, errorCode: 'e'.repeat(500),
    })
    const call = mockedObs.create.mock.calls[0][0]
    expect((call.data as any).errorCode).toHaveLength(200)
    expect((call.data as any).userId).toBeNull()
  })

  it('refuses a customer evaluation for a video the caller does not own', async () => {
    mockedVideo.findFirst.mockResolvedValue(null)
    await expect(
      recordCustomerEvaluation({ userId: 'intruder', videoId: 'someone-elses', accepted: true }),
    ).rejects.toThrow('Video not found')
    expect(mockedEval.updateMany).not.toHaveBeenCalled()
  })

  it('records an owned customer evaluation with rating bounds already validated upstream', async () => {
    mockedVideo.findFirst.mockResolvedValue({ id: 'video-1' } as any)
    mockedEval.updateMany.mockResolvedValue({ count: 1 } as any)
    await recordCustomerEvaluation({
      userId: 'user-1', videoId: 'video-1', accepted: false, rating: 2, editSummary: 'too dark',
    })
    expect(mockedEval.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { videoId: 'video-1' },
      data: expect.objectContaining({ customerAccepted: false, customerRating: 2, editSummary: 'too dark' }),
    }))
  })

  it('tolerates a missing evaluation row (opted-out user) — accept/reject must still work', async () => {
    mockedVideo.findFirst.mockResolvedValue({ id: 'video-1' } as any)
    mockedEval.updateMany.mockResolvedValue({ count: 0 } as any)
    await expect(
      recordCustomerEvaluation({ userId: 'user-1', videoId: 'video-1', accepted: true }),
    ).resolves.toBeUndefined()
  })
})
