/**
 * lib/quota.ts unit tests — no database. Prisma / lib/plan / lib/credits are
 * all mocked, following the pattern in tests/api/ai.test.ts
 * (jest.mock('@/lib/prisma', ...)).
 *
 * The behavior under test is the two-pool fallback added for the 2026-07
 * credit-system relaunch: once the monthly UsageRecord allowance is
 * exhausted, checkGenerationQuota must consult the purchased-credit balance
 * before denying, and the resulting verdict must carry usePurchasedCredit /
 * topUpAvailable correctly for the caller (app/api/ai/route.ts) to act on.
 */
import { describe, it, expect, beforeEach } from '@jest/globals'
// NOTE: `jest` itself is intentionally the ambient global here, not imported
// from '@jest/globals' — with this repo's next/jest (SWC) transform, importing
// it breaks jest.mock() hoisting and the mock silently never applies.

jest.mock('@/lib/prisma', () => ({
  prisma: {
    usageRecord: {
      aggregate: jest.fn(),
      create: jest.fn(),
    },
  },
}))

jest.mock('@/lib/plan', () => ({
  getUserPlan: jest.fn(),
}))

jest.mock('@/lib/credits', () => ({
  getCreditBalance: jest.fn(),
  consumeCredit: jest.fn(),
}))

import { prisma } from '@/lib/prisma'
import { getUserPlan } from '@/lib/plan'
import { getCreditBalance, consumeCredit } from '@/lib/credits'
import {
  checkGenerationQuota,
  settleGenerationEntitlement,
  PLAN_QUOTAS,
  PURCHASED_CREDIT_MIN_DURATION_SECONDS,
  type QuotaVerdict,
} from '@/lib/quota'

const mockPrisma = prisma as jest.Mocked<typeof prisma>
const mockGetUserPlan = getUserPlan as jest.Mock
const mockGetCreditBalance = getCreditBalance as jest.Mock
const mockConsumeCredit = consumeCredit as jest.Mock

describe('checkGenerationQuota', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('allows a generation within the plan duration cap and monthly allowance', async () => {
    mockGetUserPlan.mockResolvedValue('free')
    mockPrisma.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: 0 } } as any)

    const verdict = await checkGenerationQuota('user-1', 30)

    expect(verdict.allowed).toBe(true)
    expect(verdict.usePurchasedCredit).toBeUndefined()
    expect(mockGetCreditBalance).not.toHaveBeenCalled()
  })

  it('denies outright when duration exceeds the plan cap, without ever consulting credits', async () => {
    mockGetUserPlan.mockResolvedValue('free')

    const verdict = await checkGenerationQuota('user-1', PLAN_QUOTAS.free.maxDurationSeconds + 1)

    expect(verdict.allowed).toBe(false)
    expect(mockGetCreditBalance).not.toHaveBeenCalled()
    expect(mockPrisma.usageRecord.aggregate).not.toHaveBeenCalled()
  })

  it('falls back to a purchased credit once the monthly limit is hit and balance > 0', async () => {
    mockGetUserPlan.mockResolvedValue('free')
    mockPrisma.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: PLAN_QUOTAS.free.videosPerMonth } } as any)
    mockGetCreditBalance.mockResolvedValue(3)

    const verdict = await checkGenerationQuota('user-1', 30)

    expect(verdict.allowed).toBe(true)
    expect(verdict.usePurchasedCredit).toBe(true)
    // max(plan cap, 90) — free plan's cap (60) is below the purchased-credit floor.
    expect(verdict.maxDurationSeconds).toBe(PURCHASED_CREDIT_MIN_DURATION_SECONDS)
  })

  it('gives a pro-plan purchased-credit render its own (higher) cap when it beats 90s', async () => {
    mockGetUserPlan.mockResolvedValue('pro')
    mockPrisma.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: PLAN_QUOTAS.pro.videosPerMonth } } as any)
    mockGetCreditBalance.mockResolvedValue(1)

    const verdict = await checkGenerationQuota('user-1', 100)

    expect(verdict.allowed).toBe(true)
    expect(verdict.usePurchasedCredit).toBe(true)
    expect(verdict.maxDurationSeconds).toBe(PLAN_QUOTAS.pro.maxDurationSeconds) // 120 > 90
  })

  it('denies with topUpAvailable when the monthly limit is hit and the balance is 0', async () => {
    mockGetUserPlan.mockResolvedValue('free')
    mockPrisma.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: PLAN_QUOTAS.free.videosPerMonth } } as any)
    mockGetCreditBalance.mockResolvedValue(0)

    const verdict = await checkGenerationQuota('user-1', 30)

    expect(verdict.allowed).toBe(false)
    expect(verdict.usePurchasedCredit).toBeUndefined()
    expect(verdict.topUpAvailable).toBe(true)
    expect(verdict.reason).toMatch(/top-up/i)
  })

  it('fails CLOSED (denies, no credit fallback) when the usage lookup errors', async () => {
    mockGetUserPlan.mockResolvedValue('free')
    mockPrisma.usageRecord.aggregate.mockRejectedValue(new Error('db unreachable'))

    const verdict = await checkGenerationQuota('user-1', 30)

    expect(verdict.allowed).toBe(false)
    expect(mockGetCreditBalance).not.toHaveBeenCalled()
  })

  // creditCost > 1 — the avatar-render case ($0.50/min on the provider makes
  // a single credit a loss, so avatars/generate passes creditCost: 2).
  describe('creditCost > 1 (e.g. avatar renders)', () => {
    it('denies with topUpAvailable when the balance (1) is below the cost (2)', async () => {
      mockGetUserPlan.mockResolvedValue('pro')
      mockPrisma.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: PLAN_QUOTAS.pro.videosPerMonth } } as any)
      mockGetCreditBalance.mockResolvedValue(1)

      const verdict = await checkGenerationQuota('user-1', 60, 2)

      expect(verdict.allowed).toBe(false)
      expect(verdict.usePurchasedCredit).toBeUndefined()
      expect(verdict.topUpAvailable).toBe(true)
      expect(verdict.reason).toMatch(/2 purchased credits/i)
    })

    it('allows with usePurchasedCredit + creditCost 2 when the balance (2) covers the cost (2)', async () => {
      mockGetUserPlan.mockResolvedValue('pro')
      mockPrisma.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: PLAN_QUOTAS.pro.videosPerMonth } } as any)
      mockGetCreditBalance.mockResolvedValue(2)

      const verdict = await checkGenerationQuota('user-1', 60, 2)

      expect(verdict.allowed).toBe(true)
      expect(verdict.usePurchasedCredit).toBe(true)
      expect(verdict.creditCost).toBe(2)
    })
  })

  // Weighted MONTHLY pool (2026-07-28 frontier repricing): a premium
  // generation consumes creditCost UNITS of the monthly allowance, not one
  // flat slot — otherwise 100 kling generations (~$4.10 each) would cost
  // ~4x the Pro subscription price inside the "included" allowance.
  describe('weighted monthly units', () => {
    it('a premium generation needs its FULL weight of monthly room, not just one slot', async () => {
      mockGetUserPlan.mockResolvedValue('pro')
      // 97/100 used → 3 units of room, but a kling generation weighs 5.
      mockPrisma.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: 97 } } as any)
      mockGetCreditBalance.mockResolvedValue(10)

      const verdict = await checkGenerationQuota('user-1', 10, 5)

      // Falls to purchased credits for the whole cost — never split across pools.
      expect(verdict.allowed).toBe(true)
      expect(verdict.usePurchasedCredit).toBe(true)
      expect(verdict.creditCost).toBe(5)
    })

    it('a premium generation fits when the monthly pool has its full weight of room', async () => {
      mockGetUserPlan.mockResolvedValue('pro')
      mockPrisma.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: 95 } } as any)

      const verdict = await checkGenerationQuota('user-1', 10, 5)

      expect(verdict.allowed).toBe(true)
      expect(verdict.usePurchasedCredit).toBeUndefined()
      expect(verdict.creditCost).toBe(5)
      expect(mockGetCreditBalance).not.toHaveBeenCalled()
    })

    it('treats a month with no usage rows (null sum) as zero used', async () => {
      mockGetUserPlan.mockResolvedValue('free')
      mockPrisma.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: null } } as any)

      const verdict = await checkGenerationQuota('user-1', 30)

      expect(verdict.allowed).toBe(true)
      expect(verdict.used).toBe(0)
    })
  })
})

describe('settleGenerationEntitlement', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const baseVerdict: QuotaVerdict = {
    allowed: true,
    plan: 'free',
    used: 2,
    limit: 2,
    maxDurationSeconds: 90,
  }

  it('always records monthly usage, and does not touch credits when usePurchasedCredit is unset', async () => {
    mockPrisma.usageRecord.create.mockResolvedValue({} as any)

    await settleGenerationEntitlement('user-1', 'video-1', 30, baseVerdict)

    expect(mockPrisma.usageRecord.create).toHaveBeenCalledTimes(1)
    expect(mockConsumeCredit).not.toHaveBeenCalled()
  })

  it('consumes verdict.creditCost purchased credits (defaulting to 1) alongside usage', async () => {
    mockPrisma.usageRecord.create.mockResolvedValue({} as any)

    await settleGenerationEntitlement('user-1', 'video-1', 30, {
      ...baseVerdict,
      usePurchasedCredit: true,
    })

    expect(mockConsumeCredit).toHaveBeenCalledWith({ userId: 'user-1', videoId: 'video-1', credits: 1 })
  })

  it('records the generation WEIGHT as the usage quantity — premium generations consume more monthly units', async () => {
    mockPrisma.usageRecord.create.mockResolvedValue({} as any)

    await settleGenerationEntitlement('user-1', 'video-kling-1', 10, {
      ...baseVerdict,
      creditCost: 5,
    })

    expect(mockPrisma.usageRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ quantity: 5 }),
    }))
    expect(mockConsumeCredit).not.toHaveBeenCalled()
  })

  it('consumes exactly the avatar 2-credit cost when the verdict priced it in', async () => {
    mockPrisma.usageRecord.create.mockResolvedValue({} as any)

    await settleGenerationEntitlement('user-1', 'video-avatar-1', 60, {
      ...baseVerdict,
      usePurchasedCredit: true,
      creditCost: 2,
    })

    expect(mockConsumeCredit).toHaveBeenCalledWith({
      userId: 'user-1',
      videoId: 'video-avatar-1',
      credits: 2,
    })
  })
})
