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
    adCreative: { findMany: jest.fn() },
    growthConversion: { createMany: jest.fn() },
  },
}))

import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { recomputeCampaignPerformance } from '@/lib/ad-performance'
import { POST } from '@/app/api/growth-operator/conversions/import/route'

const session = getServerSession as jest.MockedFunction<typeof getServerSession>
const adCreative = prisma.adCreative as jest.Mocked<typeof prisma.adCreative>
const growthConversion = prisma.growthConversion as jest.Mocked<typeof prisma.growthConversion>
const mockedRecompute = recomputeCampaignPerformance as jest.Mock

function request(csv: string) {
  return new NextRequest('http://localhost/api/growth-operator/conversions/import', {
    method: 'POST',
    body: csv,
  })
}

const HEADER = 'creativeId,kind,occurredAt,externalId'

describe('POST /api/growth-operator/conversions/import', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    session.mockResolvedValue({ user: { id: 'user-1' } } as any)
    adCreative.findMany.mockResolvedValue([{ id: 'creative-1', campaignId: 'campaign-1' }] as any)
    growthConversion.createMany.mockResolvedValue({ count: 1 } as any)
  })

  it('requires authentication', async () => {
    session.mockResolvedValue(null)
    const response = await POST(request(`${HEADER}\ncreative-1,sale,2026-07-25T20:00:00.000Z,ext-1`))
    expect(response.status).toBe(401)
  })

  it('imports a row and recomputes performance for its campaign', async () => {
    const response = await POST(request(`${HEADER}\ncreative-1,sale,2026-07-25T20:00:00.000Z,ext-1`))
    expect(response.status).toBe(200)
    expect(growthConversion.createMany).toHaveBeenCalled()
    expect(mockedRecompute).toHaveBeenCalledWith('campaign-1')
  })

  it('rejects a creative the caller does not own', async () => {
    adCreative.findMany.mockResolvedValue([] as any)
    const response = await POST(request(`${HEADER}\nsomeone-elses,sale,2026-07-25T20:00:00.000Z,ext-1`))
    expect(response.status).toBe(403)
    expect(growthConversion.createMany).not.toHaveBeenCalled()
    expect(mockedRecompute).not.toHaveBeenCalled()
  })

  it('rejects a CSV missing a required column', async () => {
    const response = await POST(request('creativeId,kind\ncreative-1,sale'))
    expect(response.status).toBe(400)
  })
})
