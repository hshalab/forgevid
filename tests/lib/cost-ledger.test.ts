import { describe, it, expect } from '@jest/globals'
import { estimateGenerationCost, RATES } from '@/lib/cost-ledger'

describe('estimateGenerationCost — frontier per-model rates', () => {
  it('prices each frontier model at its MEASURED per-second rate, not a flat one', () => {
    // Measured 2026-07-28 from real credit spend (see RATES doc comment).
    expect(estimateGenerationCost({ runwaySeconds: 5, runwayModel: 'gen4.5' }).totalUsd).toBeCloseTo(0.6, 6)
    expect(estimateGenerationCost({ runwaySeconds: 8, runwayModel: 'veo3.1' }).totalUsd).toBeCloseTo(2.0, 6)
    expect(estimateGenerationCost({ runwaySeconds: 5, runwayModel: 'seedance2' }).totalUsd).toBeCloseTo(1.8, 6)
    expect(estimateGenerationCost({ runwaySeconds: 10, runwayModel: 'kling3.0_pro' }).totalUsd).toBeCloseTo(4.1, 6)
  })

  it('falls back to the generic runway rate for a model with no measured rate', () => {
    const breakdown = estimateGenerationCost({ runwaySeconds: 10, runwayModel: 'some-future-model' })
    expect(breakdown.totalUsd).toBeCloseTo(10 * RATES.runwayPerSecond, 6)
  })

  it('uses the generic rate when no model is named (legacy callers)', () => {
    const breakdown = estimateGenerationCost({ runwaySeconds: 10 })
    expect(breakdown.totalUsd).toBeCloseTo(1.2, 6)
    expect(breakdown.runwayModel).toBeNull()
  })

  it('carries the model through the breakdown for the ledger row', () => {
    expect(estimateGenerationCost({ runwaySeconds: 5, runwayModel: 'seedance2' }).runwayModel).toBe('seedance2')
  })

  it('every measured rate is at or above the flat fallback — the fallback must stay the FLOOR', () => {
    for (const [model, rate] of Object.entries(RATES.runwayPerSecondByModel)) {
      expect(rate).toBeGreaterThanOrEqual(RATES.runwayPerSecond)
      expect(typeof model).toBe('string')
    }
  })
})
