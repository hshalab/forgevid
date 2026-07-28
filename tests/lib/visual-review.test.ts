jest.mock('@/lib/ai/llm', () => ({
  llm: { chat: { completions: { create: jest.fn() } } },
  llmModel: jest.fn(() => 'test-model'),
  hasLlmKey: jest.fn(() => true),
}))

import { hasLlmKey } from '@/lib/ai/llm'
import { parseVisualReview, reviewSceneFrames } from '@/lib/visual-review'

const mockHasKey = hasLlmKey as jest.Mock

describe('parseVisualReview', () => {
  it('parses a well-formed reply and clamps scores into [0, 100]', () => {
    const review = parseVisualReview(
      JSON.stringify({
        artifactScore: 250, compositionScore: -10, textLegibilityScore: 88,
        identityConsistencyScore: 'not-a-number', issues: ['glitchy frame 2'], critical: false,
      }),
      3,
    )
    expect(review).toEqual({
      artifactScore: 100, compositionScore: 0, textLegibilityScore: 88,
      identityConsistencyScore: 50, issues: ['glitchy frame 2'], critical: false, framesReviewed: 3,
    })
  })

  it('extracts JSON embedded in prose and treats critical strictly as boolean true', () => {
    const review = parseVisualReview(
      'Here is my review:\n{"artifactScore": 90, "compositionScore": 80, "textLegibilityScore": 100, "identityConsistencyScore": 95, "issues": [], "critical": "yes"}',
      2,
    )
    expect(review?.critical).toBe(false)
    expect(review?.artifactScore).toBe(90)
  })

  it('filters non-string issues and caps them at 10', () => {
    const review = parseVisualReview(
      JSON.stringify({
        artifactScore: 50, compositionScore: 50, textLegibilityScore: 50, identityConsistencyScore: 50,
        issues: [42, null, ...Array.from({ length: 15 }, (_, i) => `issue ${i}`)], critical: true,
      }),
      1,
    )
    expect(review?.issues).toHaveLength(10)
    expect(review?.issues[0]).toBe('issue 0')
    expect(review?.critical).toBe(true)
  })

  it('returns null for garbage', () => {
    expect(parseVisualReview('no json here at all', 1)).toBeNull()
    expect(parseVisualReview('{broken json', 1)).toBeNull()
  })
})

describe('reviewSceneFrames gating', () => {
  const ORIGINAL = process.env.VISUAL_REVIEW

  afterEach(() => {
    process.env.VISUAL_REVIEW = ORIGINAL
    if (ORIGINAL === undefined) delete process.env.VISUAL_REVIEW
    mockHasKey.mockReturnValue(true)
  })

  it('returns null when the kill switch is on', async () => {
    process.env.VISUAL_REVIEW = 'off'
    expect(await reviewSceneFrames([{ thumbnailUrl: '/x.jpg' } as any], { prompt: 'p' })).toBeNull()
  })

  it('returns null without an LLM key', async () => {
    mockHasKey.mockReturnValue(false)
    expect(await reviewSceneFrames([{ thumbnailUrl: '/x.jpg' } as any], { prompt: 'p' })).toBeNull()
  })

  it('returns null when no scene has a thumbnail — nothing to look at', async () => {
    expect(await reviewSceneFrames([{ thumbnailUrl: undefined } as any], { prompt: 'p' })).toBeNull()
  })
})
