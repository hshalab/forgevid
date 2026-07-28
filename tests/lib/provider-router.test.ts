jest.mock('@/lib/prisma', () => ({
  prisma: { providerObservation: { findMany: jest.fn() } },
}))
jest.mock('@/lib/learning-consent', () => ({
  productImprovementOptOuts: jest.fn().mockResolvedValue([]),
}))

import { prisma } from '@/lib/prisma'
import { productImprovementOptOuts } from '@/lib/learning-consent'
import { FRONTIER_MODELS, recommendFrontierModels } from '@/lib/provider-router'

const mockedObs = prisma.providerObservation as jest.Mocked<typeof prisma.providerObservation>
const mockedOptOuts = productImprovementOptOuts as jest.Mock

describe('provider-router', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedOptOuts.mockResolvedValue([])
    mockedObs.findMany.mockResolvedValue([])
  })

  it('falls back to conservative priors with zero evidence, sorted best-first', async () => {
    const recs = await recommendFrontierModels({ priority: 'balanced' }, 5)
    expect(recs).toHaveLength(5)
    expect(recs.every((r) => r.evidenceCount === 0)).toBe(true)
    expect(recs.every((r) => r.reason.includes('priors'))).toBe(true)
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1].score).toBeGreaterThanOrEqual(recs[i].score)
    }
  })

  it('replaces priors with measured evidence and says how much evidence it has', async () => {
    mockedObs.findMany.mockResolvedValue([
      { model: 'gen4.5', latencyMs: 30_000, costUsd: 0.12, qualityScore: 99, succeeded: true },
      { model: 'gen4.5', latencyMs: 32_000, costUsd: 0.12, qualityScore: 97, succeeded: true },
    ] as any)
    const recs = await recommendFrontierModels({}, 5)
    const gen45 = recs.find((r) => r.model === 'gen4.5')!
    expect(gen45.evidenceCount).toBe(2)
    expect(gen45.reason).toContain('2 recent matching provider observation')
    expect(gen45.predictedQuality).toBe(98)
    expect(gen45.predictedLatencyMs).toBe(31_000)
  })

  it('honors excludeModels', async () => {
    const recs = await recommendFrontierModels({ excludeModels: ['gen4.5', 'veo3.1'] }, 5)
    expect(recs.map((r) => r.model)).not.toContain('gen4.5')
    expect(recs.map((r) => r.model)).not.toContain('veo3.1')
    expect(recs).toHaveLength(FRONTIER_MODELS.length - 2)
  })

  it('excludes opted-out users from routing evidence, keeping system (null-user) rows', async () => {
    mockedOptOuts.mockResolvedValue(['opted-out-user'])
    await recommendFrontierModels({}, 3)
    const where = mockedObs.findMany.mock.calls[0][0]?.where as any
    const consentClause = (where.AND as any[]).find((c) => c.OR?.some((o: any) => 'userId' in o))
    expect(consentClause).toEqual({
      OR: [{ userId: null }, { userId: { notIn: ['opted-out-user'] } }],
    })
  })

  it('caps the result count and never returns fewer than one', async () => {
    expect(await recommendFrontierModels({}, 0)).toHaveLength(1)
    expect(await recommendFrontierModels({}, 99)).toHaveLength(FRONTIER_MODELS.length)
  })
})
