jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))
jest.mock('@/lib/cloned-voices', () => ({ revokeClonedVoice: jest.fn() }))
jest.mock('@/lib/learning-consent', () => ({ recordLearningConsent: jest.fn().mockResolvedValue(undefined) }))

import { getServerSession } from 'next-auth'
import { revokeClonedVoice } from '@/lib/cloned-voices'
import { recordLearningConsent } from '@/lib/learning-consent'
import { DELETE } from '@/app/api/voices/[id]/route'

const session = getServerSession as jest.MockedFunction<typeof getServerSession>
const mockedRevoke = revokeClonedVoice as jest.Mock
const mockedConsent = recordLearningConsent as jest.Mock

function props(id = 'voice-1') {
  return { params: Promise.resolve({ id }) }
}

describe('DELETE /api/voices/[id] (voice revocation)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    session.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockedRevoke.mockResolvedValue(undefined)
    mockedConsent.mockResolvedValue(undefined)
  })

  it('requires authentication', async () => {
    session.mockResolvedValue(null)
    expect((await DELETE({} as any, props())).status).toBe(401)
    expect(mockedRevoke).not.toHaveBeenCalled()
  })

  it('revokes the voice for its owner and appends the revocation to the consent ledger', async () => {
    const response = await DELETE({} as any, props('voice-1'))
    expect(response.status).toBe(200)
    expect(mockedRevoke).toHaveBeenCalledWith('user-1', 'voice-1')
    expect(mockedConsent).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'voice_clone', granted: false, source: 'voice_revocation',
      evidence: { voiceId: 'voice-1' },
    }))
  })

  it('404s an unknown or already-revoked voice', async () => {
    mockedRevoke.mockRejectedValue(new Error('Voice not found'))
    const response = await DELETE({} as any, props('missing'))
    expect(response.status).toBe(404)
    expect(mockedConsent).not.toHaveBeenCalled()
  })

  it('502s when the provider deletion fails — the voice must actually be gone upstream', async () => {
    mockedRevoke.mockRejectedValue(new Error('Provider voice deletion failed (500)'))
    const response = await DELETE({} as any, props())
    expect(response.status).toBe(502)
    expect(mockedConsent).not.toHaveBeenCalled()
  })
})
