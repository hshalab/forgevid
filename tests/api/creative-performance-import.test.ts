jest.mock('next/server', () => {
  class MockNextRequest {
    private body: string
    constructor(_url: string, init: RequestInit = {}) {
      this.body = typeof init.body === 'string' ? init.body : ''
    }
    async text() { return this.body }
  }
  class MockNextResponse {
    status: number
    private body: any
    constructor(body: any, init: { status?: number } = {}) {
      this.body = body
      this.status = init.status ?? 200
    }
    static json(body: any, init: { status?: number } = {}) {
      return new MockNextResponse(body, init)
    }
    async json() { return this.body }
  }
  return { NextRequest: MockNextRequest, NextResponse: MockNextResponse }
})

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))
jest.mock('@/lib/evidence-ledger', () => ({ appendEvidence: jest.fn() }))
jest.mock('@/lib/ad-performance', () => ({ recomputeCampaignPerformance: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    adCreative: { findMany: jest.fn(), update: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  },
}))

import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { recomputeCampaignPerformance } from '@/lib/ad-performance'
import { POST } from '@/app/api/growth-operator/creative-performance/import/route'

const session = getServerSession as jest.MockedFunction<typeof getServerSession>
const adCreative = prisma.adCreative as jest.Mocked<typeof prisma.adCreative>
const mockedRecompute = recomputeCampaignPerformance as jest.Mock

function request(csv: string) {
  return new NextRequest('http://localhost/api/growth-operator/creative-performance/import', {
    method: 'POST',
    body: csv,
  })
}

describe('POST /api/growth-operator/creative-performance/import', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    session.mockResolvedValue({ user: { id: 'user-1' } } as any)
    adCreative.findMany.mockResolvedValue([{ id: 'creative-1', campaignId: 'campaign-1' }] as any)
  })

  it('requires authentication', async () => {
    session.mockResolvedValue(null)
    const response = await POST(request('creativeId,spendUsd\ncreative-1,100'))
    expect(response.status).toBe(401)
  })

  it('imports spend/impressions/clicks for an owned creative', async () => {
    const response = await POST(
      request('creativeId,spendUsd,impressions,clicks\ncreative-1,150.00,10000,320'),
    )
    expect(response.status).toBe(200)
    expect(adCreative.update).toHaveBeenCalledWith({
      where: { id: 'creative-1' },
      data: expect.objectContaining({ totalSpendCents: 15000, totalImpressions: 10000, totalClicks: 320 }),
    })
    expect(mockedRecompute).toHaveBeenCalledWith('campaign-1')
  })

  it('accepts totalSpendCents directly as an alternative to spendUsd', async () => {
    await POST(request('creativeId,totalSpendCents\ncreative-1,4250'))
    expect(adCreative.update).toHaveBeenCalledWith({
      where: { id: 'creative-1' },
      data: expect.objectContaining({ totalSpendCents: 4250 }),
    })
  })

  it('rejects a creative the caller does not own', async () => {
    adCreative.findMany.mockResolvedValue([] as any)
    const response = await POST(request('creativeId,spendUsd\nsomeone-elses-creative,50'))
    expect(response.status).toBe(403)
    expect(adCreative.update).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric spend value', async () => {
    const response = await POST(request('creativeId,spendUsd\ncreative-1,not-a-number'))
    expect(response.status).toBe(400)
    expect(adCreative.update).not.toHaveBeenCalled()
  })

  it('rejects a CSV missing the required creativeId column', async () => {
    const response = await POST(request('spendUsd\n100'))
    expect(response.status).toBe(400)
  })

  it('rejects an oversized CSV body', async () => {
    const huge = 'creativeId,spendUsd\n' + 'creative-1,10\n'.repeat(200_000)
    const response = await POST(request(huge))
    expect(response.status).toBe(413)
  })
})
