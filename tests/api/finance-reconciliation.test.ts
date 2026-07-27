jest.mock('next/server', () => {
  class MockNextRequest {
    url: string
    method: string
    headers: Map<string, string>

    constructor(url: string, init: RequestInit = {}) {
      this.url = url
      this.method = init.method ?? 'GET'
      this.headers = new Map(Object.entries((init.headers as Record<string, string>) ?? {}))
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
    evidenceRecord: { findFirst: jest.fn() },
  },
}))

jest.mock('@/lib/evidence-ledger', () => ({ appendEvidence: jest.fn() }))

// The route deliberately snapshots getHackathonEvidence's own summary (in
// DOLLARS — Payment.amount is stored in dollars, the Stripe webhook divides
// by 100 at write time) instead of re-aggregating, so the daily chain entry
// can never disagree with the admin evidence page or the signed exports.
jest.mock('@/lib/hackathon-evidence', () => ({ getHackathonEvidence: jest.fn() }))

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/cron/finance-reconciliation/route'
import { prisma } from '@/lib/prisma'
import { appendEvidence } from '@/lib/evidence-ledger'
import { getHackathonEvidence } from '@/lib/hackathon-evidence'

const mockedEvidenceRecord = prisma.evidenceRecord as jest.Mocked<typeof prisma.evidenceRecord>
const mockedAppend = appendEvidence as jest.Mock
const mockedEvidence = getHackathonEvidence as jest.Mock

function req(secret?: string) {
  return new NextRequest('http://localhost/api/cron/finance-reconciliation', {
    method: 'POST',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

describe('POST /api/cron/finance-reconciliation', () => {
  const ORIGINAL_SECRET = process.env.CRON_SECRET

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    mockedEvidenceRecord.findFirst.mockResolvedValue(null)
    mockedEvidence.mockResolvedValue({
      start: new Date('2026-05-19T17:00:00.000Z'),
      summary: {
        users: 12,
        activatedUsers: 7,
        videos: 40,
        completedVideos: 33,
        revenueUsd: 99,
        relatedPartyRevenueUsd: 19,
        outboundRevenueUsd: 250,
        outboundRelatedPartyRevenueUsd: 0,
        aiCostUsd: 3.5,
        operatingCostUsd: 20,
        marketingSpendUsd: 5,
      },
    })
    mockedAppend.mockResolvedValue({ id: 'evidence-1' })
  })

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_SECRET
  })

  it('rejects a missing or wrong bearer secret', async () => {
    expect((await POST(req() as any)).status).toBe(401)
    expect((await POST(req('wrong') as any)).status).toBe(401)
    expect(mockedAppend).not.toHaveBeenCalled()
    expect(mockedEvidence).not.toHaveBeenCalled()
  })

  it('rejects when CRON_SECRET is unset, even with a matching empty header', async () => {
    delete process.env.CRON_SECRET
    expect((await POST(req('') as any)).status).toBe(401)
  })

  it('skips (no append, no recompute) when today was already reconciled', async () => {
    mockedEvidenceRecord.findFirst.mockResolvedValue({ id: 'existing' } as any)
    const response = await POST(req('test-cron-secret') as any)
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.skipped).toBeTruthy()
    expect(mockedAppend).not.toHaveBeenCalled()
    expect(mockedEvidence).not.toHaveBeenCalled()
  })

  it('appends one dated record carrying the shared summary, in dollars', async () => {
    const response = await POST(req('test-cron-secret') as any)
    const body = await response.json()
    expect(response.status).toBe(200)

    expect(body.revenueUsd).toBe(99)
    expect(body.relatedPartyRevenueUsd).toBe(19)
    expect(body.outboundRevenueUsd).toBe(250)
    expect(body.aiCostUsd).toBe(3.5)
    expect(body.operatingCostUsd).toBe(20)
    // 99 + 250 - 3.5 - 20
    expect(body.netUsd).toBe(325.5)
    expect(body.since).toBe('2026-05-19T17:00:00.000Z')

    expect(mockedAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'finance.daily_reconciliation',
        entityType: 'FinanceDay',
        entityId: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        payload: expect.objectContaining({ netUsd: 325.5, revenueUsd: 99 }),
      }),
    )
  })

  it('checks idempotency against the same UTC day key it writes', async () => {
    await POST(req('test-cron-secret') as any)
    const checkedDay = mockedEvidenceRecord.findFirst.mock.calls[0][0]?.where?.entityId
    const writtenDay = mockedAppend.mock.calls[0][0]?.entityId
    expect(checkedDay).toBe(writtenDay)
  })
})
