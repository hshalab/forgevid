import { describe, it, expect } from '@jest/globals'
import { csv } from '@/lib/csv-format'

describe('csv() — formula/CSV injection guard', () => {
  it.each(['=SUM(A1:A9)', '+1+1', '-1+1', '@SUM(1,1)', '\tmalicious'])(
    'neutralizes a leading-%s value with a text-forcing quote',
    (value) => {
      expect(csv(value)).toBe(`"'${value}"`)
    },
  )

  it('leaves an ordinary business name untouched', () => {
    expect(csv('Machado Auto Sales')).toBe('"Machado Auto Sales"')
  })

  it('still escapes embedded double quotes', () => {
    expect(csv('Bob "The Deal" Motors')).toBe('"Bob ""The Deal"" Motors"')
  })

  it('formats a Date as ISO', () => {
    const d = new Date('2026-07-25T12:00:00.000Z')
    expect(csv(d)).toBe('"2026-07-25T12:00:00.000Z"')
  })

  it('renders null/undefined as an empty quoted string', () => {
    expect(csv(null)).toBe('""')
    expect(csv(undefined)).toBe('""')
  })

  it('does not treat a minus sign in the middle of a value as a formula', () => {
    expect(csv('E-commerce')).toBe('"E-commerce"')
  })
})
