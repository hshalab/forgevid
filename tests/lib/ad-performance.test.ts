jest.mock('@/lib/prisma', () => ({
  prisma: {
    adCreative: { findMany: jest.fn(), update: jest.fn() },
    growthConversion: { groupBy: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  },
}))

import { prisma } from '@/lib/prisma'
import { computeRoas, recomputeCampaignPerformance } from '@/lib/ad-performance'

const adCreative = prisma.adCreative as jest.Mocked<typeof prisma.adCreative>
const growthConversion = prisma.growthConversion as jest.Mocked<typeof prisma.growthConversion>

describe('computeRoas', () => {
  it('divides revenue by spend', () => {
    expect(computeRoas(10_000, 25_000)).toBe(2.5)
  })

  it('returns null when spend is zero, null, or undefined', () => {
    expect(computeRoas(0, 5000)).toBeNull()
    expect(computeRoas(null, 5000)).toBeNull()
    expect(computeRoas(undefined, 5000)).toBeNull()
  })

  it('rounds to 3 decimal places', () => {
    expect(computeRoas(3, 10)).toBe(3.333)
  })
})

describe('recomputeCampaignPerformance', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('does nothing when the campaign has no creatives', async () => {
    adCreative.findMany.mockResolvedValue([])
    await recomputeCampaignPerformance('campaign-1')
    expect(growthConversion.groupBy).not.toHaveBeenCalled()
    expect(adCreative.update).not.toHaveBeenCalled()
  })

  it('does nothing when no creative in the campaign has imported spend yet', async () => {
    adCreative.findMany.mockResolvedValue([{ id: 'a', totalSpendCents: null }] as any)
    await recomputeCampaignPerformance('campaign-1')
    // Never even queries revenue — nothing computable exists yet.
    expect(growthConversion.groupBy).not.toHaveBeenCalled()
    expect(adCreative.update).not.toHaveBeenCalled()
  })

  it('marks the single highest-ROAS creative as the winner and writes every roas', async () => {
    adCreative.findMany.mockResolvedValue([
      { id: 'a', totalSpendCents: 10_000 },
      { id: 'b', totalSpendCents: 20_000 },
    ] as any)
    growthConversion.groupBy.mockResolvedValue([
      { creativeId: 'a', _sum: { revenueCents: 5_000 } }, // roas 0.5
      { creativeId: 'b', _sum: { revenueCents: 60_000 } }, // roas 3.0
    ] as any)

    await recomputeCampaignPerformance('campaign-1')

    expect(adCreative.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { roas: 0.5, isWinner: false } })
    expect(adCreative.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: { roas: 3, isWinner: true } })
  })

  it('marks no winner on a tie', async () => {
    adCreative.findMany.mockResolvedValue([
      { id: 'a', totalSpendCents: 10_000 },
      { id: 'b', totalSpendCents: 10_000 },
    ] as any)
    growthConversion.groupBy.mockResolvedValue([
      { creativeId: 'a', _sum: { revenueCents: 20_000 } },
      { creativeId: 'b', _sum: { revenueCents: 20_000 } },
    ] as any)

    await recomputeCampaignPerformance('campaign-1')

    expect(adCreative.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { roas: 2, isWinner: false } })
    expect(adCreative.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: { roas: 2, isWinner: false } })
  })

  it('leaves a creative with no imported spend completely untouched, even alongside one that has spend', async () => {
    adCreative.findMany.mockResolvedValue([
      { id: 'a', totalSpendCents: null }, // e.g. manually marked a winner before real data existed
      { id: 'b', totalSpendCents: 10_000 },
    ] as any)
    growthConversion.groupBy.mockResolvedValue([{ creativeId: 'b', _sum: { revenueCents: 9_000 } }] as any)

    await recomputeCampaignPerformance('campaign-1')

    expect(adCreative.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'a' } }))
    expect(adCreative.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: { roas: 0.9, isWinner: true } })
    // Only the creative with spend was ever looked up for revenue.
    expect(growthConversion.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: { creativeId: { in: ['b'] } },
    }))
  })

  it('treats a creative with no conversions yet as zero revenue', async () => {
    adCreative.findMany.mockResolvedValue([{ id: 'a', totalSpendCents: 5_000 }] as any)
    growthConversion.groupBy.mockResolvedValue([] as any)

    await recomputeCampaignPerformance('campaign-1')

    expect(adCreative.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { roas: 0, isWinner: true } })
  })
})
