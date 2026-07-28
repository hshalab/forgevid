jest.mock('@/lib/prisma', () => ({
  prisma: {
    learningConsent: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  },
}))

import { prisma } from '@/lib/prisma'
import {
  allowsProductImprovement,
  productImprovementOptOuts,
  recordLearningConsent,
} from '@/lib/learning-consent'

const mockedConsent = prisma.learningConsent as jest.Mocked<typeof prisma.learningConsent>

describe('learning-consent', () => {
  beforeEach(() => jest.clearAllMocks())

  it('defaults to INCLUDED when the user never made a choice', async () => {
    mockedConsent.findFirst.mockResolvedValue(null)
    expect(await allowsProductImprovement('user-1')).toBe(true)
  })

  it('honors an explicit opt-out', async () => {
    mockedConsent.findFirst.mockResolvedValue({ granted: false } as any)
    expect(await allowsProductImprovement('user-1')).toBe(false)
  })

  it('recording a choice revokes the prior row and appends a new one — history preserved', async () => {
    await recordLearningConsent({
      userId: 'user-1', purpose: 'product_improvement', granted: false, source: 'settings',
    })
    expect(mockedConsent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1', purpose: 'product_improvement', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    }))
    expect(mockedConsent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'user-1', purpose: 'product_improvement', granted: false,
        policyVersion: 'learning-policy-v1', source: 'settings',
      }),
    }))
  })

  it('serializes voice-clone evidence into the consent row', async () => {
    await recordLearningConsent({
      userId: 'user-1', purpose: 'voice_clone', granted: true, source: 'voice_clone',
      policyVersion: 'voice-consent-v1',
      evidence: { voiceId: 'v1', authorizationBasis: 'authorized', subjectName: 'A Speaker' },
    })
    const created = mockedConsent.create.mock.calls[0][0].data as any
    expect(created.policyVersion).toBe('voice-consent-v1')
    expect(JSON.parse(created.evidence)).toEqual(
      expect.objectContaining({ voiceId: 'v1', authorizationBasis: 'authorized' }),
    )
  })

  it('voice_clone rows are append-only — cloning voice B never revokes voice A\'s consent row', async () => {
    await recordLearningConsent({
      userId: 'user-1', purpose: 'voice_clone', granted: true, source: 'voice_clone',
      evidence: { voiceId: 'voice-b' },
    })
    expect(mockedConsent.updateMany).not.toHaveBeenCalled()
    expect(mockedConsent.create).toHaveBeenCalled()
  })

  it('lists only currently-opted-out users for the router filter', async () => {
    mockedConsent.findMany.mockResolvedValue([{ userId: 'a' }, { userId: 'b' }] as any)
    expect(await productImprovementOptOuts()).toEqual(['a', 'b'])
    expect(mockedConsent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { purpose: 'product_improvement', granted: false, revokedAt: null },
    }))
  })
})
