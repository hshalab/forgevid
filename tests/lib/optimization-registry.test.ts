jest.mock('@/lib/prisma', () => ({
  prisma: {
    optimizationArtifact: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    optimizationAssignment: { upsert: jest.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { resolveOptimization, transitionOptimization } from '@/lib/optimization-registry'

const mockedArtifact = prisma.optimizationArtifact as jest.Mocked<typeof prisma.optimizationArtifact>
const mockedAssignment = prisma.optimizationAssignment as jest.Mocked<typeof prisma.optimizationAssignment>

describe('optimization-registry', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedArtifact.update.mockImplementation((async (args: any) => ({ id: args.where.id, ...args.data })) as any)
    mockedAssignment.upsert.mockResolvedValue({} as any)
  })

  describe('resolveOptimization', () => {
    it('returns the ACTIVE artifact when no canary exists', async () => {
      const active = { id: 'a1', status: 'ACTIVE', canaryPercent: 0 }
      mockedArtifact.findMany.mockResolvedValue([active] as any)
      expect(await resolveOptimization('prompt', 'scene-planner', 'user-1')).toBe(active)
      expect(mockedAssignment.upsert).not.toHaveBeenCalled()
    })

    it('returns null when nothing is ACTIVE or CANARY — callers fall back to defaults', async () => {
      mockedArtifact.findMany.mockResolvedValue([])
      expect(await resolveOptimization('prompt', 'scene-planner', 'user-1')).toBeNull()
    })

    it('assigns a stable bucket and routes deterministically for a canary', async () => {
      const active = { id: 'a1', status: 'ACTIVE', canaryPercent: 0 }
      const canary = { id: 'c1', status: 'CANARY', canaryPercent: 50 }
      mockedArtifact.findMany.mockResolvedValue([canary, active] as any)

      const first = await resolveOptimization('prompt', 'scene-planner', 'user-1')
      const second = await resolveOptimization('prompt', 'scene-planner', 'user-1')
      // Same user + artifact → same bucket → same routing decision, always.
      expect(second).toBe(first === canary ? canary : active)
      expect(first === canary || first === active).toBe(true)

      const recordedBucket = (mockedAssignment.upsert.mock.calls[0][0] as any).create.bucket
      expect(recordedBucket).toBeGreaterThanOrEqual(0)
      expect(recordedBucket).toBeLessThan(100)
      expect((first === canary) === (recordedBucket < 50)).toBe(true)
    })
  })

  describe('transitionOptimization', () => {
    it('refuses to canary an unapproved draft', async () => {
      mockedArtifact.findUnique.mockResolvedValue({ id: 'x', status: 'DRAFT' } as any)
      await expect(
        transitionOptimization({ artifactId: 'x', actorUserId: 'admin', action: 'canary' }),
      ).rejects.toThrow('Approve before canary')
    })

    it('clamps canary percent to [1, 50]', async () => {
      mockedArtifact.findUnique.mockResolvedValue({ id: 'x', status: 'APPROVED' } as any)
      await transitionOptimization({ artifactId: 'x', actorUserId: 'admin', action: 'canary', canaryPercent: 90 })
      expect(mockedArtifact.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { status: 'CANARY', canaryPercent: 50 },
      }))
    })

    it('activating supersedes the previous ACTIVE version of the same kind+key', async () => {
      mockedArtifact.findUnique.mockResolvedValue({ id: 'x', status: 'CANARY', kind: 'prompt', key: 'scene-planner', version: 3 } as any)
      await transitionOptimization({ artifactId: 'x', actorUserId: 'admin', action: 'activate' })
      expect(mockedArtifact.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { kind: 'prompt', key: 'scene-planner', status: 'ACTIVE' },
        data: expect.objectContaining({ status: 'ROLLED_BACK' }),
      }))
      expect(mockedArtifact.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'ACTIVE', canaryPercent: 0 }),
      }))
    })

    it('refuses to activate a DRAFT — the staged approve/canary flow cannot be skipped', async () => {
      mockedArtifact.findUnique.mockResolvedValue({ id: 'x', status: 'DRAFT' } as any)
      await expect(
        transitionOptimization({ artifactId: 'x', actorUserId: 'admin', action: 'activate' }),
      ).rejects.toThrow('Approve')
    })

    it('refuses to approve anything but a DRAFT — approving ACTIVE would demote it', async () => {
      mockedArtifact.findUnique.mockResolvedValue({ id: 'x', status: 'ACTIVE' } as any)
      await expect(
        transitionOptimization({ artifactId: 'x', actorUserId: 'admin', action: 'approve' }),
      ).rejects.toThrow('Only a draft')
    })

    it('rollback records the reason and zeroes the canary', async () => {
      mockedArtifact.findUnique.mockResolvedValue({ id: 'x', status: 'CANARY' } as any)
      await transitionOptimization({ artifactId: 'x', actorUserId: 'admin', action: 'rollback', reason: 'regressed quality' })
      expect(mockedArtifact.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'ROLLED_BACK', canaryPercent: 0, rollbackReason: 'regressed quality' }),
      }))
    })
  })
})
