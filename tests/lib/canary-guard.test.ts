jest.mock('@/lib/prisma', () => ({
  prisma: {
    optimizationArtifact: { findMany: jest.fn(), findFirst: jest.fn() },
    generationEvaluation: { findMany: jest.fn() },
  },
}))
jest.mock('@/lib/optimization-registry', () => ({ transitionOptimization: jest.fn() }))
jest.mock('@/lib/evidence-ledger', () => ({ appendEvidence: jest.fn() }))

import { prisma } from '@/lib/prisma'
import { transitionOptimization } from '@/lib/optimization-registry'
import { appendEvidence } from '@/lib/evidence-ledger'
import { evaluateCanaries } from '@/lib/canary-guard'

const mockedArtifact = prisma.optimizationArtifact as jest.Mocked<typeof prisma.optimizationArtifact>
const mockedEval = prisma.generationEvaluation as jest.Mocked<typeof prisma.generationEvaluation>
const mockedTransition = transitionOptimization as jest.Mock
const mockedAppend = appendEvidence as jest.Mock

const OLD_DATE = new Date('2020-01-01T00:00:00.000Z') // far past → the 7-day window floor applies
const CANARY = { id: 'c1', kind: 'prompt', key: 'scene-planner', version: 3, updatedAt: OLD_DATE }

function rows(count: number, quality: number, passed: boolean) {
  return Array.from({ length: count }, () => ({ qualityScore: quality, qualityPassed: passed }))
}

describe('canary-guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedArtifact.findMany.mockResolvedValue([CANARY] as any)
    mockedArtifact.findFirst.mockResolvedValue({ version: 2 } as any)
    mockedTransition.mockResolvedValue({ id: 'c1' })
    mockedAppend.mockResolvedValue({ id: 'e1' })
  })

  it('does nothing when there are no live canaries', async () => {
    mockedArtifact.findMany.mockResolvedValue([])
    expect(await evaluateCanaries()).toEqual([])
    expect(mockedTransition).not.toHaveBeenCalled()
  })

  it('withholds judgment below the minimum sample size on either arm', async () => {
    mockedEval.findMany
      .mockResolvedValueOnce(rows(3, 40, false) as any) // canary — terrible but tiny
      .mockResolvedValueOnce(rows(50, 95, true) as any) // baseline
    const [verdict] = await evaluateCanaries()
    expect(verdict.action).toBe('insufficient_evidence')
    expect(mockedTransition).not.toHaveBeenCalled()
  })

  it('rolls back when canary quality drops more than the threshold below baseline', async () => {
    mockedEval.findMany
      .mockResolvedValueOnce(rows(20, 60, true) as any) // canary avg 60
      .mockResolvedValueOnce(rows(20, 90, true) as any) // baseline avg 90
    const [verdict] = await evaluateCanaries()
    expect(verdict.action).toBe('rolled_back')
    expect(mockedTransition).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: 'c1', action: 'rollback', actorUserId: 'system:canary-guard',
    }))
    expect(mockedAppend).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'optimization.auto_rollback', entityId: 'c1',
    }))
  })

  it('rolls back on a pass-rate collapse even when average quality holds', async () => {
    mockedEval.findMany
      .mockResolvedValueOnce([...rows(10, 90, true), ...rows(10, 90, false)] as any) // 50% pass
      .mockResolvedValueOnce(rows(20, 90, true) as any) // 100% pass
    const [verdict] = await evaluateCanaries()
    expect(verdict.action).toBe('rolled_back')
  })

  it('keeps a canary that shows no measurable regression', async () => {
    mockedEval.findMany
      .mockResolvedValueOnce(rows(20, 88, true) as any)
      .mockResolvedValueOnce(rows(20, 90, true) as any)
    const [verdict] = await evaluateCanaries()
    expect(verdict.action).toBe('kept')
    expect(mockedTransition).not.toHaveBeenCalled()
    expect(mockedAppend).not.toHaveBeenCalled()
  })

  it("compares against the pipeline's 'unversioned' label when no version was ever activated", async () => {
    mockedArtifact.findFirst.mockResolvedValue(null)
    mockedEval.findMany.mockResolvedValue(rows(20, 90, true) as any)
    await evaluateCanaries()
    const baselineQuery = mockedEval.findMany.mock.calls[1][0] as any
    expect(baselineQuery.where.promptVersion).toBe('unversioned')
  })

  it('only guards the scene-planner artifact — bare version strings would collide across kinds', async () => {
    await evaluateCanaries()
    expect(mockedArtifact.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'CANARY', kind: 'prompt', key: 'scene-planner' },
    }))
  })

  it('withholds judgment when canary and baseline resolve to the same version label', async () => {
    mockedArtifact.findMany.mockResolvedValue([{ ...CANARY, version: 2 }] as any)
    mockedArtifact.findFirst.mockResolvedValue({ version: 2 } as any) // same as canary
    const [verdict] = await evaluateCanaries()
    expect(verdict.action).toBe('insufficient_evidence')
    expect(verdict.reason).toContain('same version label')
    expect(mockedEval.findMany).not.toHaveBeenCalled()
  })

  it('floors the comparison window at the canary transition time', async () => {
    const recent = new Date(Date.now() - 60_000)
    mockedArtifact.findMany.mockResolvedValue([{ ...CANARY, updatedAt: recent }] as any)
    mockedEval.findMany.mockResolvedValue(rows(20, 90, true) as any)
    await evaluateCanaries()
    const canaryQuery = mockedEval.findMany.mock.calls[0][0] as any
    expect(canaryQuery.where.createdAt.gte).toEqual(recent)
  })
})
