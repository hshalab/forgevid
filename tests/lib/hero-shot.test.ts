jest.mock('@/lib/runway-provider', () => ({
  isRunwayConfigured: jest.fn(),
  createTextToVideo: jest.fn(),
  getRunwayTaskStatus: jest.fn(),
}))

import { createTextToVideo, getRunwayTaskStatus, isRunwayConfigured } from '@/lib/runway-provider'
import { generateHeroClip, heroPrompt } from '@/lib/hero-shot'

const mockedConfigured = isRunwayConfigured as jest.Mock
const mockedCreate = createTextToVideo as jest.Mock
const mockedStatus = getRunwayTaskStatus as jest.Mock

describe('heroPrompt', () => {
  it('builds a commercial prompt from the scene search query with style flavor', () => {
    const prompt = heroPrompt('red toyota rav4 driving', 'cinematic')
    expect(prompt).toContain('red toyota rav4 driving')
    expect(prompt).toContain('cinematic film look')
    expect(prompt).toContain('no text, no logos')
  })

  it('falls back to a generic commercial flavor for unknown styles', () => {
    expect(heroPrompt('house exterior', 'weird-style')).toContain('cinematic commercial look')
  })
})

describe('generateHeroClip — fail-open contract', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedConfigured.mockReturnValue(true)
  })

  it('returns null without a configured Runway key — never throws', async () => {
    mockedConfigured.mockReturnValue(false)
    expect(await generateHeroClip({ searchQuery: 'suv', aspectRatio: '16:9' })).toBeNull()
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('returns null when task creation throws — the stock opening stands', async () => {
    mockedCreate.mockRejectedValue(new Error('402 payment required'))
    expect(await generateHeroClip({ searchQuery: 'suv', aspectRatio: '16:9' })).toBeNull()
  })

  it('returns null when the generation FAILS at the provider', async () => {
    mockedCreate.mockResolvedValue('task-1')
    mockedStatus.mockResolvedValue({ status: 'failed', videoUrl: null, error: 'content policy' })
    expect(await generateHeroClip({ searchQuery: 'suv', aspectRatio: '16:9' })).toBeNull()
  })

  it('requests exactly the 5s gen4.5 hero unit', async () => {
    mockedCreate.mockRejectedValue(new Error('stop early'))
    await generateHeroClip({ searchQuery: 'suv on highway', style: 'modern', aspectRatio: '9:16' })
    expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gen4.5',
      duration: 5,
      aspectRatio: '9:16',
    }))
  })
})
