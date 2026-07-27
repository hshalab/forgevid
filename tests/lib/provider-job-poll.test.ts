jest.mock('@/lib/prisma', () => ({
  prisma: { video: { update: jest.fn() } },
}))
jest.mock('@/lib/generation-pipeline', () => ({ setStage: jest.fn() }))
jest.mock('@/lib/quota', () => ({ refundGenerationUsage: jest.fn() }))
jest.mock('@/lib/credits', () => ({ refundCreditForVideo: jest.fn() }))
jest.mock('@/lib/cost-ledger', () => ({
  estimateGenerationCost: jest.fn((inputs: unknown) => ({ ...(inputs as object), totalUsd: 1.23 })),
  recordGenerationCost: jest.fn(),
}))

import { prisma } from '@/lib/prisma'
import { setStage } from '@/lib/generation-pipeline'
import { refundGenerationUsage } from '@/lib/quota'
import { refundCreditForVideo } from '@/lib/credits'
import { recordGenerationCost } from '@/lib/cost-ledger'
import { pollProviderJobToCompletion } from '@/lib/provider-job-poll'

const video = prisma.video as jest.Mocked<typeof prisma.video>
const mockedSetStage = setStage as jest.Mock
const mockedRefundUsage = refundGenerationUsage as jest.Mock
const mockedRefundCredit = refundCreditForVideo as jest.Mock
const mockedRecordCost = recordGenerationCost as jest.Mock

// 1ms tick so these tests don't wait on real 5s/15min defaults. Deadline is
// generous (not just "a couple ticks") since real setTimeout/event-loop
// scheduling jitter can easily eat tens of ms in a busy test run.
const FAST = { pollIntervalMs: 1, pollDeadlineMs: 2000 }

describe('pollProviderJobToCompletion', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Real Promises (not bare jest.fn()'s `undefined` return) so the
    // `.catch(() => {})` chains in the failure path have something to call.
    video.update.mockResolvedValue({} as any)
    mockedSetStage.mockResolvedValue(undefined)
    mockedRefundUsage.mockResolvedValue(undefined)
    mockedRefundCredit.mockResolvedValue(undefined)
    mockedRecordCost.mockResolvedValue(undefined)
  })

  it('marks the video COMPLETED and books cost from successCost(status) on the first completed tick', async () => {
    const checkStatus = jest.fn().mockResolvedValue({
      status: 'completed',
      videoUrl: 'https://cdn.example.com/done.mp4',
      error: null,
    })
    const successCost = jest.fn().mockReturnValue({ avatarSeconds: 42 })

    await pollProviderJobToCompletion({
      videoId: 'v1',
      userId: 'u1',
      providerName: 'heygen',
      prompt: 'a script',
      checkStatus,
      successCost,
      ...FAST,
    })

    expect(video.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { status: 'PROCESSING' } })
    expect(video.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { status: 'COMPLETED', url: 'https://cdn.example.com/done.mp4', fileUrl: 'https://cdn.example.com/done.mp4' },
    })
    expect(mockedSetStage).toHaveBeenCalledWith('v1', 'done', expect.objectContaining({ provider: 'heygen' }))
    expect(successCost).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
    expect(mockedRecordCost).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1',
      videoId: 'v1',
      prompt: 'a script',
      succeeded: true,
      breakdown: expect.objectContaining({ avatarSeconds: 42 }),
    }))
    expect(mockedRefundUsage).not.toHaveBeenCalled()
  })

  it('keeps polling through non-terminal statuses before completing', async () => {
    const checkStatus = jest
      .fn()
      .mockResolvedValueOnce({ status: 'pending', videoUrl: null, error: null })
      .mockResolvedValueOnce({ status: 'running', videoUrl: null, error: null })
      .mockResolvedValueOnce({ status: 'completed', videoUrl: 'https://cdn.example.com/done.mp4', error: null })

    await pollProviderJobToCompletion({
      videoId: 'v1',
      userId: 'u1',
      providerName: 'heygen',
      prompt: 'p',
      checkStatus,
      successCost: () => ({}),
      ...FAST,
    })

    expect(checkStatus).toHaveBeenCalledTimes(3)
    expect(video.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }))
  })

  it('refunds quota and credits and records a failed cost row when the provider reports failure', async () => {
    const checkStatus = jest.fn().mockResolvedValue({ status: 'failed', videoUrl: null, error: 'provider says no' })

    await pollProviderJobToCompletion({
      videoId: 'v1',
      userId: 'u1',
      providerName: 'heygen',
      prompt: 'p',
      checkStatus,
      successCost: () => ({}),
      ...FAST,
    })

    expect(video.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { status: 'FAILED' } })
    expect(mockedSetStage).toHaveBeenCalledWith('v1', 'failed', { error: 'provider says no' })
    expect(mockedRefundUsage).toHaveBeenCalledWith('v1')
    expect(mockedRefundCredit).toHaveBeenCalledWith('v1')
    expect(mockedRecordCost).toHaveBeenCalledWith(expect.objectContaining({ succeeded: false }))
  })

  it('treats exceeding the deadline the same as a provider failure', async () => {
    const checkStatus = jest.fn().mockResolvedValue({ status: 'running', videoUrl: null, error: null })

    await pollProviderJobToCompletion({
      videoId: 'v1',
      userId: 'u1',
      providerName: 'heygen',
      prompt: 'p',
      checkStatus,
      successCost: () => ({}),
      pollIntervalMs: 1,
      pollDeadlineMs: 3,
    })

    expect(video.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { status: 'FAILED' } })
    expect(mockedSetStage).toHaveBeenCalledWith('v1', 'failed', expect.objectContaining({ error: expect.stringContaining('timed out') }))
    expect(mockedRefundUsage).toHaveBeenCalledWith('v1')
  })

  it('does not let a completed status with no videoUrl short-circuit as success', async () => {
    const checkStatus = jest
      .fn()
      .mockResolvedValueOnce({ status: 'completed', videoUrl: null, error: null }) // malformed — no url
      .mockResolvedValueOnce({ status: 'failed', videoUrl: null, error: 'no output produced' })

    await pollProviderJobToCompletion({
      videoId: 'v1',
      userId: 'u1',
      providerName: 'heygen',
      prompt: 'p',
      checkStatus,
      successCost: () => ({}),
      ...FAST,
    })

    expect(video.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { status: 'FAILED' } })
    expect(mockedRefundUsage).toHaveBeenCalled()
  })
})
