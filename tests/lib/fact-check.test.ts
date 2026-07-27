import { describe, it, expect } from '@jest/globals'
import { extractNumbers, checkNarrationFacts } from '@/lib/fact-check'

describe('extractNumbers', () => {
  it('extracts plain integers', () => {
    expect(extractNumbers('3 bedrooms and 2 baths')).toEqual(['3', '2'])
  })

  it('normalizes thousands separators', () => {
    expect(extractNumbers('Priced at $28,900')).toEqual(['28900'])
  })

  it('normalizes a trailing .00', () => {
    expect(extractNumbers('$685,000.00')).toEqual(['685000'])
  })

  it('keeps a real decimal that is not just trailing zeros', () => {
    expect(extractNumbers('24,000.5 miles')).toEqual(['24000.5'])
  })

  it('returns an empty array for text with no numbers', () => {
    expect(extractNumbers('A beautiful family home')).toEqual([])
  })
})

describe('checkNarrationFacts', () => {
  const sourcePrompt =
    'A real estate listing video for 123 Main St. The property has 3 bedrooms and 2 bathrooms. ' +
    'It is listed at $685,000. There are 5 photographs, shown in order.'

  it('does not flag narration that only restates sourced facts', () => {
    const narration = [
      'Welcome to 123 Main St.',
      'This home has 3 bedrooms and 2 bathrooms.',
      'Listed at $685,000 — schedule your private viewing today.',
    ]
    const result = checkNarrationFacts(narration, sourcePrompt)
    expect(result.flagged).toBe(false)
    expect(result.unsourcedNumbers).toEqual([])
  })

  it('flags a number the narration invented that was never in the prompt', () => {
    const narration = ['This home has 3 bedrooms and a brand new 4-car garage.']
    const result = checkNarrationFacts(narration, sourcePrompt)
    expect(result.flagged).toBe(true)
    expect(result.unsourcedNumbers).toContain('4')
  })

  it('flags an invented price even when other facts are sourced correctly', () => {
    const narration = ['3 bedrooms, 2 bathrooms, now reduced to just $650,000!']
    const result = checkNarrationFacts(narration, sourcePrompt)
    expect(result.flagged).toBe(true)
    expect(result.unsourcedNumbers).toContain('650000')
  })

  it('is not fooled by comma/decimal formatting differences for the same number', () => {
    const narration = ['Listed at $685,000.00 exactly.']
    const result = checkNarrationFacts(narration, sourcePrompt)
    expect(result.flagged).toBe(false)
  })
})
