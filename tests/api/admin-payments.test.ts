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

jest.mock('@/lib/rbac', () => {
  const getFreshSessionUser = jest.fn()
  const isAdminRole = jest.fn((role: string) => role === 'ADMIN')
  return {
    getFreshSessionUser,
    isAdminRole,
    requireAdmin: jest.fn(async () => {
      const user = await getFreshSessionUser()
      if (!user || !isAdminRole(user.role)) return null
      return user
    }),
  }
})

jest.mock('@/lib/prisma', () => ({
  prisma: {
    payment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}))

jest.mock('@/lib/evidence-ledger', () => ({ appendEvidence: jest.fn() }))

import { NextRequest } from 'next/server'
import { GET, PATCH } from '@/app/api/admin/payments/route'
import { prisma } from '@/lib/prisma'
import { getFreshSessionUser } from '@/lib/rbac'
import { appendEvidence } from '@/lib/evidence-ledger'

const mockedSession = getFreshSessionUser as jest.Mock
const mockedPayment = prisma.payment as jest.Mocked<typeof prisma.payment>
const mockedAppend = appendEvidence as jest.Mock

function patchReq(body: unknown) {
  return new NextRequest('http://localhost/api/admin/payments', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

describe('Admin payments ledger (/api/admin/payments)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedSession.mockResolvedValue({ id: 'admin-1', role: 'ADMIN' })
    mockedAppend.mockResolvedValue({ id: 'evidence-1' })
  })

  it('rejects a non-admin on GET and PATCH', async () => {
    mockedSession.mockResolvedValue({ id: 'user-1', role: 'USER' })
    expect((await GET()).status).toBe(403)
    expect((await PATCH(patchReq({ id: 'p1', isRelatedParty: true }))).status).toBe(403)
    expect(mockedPayment.updateMany).not.toHaveBeenCalled()
  })

  it('lists payments newest-first', async () => {
    mockedPayment.findMany.mockResolvedValue([{ id: 'p1' }] as any)
    const response = await GET()
    expect(response.status).toBe(200)
    expect((await response.json()).payments).toEqual([{ id: 'p1' }])
    expect(mockedPayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    )
  })

  it('flips isRelatedParty with a compare-and-set and appends the flip to the evidence chain', async () => {
    mockedPayment.findUnique.mockResolvedValue({ id: 'p1', isRelatedParty: false } as any)
    mockedPayment.updateMany.mockResolvedValue({ count: 1 } as any)

    const response = await PATCH(patchReq({ id: 'p1', isRelatedParty: true }))
    expect(response.status).toBe(200)
    expect((await response.json()).payment).toEqual({ id: 'p1', isRelatedParty: true })
    expect(mockedPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1', isRelatedParty: false },
        data: { isRelatedParty: true },
      }),
    )
    expect(mockedAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'payment.related_party_flag',
        entityId: 'p1',
        actorUserId: 'admin-1',
        payload: { from: false, to: true },
      }),
    )
  })

  it('is a no-op (no update, no evidence) when the flag is unchanged', async () => {
    mockedPayment.findUnique.mockResolvedValue({ id: 'p1', isRelatedParty: true } as any)
    const response = await PATCH(patchReq({ id: 'p1', isRelatedParty: true }))
    expect(response.status).toBe(200)
    expect(mockedPayment.updateMany).not.toHaveBeenCalled()
    expect(mockedAppend).not.toHaveBeenCalled()
  })

  it('appends no evidence when a concurrent flip wins the compare-and-set', async () => {
    mockedPayment.findUnique
      .mockResolvedValueOnce({ id: 'p1', isRelatedParty: false } as any)
      .mockResolvedValueOnce({ id: 'p1', isRelatedParty: true } as any)
    mockedPayment.updateMany.mockResolvedValue({ count: 0 } as any)

    const response = await PATCH(patchReq({ id: 'p1', isRelatedParty: true }))
    expect(response.status).toBe(200)
    expect((await response.json()).payment).toEqual({ id: 'p1', isRelatedParty: true })
    expect(mockedAppend).not.toHaveBeenCalled()
  })

  it('404s for an unknown payment', async () => {
    mockedPayment.findUnique.mockResolvedValue(null)
    const response = await PATCH(patchReq({ id: 'missing', isRelatedParty: true }))
    expect(response.status).toBe(404)
  })
})
