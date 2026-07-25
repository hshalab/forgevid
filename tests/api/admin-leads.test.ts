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
    headers: Map<string, string>
    private _body: any

    constructor(body: any, init: { status?: number; headers?: Record<string, string> } = {}) {
      this._body = body
      this.status = init.status ?? 200
      this.headers = new Map(Object.entries(init.headers ?? {}))
    }

    static json(body: any, init: { status?: number; headers?: Record<string, string> } = {}) {
      return new MockNextResponse(body, init)
    }

    async json() {
      return this._body
    }
  }

  return {
    NextRequest: MockNextRequest,
    NextResponse: MockNextResponse,
  }
})

jest.mock('@/lib/rbac', () => ({
  getFreshSessionUser: jest.fn(),
  isAdminRole: jest.fn((role: string) => role === 'ADMIN'),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    lead: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

import { NextRequest } from 'next/server'
import { GET, POST, PATCH, DELETE } from '@/app/api/admin/leads/route'
import { getFreshSessionUser } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'

const mockedFreshSessionUser = getFreshSessionUser as jest.MockedFunction<typeof getFreshSessionUser>
const mockedLead = prisma.lead as jest.Mocked<typeof prisma.lead>

const adminA = { id: 'admin-a', email: 'a@example.com', role: 'ADMIN' as const }
const adminB = { id: 'admin-b', email: 'b@example.com', role: 'ADMIN' as const }

function req(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/admin/leads', {
    method,
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('Admin Leads API — tenant isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('GET rejects unauthenticated requests', async () => {
    mockedFreshSessionUser.mockResolvedValue(null)
    const response = await GET()
    expect(response.status).toBe(403)
  })

  it('GET scopes the query to the requesting admin', async () => {
    mockedFreshSessionUser.mockResolvedValue(adminA as any)
    mockedLead.findMany.mockResolvedValue([])
    await GET()
    expect(mockedLead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: adminA.id } }),
    )
  })

  it('POST creates the lead under the authenticated admin, not a client-supplied owner', async () => {
    mockedFreshSessionUser.mockResolvedValue(adminA as any)
    mockedLead.create.mockResolvedValue({ id: 'lead-1' } as any)
    await POST(req('POST', { vertical: 'auto', businessName: 'Acme Motors', source: 'outbound_dm' }))
    expect(mockedLead.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: adminA.id }) }),
    )
  })

  it('PATCH blocks an admin from mutating another admin\'s lead (403, no update call)', async () => {
    mockedFreshSessionUser.mockResolvedValue(adminA as any)
    mockedLead.findUnique.mockResolvedValue({ userId: adminB.id } as any)

    const response = await PATCH(req('PATCH', { id: 'lead-owned-by-b', status: 'PAID' }))

    expect(response.status).toBe(403)
    expect(mockedLead.update).not.toHaveBeenCalled()
  })

  it('PATCH allows an admin to update their own lead', async () => {
    mockedFreshSessionUser.mockResolvedValue(adminA as any)
    mockedLead.findUnique.mockResolvedValue({ userId: adminA.id } as any)
    mockedLead.update.mockResolvedValue({ id: 'lead-owned-by-a', status: 'PAID' } as any)

    const response = await PATCH(req('PATCH', { id: 'lead-owned-by-a', status: 'PAID' }))

    expect(response.status).toBe(200)
    expect(mockedLead.update).toHaveBeenCalled()
  })

  it('DELETE blocks an admin from deleting another admin\'s lead (403, no delete call)', async () => {
    mockedFreshSessionUser.mockResolvedValue(adminA as any)
    mockedLead.findUnique.mockResolvedValue({ userId: adminB.id } as any)

    const response = await DELETE(req('DELETE', { id: 'lead-owned-by-b' }))

    expect(response.status).toBe(403)
    expect(mockedLead.delete).not.toHaveBeenCalled()
  })

  it('DELETE allows an admin to delete their own lead', async () => {
    mockedFreshSessionUser.mockResolvedValue(adminA as any)
    mockedLead.findUnique.mockResolvedValue({ userId: adminA.id } as any)
    mockedLead.delete.mockResolvedValue({} as any)

    const response = await DELETE(req('DELETE', { id: 'lead-owned-by-a' }))

    expect(response.status).toBe(200)
    expect(mockedLead.delete).toHaveBeenCalled()
  })

  it('PATCH returns 404 for a nonexistent lead without leaking existence of other rows', async () => {
    mockedFreshSessionUser.mockResolvedValue(adminA as any)
    mockedLead.findUnique.mockResolvedValue(null)

    const response = await PATCH(req('PATCH', { id: 'does-not-exist', status: 'PAID' }))

    expect(response.status).toBe(404)
  })
})
