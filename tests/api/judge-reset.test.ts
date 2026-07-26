jest.mock('next/server', () => {
  class MockNextResponse {
    status: number
    private body: any
    constructor(body: any, init: { status?: number } = {}) { this.body = body; this.status = init.status ?? 200 }
    static json(body: any, init: { status?: number } = {}) { return new MockNextResponse(body, init) }
    async json() { return this.body }
  }
  return { NextResponse: MockNextResponse }
})
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))
jest.mock('@/lib/evidence-ledger', () => ({ appendEvidence: jest.fn() }))

jest.mock('@/lib/prisma', () => {
  const tx: any = {
    adCreative: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
    creativeEvent: { deleteMany: jest.fn() },
    growthConversion: { deleteMany: jest.fn() },
    adCampaign: { deleteMany: jest.fn() },
    inventoryItem: { deleteMany: jest.fn(), create: jest.fn() },
    aIGeneration: { deleteMany: jest.fn() },
    usageRecord: { deleteMany: jest.fn() },
    notification: { deleteMany: jest.fn() },
    growthOperatorSchedule: { deleteMany: jest.fn() },
    impactAssumption: { deleteMany: jest.fn() },
    video: { deleteMany: jest.fn() },
  }
  return { prisma: { _tx: tx, $transaction: jest.fn(async (callback: any) => callback(tx)) } }
})

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { POST } from '@/app/api/judge/reset/route'

const session = getServerSession as jest.MockedFunction<typeof getServerSession>
const mockTx = (prisma as any)._tx

describe('judge deterministic reset', () => {
  beforeEach(() => jest.clearAllMocks())

  it('is unavailable to every non-judge account', async () => {
    session.mockResolvedValue({ user: { id: 'customer-1', email: 'customer@example.com' } } as any)
    expect((await POST()).status).toBe(403)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('scopes deletions and seeds to the judge user only', async () => {
    session.mockResolvedValue({ user: { id: 'judge-1', email: 'judge@forgevid.com' } } as any)
    const response = await POST()
    expect(response.status).toBe(200)
    expect(mockTx.video.deleteMany).toHaveBeenCalledWith({ where: { userId: 'judge-1' } })
    expect(mockTx.inventoryItem.create).toHaveBeenCalledTimes(3)
    expect(mockTx.inventoryItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'judge-1', externalRef: 'JUDGE-AUTO-001' }),
    })
  })
})
