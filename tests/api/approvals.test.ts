jest.mock('next/server', () => {
  class MockNextRequest {
    private body: string | null
    constructor(_url: string, init: RequestInit = {}) {
      this.body = typeof init.body === 'string' ? init.body : null
    }
    async json() {
      return this.body ? JSON.parse(this.body) : null
    }
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
    async json() {
      return this.body
    }
  }
  return { NextRequest: MockNextRequest, NextResponse: MockNextResponse }
})

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))
jest.mock('@/lib/evidence-ledger', () => ({ appendEvidence: jest.fn() }))
jest.mock('@/lib/approval-events', () => ({ recordApprovalEvent: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    adCreative: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    video: {
      findFirst: jest.fn(),
    },
  },
}))

import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { PATCH } from '@/app/api/approvals/[id]/route'

const mockedSession = getServerSession as jest.MockedFunction<typeof getServerSession>
const creative = prisma.adCreative as jest.Mocked<typeof prisma.adCreative>
const video = prisma.video as jest.Mocked<typeof prisma.video>

const baseCreative = {
  id: 'creative-1',
  userId: 'user-1',
  videoId: 'video-1',
  revision: 3,
  rightsStatus: 'UNCONFIRMED',
}

function request(body: unknown) {
  return new NextRequest('http://localhost/api/approvals/creative-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

function params(id = 'creative-1') {
  return { params: Promise.resolve({ id }) }
}

describe('Campaign approval workflow', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedSession.mockResolvedValue({ user: { id: 'user-1' } } as any)
    creative.findUnique.mockResolvedValue(baseCreative as any)
    creative.update.mockImplementation(async ({ data }: any) => ({ ...baseCreative, ...data }) as any)
  })

  it('requires authentication', async () => {
    mockedSession.mockResolvedValue(null)
    const response = await PATCH(request({ action: 'approve' }), params())
    expect(response.status).toBe(401)
  })

  it('does not let one user review another user’s creative', async () => {
    creative.findUnique.mockResolvedValue({ ...baseCreative, userId: 'user-2' } as any)
    const response = await PATCH(request({ action: 'approve', rightsConfirmed: true }), params())
    expect(response.status).toBe(403)
    expect(creative.update).not.toHaveBeenCalled()
  })

  it('requires explicit content-rights confirmation before approval', async () => {
    const response = await PATCH(request({ action: 'approve' }), params())
    expect(response.status).toBe(400)
    expect(video.findFirst).not.toHaveBeenCalled()
  })

  it('requires a completed owned video before approval', async () => {
    video.findFirst.mockResolvedValue({ status: 'PROCESSING' } as any)
    const response = await PATCH(request({ action: 'approve', rightsConfirmed: true }), params())
    expect(response.status).toBe(409)
    expect(creative.update).not.toHaveBeenCalled()
  })

  it('approves exactly the reviewed revision and records the approver', async () => {
    video.findFirst.mockResolvedValue({ status: 'COMPLETED' } as any)
    const response = await PATCH(
      request({ action: 'approve', rightsConfirmed: true, note: 'Ready for use' }),
      params(),
    )
    expect(response.status).toBe(200)
    expect(creative.update).toHaveBeenCalledWith({
      where: { id: 'creative-1' },
      data: expect.objectContaining({
        approvalStatus: 'APPROVED',
        rightsStatus: 'CONFIRMED',
        approvedRevision: 3,
        approvedByUserId: 'user-1',
        reviewNote: 'Ready for use',
      }),
    })
    expect(await response.json()).toEqual(expect.objectContaining({ publicUrl: '/l/creative-1' }))
  })

  it('requires a note when changes are requested', async () => {
    const response = await PATCH(request({ action: 'request_revision' }), params())
    expect(response.status).toBe(400)
    expect(creative.update).not.toHaveBeenCalled()
  })

  it('invalidates approval and rights when a new revision is resubmitted', async () => {
    const response = await PATCH(request({ action: 'resubmit' }), params())
    expect(response.status).toBe(200)
    expect(creative.update).toHaveBeenCalledWith({
      where: { id: 'creative-1' },
      data: expect.objectContaining({
        approvalStatus: 'AWAITING_REVIEW',
        revision: { increment: 1 },
        approvedRevision: null,
        approvedAt: null,
        approvedByUserId: null,
        rightsStatus: 'UNCONFIRMED',
      }),
    })
  })
})
