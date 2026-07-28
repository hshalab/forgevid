jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    subscription: { findFirst: jest.fn() },
    clonedVoice: { findMany: jest.fn() },
    user: { update: jest.fn() },
    apiKey: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  },
}))
jest.mock('@/lib/cloned-voices', () => ({ revokeClonedVoice: jest.fn() }))
jest.mock('@/lib/evidence-ledger', () => ({ appendEvidence: jest.fn() }))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { revokeClonedVoice } from '@/lib/cloned-voices'
import { appendEvidence } from '@/lib/evidence-ledger'
import { DELETE } from '@/app/api/user/account/route'

const session = getServerSession as jest.MockedFunction<typeof getServerSession>
const mockedSub = prisma.subscription as jest.Mocked<typeof prisma.subscription>
const mockedVoice = prisma.clonedVoice as jest.Mocked<typeof prisma.clonedVoice>
const mockedUser = prisma.user as jest.Mocked<typeof prisma.user>
const mockedRevoke = revokeClonedVoice as jest.Mock
const mockedAppend = appendEvidence as jest.Mock

function req(body: unknown) {
  return { json: async () => body } as any
}

describe('DELETE /api/user/account', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    session.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockedSub.findFirst.mockResolvedValue(null)
    mockedVoice.findMany.mockResolvedValue([] as any)
    mockedUser.update.mockResolvedValue({} as any)
    mockedRevoke.mockResolvedValue(undefined)
    mockedAppend.mockResolvedValue({ id: 'e1' })
  })

  it('requires authentication', async () => {
    session.mockResolvedValue(null)
    expect((await DELETE(req({ confirm: 'DELETE MY ACCOUNT' }))).status).toBe(401)
    expect(mockedUser.update).not.toHaveBeenCalled()
  })

  it('requires the literal confirmation string', async () => {
    expect((await DELETE(req({ confirm: 'yes please' }))).status).toBe(400)
    expect((await DELETE(req({}))).status).toBe(400)
    expect(mockedUser.update).not.toHaveBeenCalled()
  })

  it('blocks deletion while a paid subscription is active and un-cancelled', async () => {
    mockedSub.findFirst.mockResolvedValue({ id: 's1', plan: 'pro' } as any)
    const response = await DELETE(req({ confirm: 'DELETE MY ACCOUNT' }))
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('pro')
    expect(mockedUser.update).not.toHaveBeenCalled()
  })

  it('soft-deletes: scrubs ALL PII, deactivates API keys, revokes voices, appends evidence', async () => {
    mockedVoice.findMany.mockResolvedValue([{ id: 'v1' }, { id: 'v2' }] as any)
    const response = await DELETE(req({ confirm: 'DELETE MY ACCOUNT' }))
    expect(response.status).toBe(200)
    expect(mockedRevoke).toHaveBeenCalledTimes(2)
    expect(mockedUser.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1' },
      data: expect.objectContaining({
        status: 'DELETED',
        email: expect.stringContaining('deleted.forgevid.invalid'),
        name: null,
        password: null,
        metadata: null,
        mfaSecret: null,
        resetTokenHash: null,
      }),
    }))
    expect((prisma as any).apiKey.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { isActive: false },
    })
    expect(mockedAppend).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'account.deleted', entityId: 'user-1',
    }))
  })

  it('blocks deletion for a PAST_DUE subscription too — it can flip back ACTIVE at Stripe', async () => {
    mockedSub.findFirst.mockResolvedValue({ id: 's1', plan: 'pro' } as any)
    const response = await DELETE(req({ confirm: 'DELETE MY ACCOUNT' }))
    expect(response.status).toBe(409)
    expect(mockedSub.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['ACTIVE', 'PAST_DUE', 'TRIALING', 'INCOMPLETE'] },
      }),
    }))
  })

  it('still deletes the account when a provider voice revocation fails', async () => {
    mockedVoice.findMany.mockResolvedValue([{ id: 'v1' }] as any)
    mockedRevoke.mockRejectedValue(new Error('provider down'))
    const response = await DELETE(req({ confirm: 'DELETE MY ACCOUNT' }))
    expect(response.status).toBe(200)
    expect(mockedUser.update).toHaveBeenCalled()
  })
})
