jest.mock('@/lib/video-generator', () => ({
  planScenes: jest.fn(),
  spokenLine: (scene: { narration?: string; description?: string }) => scene.narration || scene.description || '',
}))

import { planScenes } from '@/lib/video-generator'
import { planSceneCandidates, scorePlan } from '@/lib/plan-candidates'

const mockedPlan = planScenes as jest.Mock

function scene(narration: string, searchQuery: string, duration = 5) {
  return { id: 's', index: 0, description: narration, narration, searchQuery, keywords: [], duration, visualElements: [] } as any
}

describe('scorePlan', () => {
  it('rewards narration whose speech time fits the requested duration', () => {
    // ~25 words ≈ 10s at 2.5wps — perfect for a 10s request.
    const fit = scorePlan(
      [scene(Array(25).fill('word').join(' '), 'car driveway')],
      'a car ad', 10,
    )
    const tooLong = scorePlan(
      [scene(Array(100).fill('word').join(' '), 'car driveway')],
      'a car ad', 10,
    )
    expect(fit.durationFit).toBeGreaterThan(tooLong.durationFit)
  })

  it('penalizes camera-grammar words in search queries', () => {
    const good = scorePlan([scene('Hello there', 'red suv driveway')], 'p', 5)
    const bad = scorePlan([scene('Hello there', 'beautiful close-up shot')], 'p', 5)
    expect(good.queryQuality).toBeGreaterThan(bad.queryQuality)
  })

  it('rewards distinct queries over near-duplicates', () => {
    const varied = scorePlan(
      [scene('a', 'suv exterior'), scene('b', 'suv interior')],
      'p', 10,
    )
    const duped = scorePlan(
      [scene('a', 'suv exterior'), scene('b', 'suv exterior')],
      'p', 10,
    )
    expect(varied.queryVariety).toBeGreaterThan(duped.queryVariety)
  })

  it('scores fact coverage by prompt numbers carried into narration', () => {
    const covered = scorePlan([scene('Priced at $28,900 today', 'suv')], 'SUV for $28,900', 5)
    const dropped = scorePlan([scene('A great price today', 'suv')], 'SUV for $28,900', 5)
    expect(covered.factCoverage).toBe(100)
    expect(dropped.factCoverage).toBe(0)
  })

  it('gives full fact coverage when the prompt has no numbers at all', () => {
    expect(scorePlan([scene('Hello world', 'suv')], 'no numbers here', 5).factCoverage).toBe(100)
  })
})

describe('planSceneCandidates', () => {
  beforeEach(() => jest.clearAllMocks())

  it('plans N candidates and selects the highest-scoring one', async () => {
    const weak = [scene('word', 'beautiful close-up shot', 5)]
    const strong = [scene(Array(12).fill('word').join(' '), 'red suv driveway', 5)]
    mockedPlan.mockResolvedValueOnce(weak).mockResolvedValueOnce(strong)

    const result = await planSceneCandidates('script', 5, 'en', 2, 'a car ad')
    expect(mockedPlan).toHaveBeenCalledTimes(2)
    expect(result.winner).toBe(strong)
    expect(result.summary).toHaveLength(2)
    expect(result.summary.filter((c) => c.selected)).toHaveLength(1)
    expect(result.summary.find((c) => c.selected)!.index).toBe(result.selectedIndex)
  })

  it('fails soft: surviving candidates compete when one plan call throws', async () => {
    const only = [scene('hello world there', 'suv driveway', 5)]
    mockedPlan.mockRejectedValueOnce(new Error('LLM hiccup')).mockResolvedValueOnce(only)
    const result = await planSceneCandidates('script', 5, 'en', 2, 'p')
    expect(result.winner).toBe(only)
    expect(result.summary).toHaveLength(1)
  })

  it('surfaces the failure when EVERY candidate plan fails', async () => {
    mockedPlan.mockRejectedValue(new Error('planner down'))
    await expect(planSceneCandidates('script', 5, 'en', 3, 'p')).rejects.toThrow('planner down')
  })

  it('clamps the candidate count to [2, 3]', async () => {
    mockedPlan.mockResolvedValue([scene('a b c', 'suv', 5)])
    await planSceneCandidates('script', 5, 'en', 99, 'p')
    expect(mockedPlan).toHaveBeenCalledTimes(3)
  })
})
