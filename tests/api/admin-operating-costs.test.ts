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

jest.mock('@/lib/rbac', () => ({
  getFreshSessionUser: jest.fn(),
  isAdminRole: jest.fn((role: string) => role === 'ADMIN'),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    operatingCost: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

import { NextRequest } from 'next/server'
import { GET, POST, PATCH, DELETE } from '@/app/api/admin/operating-costs/route'
import { getFreshSessionUser } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'

const mockedFreshSessionUser = getFreshSessionUser as jest.MockedFunction<typeof getFreshSessionUser>
const mockedCost = prisma.operatingCost as jest.Mocked<typeof prisma.operatingCost>

const adminA = { id: 'admin-a', email: 'a@example.com', role: 'ADMIN' as const }
const adminB = { id: 'admin-b', email: 'b@example.com', role: 'ADMIN' as const }

function req(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/admin/operating-costs', {
    method,
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('Admin Operating Costs API — tenant isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('GET scopes the query to the requesting admin', async () => {
    mockedFreshSessionUser.mockResolvedValue(adminA as any)
    mockedCost.findMany.mockResolvedValue([])
    await GET()
    expect(mockedCost.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: adminA.id } }))
  })

  it('POST creates the cost under the authenticated admin', async () => {
    mockedFreshSessionUser.mockResolvedValue(adminA as any)
    mockedCost.create.mockResolvedValue({ id: 'cost-1' } as any)
    await POST(req('POST', {
      category: 'hosting',
      description: 'Railway',
      amountCents: 2000,
      incurredOn: new Date().toISOString(),
    }))
    expect(mockedCost.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: adminA.id }) }),
    )
  })

  it('PATCH blocks an admin from editing another admin\'s cost', async () => {
    mockedFreshSessionUser.mockResolvedValue(adminA as any)
    mockedCost.findUnique.mockResolvedValue({ userId: adminB.id } as any)

    const response = await PATCH(req('PATCH', { id: 'cost-owned-by-b', description: 'changed' }))

    expect(response.status).toBe(403)
    expect(mockedCost.update).not.toHaveBeenCalled()
  })

  it('DELETE blocks an admin from deleting another admin\'s cost', async () => {
    mockedFreshSessionUser.mockResolvedValue(adminA as any)
    mockedCost.findUnique.mockResolvedValue({ userId: adminB.id } as any)

    const response = await DELETE(req('DELETE', { id: 'cost-owned-by-b' }))

    expect(response.status).toBe(403)
    expect(mockedCost.delete).not.toHaveBeenCalled()
  })

  it('rejects a negative or absurd amount at the schema level', async () => {
    mockedFreshSessionUser.mockResolvedValue(adminA as any)
    const response = await POST(req('POST', {
      category: 'hosting',
      description: 'x',
      amountCents: -100,
      incurredOn: new Date().toISOString(),
    }))
    expect(response.status).toBe(400)
    expect(mockedCost.create).not.toHaveBeenCalled()
  })
})
