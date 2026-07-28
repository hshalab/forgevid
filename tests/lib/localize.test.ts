jest.mock('@/lib/ai/llm', () => ({
  llm: { chat: { completions: { create: jest.fn() } } },
  llmModel: jest.fn(() => 'test-model'),
  hasLlmKey: jest.fn(() => true),
}))
jest.mock('@/lib/localization-memory', () => ({
  approvedTranslation: jest.fn().mockResolvedValue(null),
  getLocalizationProfile: jest.fn().mockResolvedValue({
    tone: 'professional', formality: 'neutral', glossary: {}, pronunciations: [],
  }),
}))

import { llm, hasLlmKey } from '@/lib/ai/llm'
import { approvedTranslation, getLocalizationProfile } from '@/lib/localization-memory'
import { translateNarrationLines, localizedPresetScenes, lineSimilarity, backTranslationReport } from '@/lib/localize'
import type { ResolvedScene } from '@/lib/video-generator'

const mockCreate = llm.chat.completions.create as jest.Mock
const mockHasLlmKey = hasLlmKey as jest.Mock
const mockApproved = approvedTranslation as jest.Mock
const mockProfile = getLocalizationProfile as jest.Mock

function completion(content: string) {
  return { choices: [{ message: { content } }] }
}

function scene(overrides: Partial<ResolvedScene> = {}): ResolvedScene {
  return {
    id: 'scene-1',
    index: 0,
    description: 'A car in a driveway',
    narration: 'This RAV4 is priced at $28,900.',
    keywords: [],
    duration: 5,
    visualElements: [],
    clipUrl: 'https://example.com/1.mp4',
    matchedQuery: 'car driveway',
    ...overrides,
  }
}

describe('translateNarrationLines', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockHasLlmKey.mockReturnValue(true)
  })

  it('returns an empty array for no input, without calling the LLM', async () => {
    const result = await translateNarrationLines([], 'es')
    expect(result).toEqual([])
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns the original lines unchanged when no LLM key is configured', async () => {
    mockHasLlmKey.mockReturnValue(false)
    const result = await translateNarrationLines(['Hello world'], 'es')
    expect(result).toEqual(['Hello world'])
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('translates lines one-to-one, in order', async () => {
    mockCreate.mockResolvedValue(completion('1. Hola mundo\n2. Reserva tu prueba de manejo'))
    const result = await translateNarrationLines(['Hello world', 'Book your test drive'], 'es')
    expect(result).toEqual(['Hola mundo', 'Reserva tu prueba de manejo'])
  })

  it('falls back to the original lines when the reply has the wrong line count', async () => {
    mockCreate.mockResolvedValue(completion('1. Hola mundo'))
    const result = await translateNarrationLines(['Hello world', 'Book your test drive'], 'es')
    expect(result).toEqual(['Hello world', 'Book your test drive'])
  })

  it('falls back to the original line when a translation drops a number that was there', async () => {
    mockCreate.mockResolvedValue(completion('1. Este RAV4 tiene un precio excelente.'))
    const result = await translateNarrationLines(['This RAV4 is priced at $28,900.'], 'es')
    expect(result).toEqual(['This RAV4 is priced at $28,900.'])
  })

  it('keeps a translation that preserves every number exactly', async () => {
    mockCreate.mockResolvedValue(completion('1. Este RAV4 tiene un precio de $28,900.'))
    const result = await translateNarrationLines(['This RAV4 is priced at $28,900.'], 'es')
    expect(result).toEqual(['Este RAV4 tiene un precio de $28,900.'])
  })

  it('falls back to the original lines when the LLM call throws', async () => {
    mockCreate.mockRejectedValue(new Error('rate limited'))
    const result = await translateNarrationLines(['Hello world'], 'es')
    expect(result).toEqual(['Hello world'])
  })

  it('reuses human-approved translations verbatim and skips the LLM entirely on a full hit', async () => {
    mockApproved.mockResolvedValueOnce('Hola mundo aprobado')
    const result = await translateNarrationLines(['Hello world'], 'es', { userId: 'user-1' })
    expect(result).toEqual(['Hola mundo aprobado'])
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('translates only the memory misses, splicing approved lines back in position', async () => {
    mockApproved
      .mockResolvedValueOnce('Primera aprobada')
      .mockResolvedValueOnce(null)
    mockCreate.mockResolvedValue(completion('1. Segunda traducida'))
    const result = await translateNarrationLines(['First line', 'Second line'], 'es', { userId: 'user-1' })
    expect(result).toEqual(['Primera aprobada', 'Segunda traducida'])
    // Only the miss went to the model.
    expect(mockCreate.mock.calls[0][0].messages[1].content).toBe('1. Second line')
  })

  it("steers the LLM with the profile's tone, formality, and glossary", async () => {
    mockProfile.mockResolvedValueOnce({
      tone: 'luxury', formality: 'formal',
      glossary: { 'Machado Auto Sales': 'Machado Auto Sales' }, pronunciations: [],
    })
    mockCreate.mockResolvedValue(completion('1. Hola'))
    await translateNarrationLines(['Hello'], 'es', { userId: 'user-1' })
    const system = mockCreate.mock.calls[0][0].messages[0].content
    expect(system).toContain('luxury tone')
    expect(system).toContain('formal formality')
    expect(system).toContain('"Machado Auto Sales" → "Machado Auto Sales"')
  })

  it('translates statelessly when no userId is given — memory and profile untouched', async () => {
    mockCreate.mockResolvedValue(completion('1. Hola mundo'))
    await translateNarrationLines(['Hello world'], 'es')
    expect(mockApproved).not.toHaveBeenCalled()
    expect(mockProfile).not.toHaveBeenCalled()
  })
})

describe('lineSimilarity', () => {
  it('is 1 for identical content words and low for disjoint text', () => {
    expect(lineSimilarity('The red car drives fast', 'the red car drives fast')).toBe(1)
    expect(lineSimilarity('The red car drives fast', 'purple elephants swim slowly')).toBe(0)
  })

  it('ignores punctuation and short stopwords', () => {
    expect(lineSimilarity('Priced at $28,900, call today!', 'priced at $28,900 — call today')).toBeGreaterThan(0.5)
  })
})

describe('backTranslationReport', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockHasLlmKey.mockReturnValue(true)
  })

  it('flags a line whose round trip drifted from the original meaning', async () => {
    mockCreate.mockResolvedValue(completion('1. The blue truck parks slowly\n2. Visit our showroom today'))
    const report = await backTranslationReport(
      ['This red sportscar accelerates instantly', 'Visit our showroom today'],
      ['linea uno', 'linea dos'],
      'es',
    )
    expect(report).not.toBeNull()
    expect(report!.lines[0].flagged).toBe(true)
    expect(report!.lines[1].flagged).toBe(false)
    expect(report!.flaggedCount).toBe(1)
  })

  it('returns null (never guesses) when the line counts disagree', async () => {
    mockCreate.mockResolvedValue(completion('1. only one line back'))
    expect(await backTranslationReport(['a', 'b'], ['x', 'y'], 'es')).toBeNull()
  })

  it('returns null on an LLM failure — the review proceeds without the report', async () => {
    mockCreate.mockRejectedValue(new Error('LLM down'))
    expect(await backTranslationReport(['a'], ['x'], 'es')).toBeNull()
  })
})

describe('localizedPresetScenes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockHasLlmKey.mockReturnValue(true)
  })

  it('carries over keywords/searchQuery/duration/visualElements unchanged, replacing only narration', async () => {
    mockCreate.mockResolvedValue(completion('1. Este RAV4 tiene un precio de $28,900.'))
    const scenes = [
      scene({
        keywords: ['suv', 'driveway'],
        searchQuery: 'suv in driveway',
        visualElements: ['car', 'house'],
        duration: 6,
      }),
    ]
    const [planned] = await localizedPresetScenes(scenes, 'es')
    expect(planned.narration).toBe('Este RAV4 tiene un precio de $28,900.')
    expect(planned.keywords).toEqual(['suv', 'driveway'])
    expect(planned.searchQuery).toBe('suv in driveway')
    expect(planned.duration).toBe(6)
    expect(planned.visualElements).toEqual(['car', 'house'])
    expect(planned.description).toBe(scenes[0].description)
  })

  it('translates the description as narration when a scene has no explicit narration', async () => {
    mockCreate.mockResolvedValue(completion('1. Un coche en una entrada.'))
    const scenes = [scene({ narration: undefined, description: 'A car in a driveway' })]
    const [planned] = await localizedPresetScenes(scenes, 'es')
    expect(planned.narration).toBe('Un coche en una entrada.')
  })
})
