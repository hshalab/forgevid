import { describe, it, expect, beforeEach } from '@jest/globals'
// NOTE: `jest` is intentionally the ambient global here, not imported from
// '@jest/globals' — with this repo's next/jest (SWC) transform, importing it
// breaks jest.mock() hoisting and the mock silently never applies (see
// tests/lib/quota.test.ts).

jest.mock('@/lib/prisma', () => ({
  prisma: {
    video: { create: jest.fn() },
    inventoryItem: { upsert: jest.fn(), updateMany: jest.fn() },
    inventorySnapshot: { create: jest.fn() },
  },
}))
jest.mock('@/lib/video-queue', () => ({ enqueueGeneration: jest.fn() }))
jest.mock('@/lib/generation-pipeline', () => ({ runGeneration: jest.fn() }))
jest.mock('@/lib/render-semaphore', () => ({ withRenderSlot: (fn: any) => fn() }))
jest.mock('@/lib/quota', () => ({
  checkGenerationQuota: jest.fn(),
  settleGenerationEntitlement: jest.fn(),
}))
jest.mock('@/lib/moderation', () => ({
  moderateText: jest.fn(),
  recordModerationBlock: jest.fn(),
}))
jest.mock('@/lib/site-images', () => ({ importSiteImages: jest.fn() }))

import { runFeedBatch, type FeedItem } from '@/lib/feed-batch'
import { prisma } from '@/lib/prisma'
import { checkGenerationQuota, settleGenerationEntitlement } from '@/lib/quota'
import { moderateText } from '@/lib/moderation'
import { importSiteImages } from '@/lib/site-images'
import { enqueueGeneration } from '@/lib/video-queue'

const mockedPrisma = prisma as any
const mockedQuota = checkGenerationQuota as jest.MockedFunction<typeof checkGenerationQuota>
const mockedModerate = moderateText as jest.MockedFunction<typeof moderateText>
const mockedImportImages = importSiteImages as jest.MockedFunction<typeof importSiteImages>
const mockedEnqueue = enqueueGeneration as jest.MockedFunction<typeof enqueueGeneration>

function makeItem(ref: string): FeedItem {
  return {
    ref,
    label: `Item ${ref}`,
    photos: ['https://example.com/a.jpg'],
    priceText: '$24,999',
    buildPrompt: () => 'a prompt',
    lowerThird: () => ({ title: 'x', facts: [], start: 0, duration: 1 }),
  }
}

const baseOpts = {
  userId: 'user-1',
  duration: 20,
  aspectRatio: '9:16' as const,
  voiceId: 'voice-1',
  renderQuality: 'full' as const,
};

describe('runFeedBatch inventory tracking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedQuota.mockResolvedValue({ allowed: true } as any)
    mockedModerate.mockResolvedValue({ allowed: true } as any)
    mockedImportImages.mockResolvedValue([{ assetId: 'asset-1' }] as any)
    mockedEnqueue.mockResolvedValue('job-1' as any)
    mockedPrisma.video.create.mockResolvedValue({ id: 'video-1' })
    mockedPrisma.inventoryItem.upsert.mockResolvedValue({ id: 'item-1' })
    mockedPrisma.inventorySnapshot.create.mockResolvedValue({ id: 'snap-1' })
  })

  it('records a snapshot with the videoId on a successful item when vertical is set', async () => {
    await runFeedBatch([makeItem('ref-1')], { ...baseOpts, vertical: 'auto' })

    expect(mockedPrisma.inventoryItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_vertical_externalRef: { userId: 'user-1', vertical: 'auto', externalRef: 'ref-1' } },
      }),
    )
    expect(mockedPrisma.inventorySnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ videoId: 'video-1', priceText: '$24,999' }) }),
    )
  })

  it('records a snapshot even when the item fails quota (photoCount 0, no videoId)', async () => {
    mockedQuota.mockResolvedValue({ allowed: false, reason: 'Quota exceeded' } as any)

    const result = await runFeedBatch([makeItem('ref-2')], { ...baseOpts, vertical: 'auto' })

    expect(result.failed).toBe(1)
    expect(mockedPrisma.inventorySnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ videoId: null }) }),
    )
  })

  it('never touches inventory tables when vertical is omitted (backward compatible)', async () => {
    await runFeedBatch([makeItem('ref-3')], baseOpts)

    expect(mockedPrisma.inventoryItem.upsert).not.toHaveBeenCalled()
    expect(mockedPrisma.inventorySnapshot.create).not.toHaveBeenCalled()
  })

  it('a tracking failure does not break the actual render', async () => {
    mockedPrisma.inventoryItem.upsert.mockRejectedValue(new Error('db hiccup'))

    const result = await runFeedBatch([makeItem('ref-4')], { ...baseOpts, vertical: 'auto' })

    expect(result.started).toBe(1)
    expect(result.results[0].videoId).toBe('video-1')
  })
})
