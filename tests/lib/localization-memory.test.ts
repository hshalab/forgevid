jest.mock('@/lib/prisma', () => ({
  prisma: {
    localizationProfile: { upsert: jest.fn() },
    translationMemory: { findUnique: jest.fn(), upsert: jest.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import {
  approvedTranslation,
  profilePronunciations,
  rememberTranslation,
  translationHash,
} from '@/lib/localization-memory'

const mockedMemory = prisma.translationMemory as jest.Mocked<typeof prisma.translationMemory>

describe('localization-memory', () => {
  beforeEach(() => jest.clearAllMocks())

  it('hashes source text stably, ignoring surrounding whitespace', () => {
    expect(translationHash('Hello world')).toBe(translationHash('  Hello world  '))
    expect(translationHash('Hello world')).not.toBe(translationHash('Hello worlds'))
    expect(translationHash('x')).toMatch(/^[a-f0-9]{64}$/)
  })

  it('looks up an approved translation by the composite key', async () => {
    mockedMemory.findUnique.mockResolvedValue({ approvedText: 'Hola mundo' } as any)
    const result = await approvedTranslation('user-1', 'en', 'es', 'Hello world')
    expect(result).toBe('Hola mundo')
    expect(mockedMemory.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId_sourceLanguage_targetLanguage_sourceTextHash: {
          userId: 'user-1', sourceLanguage: 'en', targetLanguage: 'es',
          sourceTextHash: translationHash('Hello world'),
        },
      },
    }))
  })

  it('returns null on a memory miss', async () => {
    mockedMemory.findUnique.mockResolvedValue(null)
    expect(await approvedTranslation('user-1', 'en', 'es', 'Never seen')).toBeNull()
  })

  it('remembers a trimmed approval keyed by the trimmed source hash', async () => {
    await rememberTranslation({
      userId: 'user-1', sourceLanguage: 'en', targetLanguage: 'es',
      sourceText: '  Hello world ', approvedText: ' Hola mundo ',
    })
    const call = mockedMemory.upsert.mock.calls[0][0] as any
    expect(call.create.sourceText).toBe('Hello world')
    expect(call.create.approvedText).toBe('Hola mundo')
    expect(call.create.sourceTextHash).toBe(translationHash('Hello world'))
    expect(call.update.approvedText).toBe('Hola mundo')
  })

  it('filters malformed pronunciation entries and caps the list at 200', () => {
    const valid = Array.from({ length: 250 }, (_, i) => ({ spelled: `w${i}`, saysAs: `s${i}` }))
    const noisy = [null, 'string', { spelled: 42, saysAs: 'x' }, { spelled: 'ok' }, ...valid]
    const result = profilePronunciations({ pronunciations: noisy })
    expect(result).toHaveLength(200)
    expect(result[0]).toEqual({ spelled: 'w0', saysAs: 's0' })
    expect(profilePronunciations({ pronunciations: 'not-an-array' })).toEqual([])
  })
})
