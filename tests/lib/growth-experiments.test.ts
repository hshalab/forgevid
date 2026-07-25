import { classifyEvidence, evidenceLabel } from '@/lib/growth-experiments'

describe('honest campaign evidence thresholds', () => {
  it('does not call tiny samples directional or confirmed', () => {
    expect(classifyEvidence({ views: 99, leads: 10, downstreamConversions: 5, revenueCents: 9000 })).toBe('insufficient')
  })

  it('labels useful but incomplete samples directional', () => {
    expect(classifyEvidence({ views: 250, leads: 12, downstreamConversions: 2, revenueCents: 9000 })).toBe('directional')
  })

  it('requires substantial views, leads, and downstream outcomes for confirmed', () => {
    const evidence = { views: 600, leads: 25, downstreamConversions: 4, revenueCents: 19000 }
    expect(classifyEvidence(evidence)).toBe('confirmed')
    expect(evidenceLabel(evidence)).toContain('customer-recorded revenue')
  })
})
