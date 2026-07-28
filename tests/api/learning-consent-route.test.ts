jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))
jest.mock('@/lib/learning-consent', () => ({
  LEARNING_POLICY_VERSION: 'learning-policy-v1',
  allowsProductImprovement: jest.fn(),
  recordLearningConsent: jest.fn(),
}))

import { getServerSession } from 'next-auth'
import { allowsProductImprovement, recordLearningConsent } from '@/lib/learning-consent'
import { GET, PUT } from '@/app/api/user/learning-consent/route'

const session = getServerSession as jest.MockedFunction<typeof getServerSession>
const mockedAllows = allowsProductImprovement as jest.Mock
const mockedRecord = recordLearningConsent as jest.Mock

function putReq(body: unknown) {
  return { json: async () => body } as any
}

describe('learning consent settings (/api/user/learning-consent)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    session.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockedAllows.mockResolvedValue(true)
  })

  it('requires authentication', async () => {
    session.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
    expect((await PUT(putReq({ granted: false }))).status).toBe(401)
    expect(mockedRecord).not.toHaveBeenCalled()
  })

  it('GET reports the current choice and the policy version', async () => {
    mockedAllows.mockResolvedValue(false)
    const body = await (await GET()).json()
    expect(body).toEqual({ purpose: 'product_improvement', granted: false, policyVersion: 'learning-policy-v1' })
  })

  it('PUT records an opt-out from settings', async () => {
    const response = await PUT(putReq({ granted: false }))
    expect(response.status).toBe(200)
    expect(mockedRecord).toHaveBeenCalledWith({
      userId: 'user-1', purpose: 'product_improvement', granted: false, source: 'settings',
    })
  })

  it('PUT rejects a non-boolean body', async () => {
    expect((await PUT(putReq({ granted: 'yes' }))).status).toBe(400)
    expect(mockedRecord).not.toHaveBeenCalled()
  })
})
