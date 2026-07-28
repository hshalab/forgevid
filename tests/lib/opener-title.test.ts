import { describe, it, expect } from '@jest/globals'
import { buildOpenerTitleFilter } from '@/lib/lower-third'

describe('buildOpenerTitleFilter', () => {
  it('uppercases the title and renders it as an animated centered drawtext', () => {
    const filter = buildOpenerTitleFilter('Franco Automotors')
    expect(filter).toContain("text='FRANCO AUTOMOTORS'")
    expect(filter).toContain('x=(w-text_w)/2')
    expect(filter).toContain('alpha=')
    expect(filter).toContain("enable='lt(t,2.5)'")
  })

  it('prefers the bundled Bebas Neue when present', () => {
    const filter = buildOpenerTitleFilter('Test')
    // public/fonts/BebasNeue-Regular.ttf ships with the repo.
    expect(filter.toLowerCase()).toContain('bebasneue-regular.ttf')
  })

  it("escapes filtergraph metacharacters — O'Brien's: Deals, 100% legit must not rewrite the graph", () => {
    const filter = buildOpenerTitleFilter("O'Brien's: Deals, 100% legit")
    // Colons inside the TEXT are escaped, percent doubled, apostrophes
    // stripped — the same escapeDrawText contract the lower third relies on.
    expect(filter).toContain('OBRIENS\\:')
    expect(filter).toContain('100%%')
    expect(filter).not.toContain("O'B")
  })

  it('returns an empty string for empty/whitespace titles — dropped overlay, never a dead render', () => {
    expect(buildOpenerTitleFilter('')).toBe('')
    expect(buildOpenerTitleFilter('   ')).toBe('')
  })
})

import { buildLowerThirdFilter } from '@/lib/lower-third'

describe('buildLowerThirdFilter — top anchor (avoids karaoke collision)', () => {
  it('anchors from the top (positive y, not h-…) when anchorTop is set', () => {
    const filter = buildLowerThirdFilter(
      { title: '2022 Tesla Model 3', facts: ['$20,000', '6,000 miles'] },
      { anchorTop: true, marginTop: 90 },
    )
    // Title y is a plain top offset, never the bottom-anchored h-… form.
    expect(filter).toContain('y=90:')
    expect(filter).not.toContain('y=h-')
    expect(filter).toContain('2022 Tesla Model 3')
    expect(filter).toContain('$20\,000') // comma escaped for the filtergraph
  })

  it('stays bottom-anchored (h-…) by default', () => {
    const filter = buildLowerThirdFilter({ title: 'X', facts: ['$1'] })
    expect(filter).toContain('y=h-')
  })
})
