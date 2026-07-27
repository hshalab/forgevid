import { describe, it, expect } from '@jest/globals'
import { checkFairHousing } from '@/lib/fair-housing'

describe('checkFairHousing', () => {
  it('returns no flags for ordinary listing copy', () => {
    const flags = checkFairHousing('Freshly renovated kitchen, hardwood floors throughout, large backyard.')
    expect(flags).toEqual([])
  })

  it('returns no flags for empty or missing text', () => {
    expect(checkFairHousing('')).toEqual([])
    expect(checkFairHousing(undefined)).toEqual([])
    expect(checkFairHousing(null)).toEqual([])
  })

  it('flags familial-status exclusion language', () => {
    const flags = checkFairHousing('Quiet adults-only building, no children please.')
    const categories = flags.map((f) => f.category)
    expect(categories).toContain('familial_status')
    expect(flags.length).toBeGreaterThanOrEqual(2)
  })

  it('flags a reference to a specific religious institution', () => {
    const flags = checkFairHousing('Walking distance to church and downtown shops.')
    expect(flags).toHaveLength(1)
    expect(flags[0].category).toBe('religion')
    expect(flags[0].phrase.toLowerCase()).toContain('church')
  })

  it('flags Section 8 refusal as a source-of-income issue', () => {
    const flags = checkFairHousing('Great unit, no Section 8.')
    expect(flags.some((f) => f.category === 'source_of_income')).toBe(true)
  })

  it('flags disability-exclusionary language', () => {
    const flags = checkFairHousing('Must be able-bodied, no wheelchairs on the property.')
    expect(flags.filter((f) => f.category === 'disability')).toHaveLength(2)
  })

  it('does not flag "master bedroom" or normal family-friendly marketing', () => {
    const flags = checkFairHousing('Spacious master bedroom with walk-in closet, family room downstairs.')
    expect(flags).toEqual([])
  })
})
