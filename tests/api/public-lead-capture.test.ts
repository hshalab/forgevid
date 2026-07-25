jest.mock('next/server', () => {
  class MockNextRequest {
    url: string
    method: string
    headers: Map<string, string>
    nextUrl: URL
    private _body: string | null

    constructor(url: string, init: RequestInit = {}) {
      this.url = url
      this.method = init.method ?? 'GET'
      this.headers = new Map(Object.entries((init.headers as Record<string, string>) ?? {}))
      this.nextUrl = new URL(url)
      this._body = typeof init.body === 'string' ? init.body : init.body ? JSON.stringify(init.body) : null
    }

    async json() {
      if (!this._body) return null
      return JSON.parse(this._body)
    }
  }

  class MockNextResponse {
    status: number
    private _body: any

    constructor(body: any, init: { status?: number } = {}) {
      this._body = body
      this.status = init.status ?? 200
    }

    static json(body: any, init: { status?: number } = {}) {
      return new MockNextResponse(body, init)
    }

    async json() {
      return this._body
    }
  }

  return { NextRequest: MockNextRequest, NextResponse: MockNextResponse }
})

jest.mock('@/lib/prisma', () => ({
  prisma: {
    adCreative: { findUnique: jest.fn() },
    creativeEvent: { create: jest.fn() },
  },
}))

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/l/[id]/route'
import { prisma } from '@/lib/prisma'

const mockedAdCreative = prisma.adCreative as jest.Mocked<typeof prisma.adCreative>
const mockedCreativeEvent = prisma.creativeEvent as jest.Mocked<typeof prisma.creativeEvent>

function req(body: unknown, ip = '1.2.3.4') {
  return new NextRequest('http://localhost/api/l/creative-1', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

function params(id = 'creative-1') {
  return { params: Promise.resolve({ id }) }
}

describe('Public lead capture (/api/l/[id])', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedAdCreative.findUnique.mockResolvedValue({ id: 'creative-1' } as any)
    mockedCreativeEvent.create.mockResolvedValue({ id: 'event-1' } as any)
  })

  it('requires an email or phone', async () => {
    const response = await POST(req({ name: 'A visitor', message: 'hi' }, '10.0.0.1'), params())
    expect(response.status).toBe(400)
    expect(mockedCreativeEvent.create).not.toHaveBeenCalled()
  })

  it('accepts a submission with only an email', async () => {
    const response = await POST(req({ email: 'buyer@example.com' }, '10.0.0.2'), params())
    expect(response.status).toBe(200)
    expect(mockedCreativeEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ creativeId: 'creative-1', kind: 'lead_submitted', email: 'buyer@example.com' }),
      }),
    )
  })

  it('404s for a creative that does not exist, without creating an event', async () => {
    mockedAdCreative.findUnique.mockResolvedValue(null)
    const response = await POST(req({ email: 'buyer@example.com' }, '10.0.0.3'), params('does-not-exist'))
    expect(response.status).toBe(404)
    expect(mockedCreativeEvent.create).not.toHaveBeenCalled()
  })

  it('rejects an invalid email format', async () => {
    const response = await POST(req({ email: 'not-an-email' }, '10.0.0.4'), params())
    expect(response.status).toBe(400)
  })

  it('rate-limits repeated submissions from the same IP', async () => {
    const ip = '10.0.0.5'
    let last
    for (let i = 0; i < 5; i++) {
      last = await POST(req({ email: `buyer${i}@example.com` }, ip), params())
      expect(last.status).toBe(200)
    }
    const sixth = await POST(req({ email: 'buyer6@example.com' }, ip), params())
    expect(sixth.status).toBe(429)
  })

  it('does not rate-limit a different IP after another IP is throttled', async () => {
    const throttledIp = '10.0.0.6'
    for (let i = 0; i < 5; i++) {
      await POST(req({ email: `x${i}@example.com` }, throttledIp), params())
    }
    const stillThrottled = await POST(req({ email: 'x6@example.com' }, throttledIp), params())
    expect(stillThrottled.status).toBe(429)

    const freshIp = await POST(req({ email: 'fresh@example.com' }, '10.0.0.7'), params())
    expect(freshIp.status).toBe(200)
  })
})
