jest.mock('next/server', () => {
  class MockNextRequest {
    private body: string | null
    constructor(_url: string, init: RequestInit = {}) {
      this.body = typeof init.body === 'string' ? init.body : null
    }
    async json() { return this.body ? JSON.parse(this.body) : null }
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
jest.mock('@/lib/prisma', () => ({
  prisma: {
    adCreative: { findFirst: jest.fn() },
    growthConversion: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
  },
}))

import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '@/app/api/growth-operator/conversions/route'

const session = getServerSession as jest.MockedFunction<typeof getServerSession>
const creative = prisma.adCreative as jest.Mocked<typeof prisma.adCreative>
const conversions = prisma.growthConversion as jest.Mocked<typeof prisma.growthConversion>

function request(body: unknown) {
  return new NextRequest('http://localhost/api/growth-operator/conversions', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('Growth conversion attribution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    session.mockResolvedValue({ user: { id: 'user-1' } } as any)
    creative.findFirst.mockResolvedValue({ id: 'creative-1' } as any)
    conversions.findFirst.mockResolvedValue(null)
    conversions.create.mockResolvedValue({
      id: 'conversion-1',
      creativeId: 'creative-1',
      kind: 'sale',
      source: 'manual',
      externalId: null,
      revenueCents: 9900,
      currency: 'usd',
      occurredAt: new Date('2026-07-25T20:00:00.000Z'),
    } as any)
  })

  it('requires authentication', async () => {
    session.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })

  it('lists only the signed-in customer records', async () => {
    conversions.findMany.mockResolvedValue([])
    await GET()
    expect(conversions.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1' },
    }))
  })

  it('refuses attribution to another customer creative', async () => {
    creative.findFirst.mockResolvedValue(null)
    const response = await POST(request({
      creativeId: 'other-creative',
      kind: 'sale',
      revenueCents: 1900,
      occurredAt: new Date().toISOString(),
    }))
    expect(response.status).toBe(404)
    expect(conversions.create).not.toHaveBeenCalled()
  })

  it('stores customer-supplied revenue without inferring it', async () => {
    await POST(request({
      creativeId: 'creative-1',
      kind: 'sale',
      revenueCents: 9900,
      contactRef: 'order-42',
      occurredAt: '2026-07-25T20:00:00.000Z',
    }))
    expect(conversions.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        creativeId: 'creative-1',
        revenueCents: 9900,
        contactRef: 'order-42',
      }),
    })
  })

  it('deduplicates an imported external conversion', async () => {
    conversions.findFirst.mockResolvedValue({ id: 'existing' } as any)
    const response = await POST(request({
      creativeId: 'creative-1',
      kind: 'appointment',
      source: 'crm',
      externalId: 'crm-7',
      occurredAt: new Date().toISOString(),
    }))
    expect(response.status).toBe(409)
    expect(conversions.create).not.toHaveBeenCalled()
  })
})
