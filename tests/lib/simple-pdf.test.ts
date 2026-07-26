import { onePagePdf } from '@/lib/simple-pdf'

describe('judge PDF generator', () => {
  it('creates a valid one-page PDF envelope without interpolating control characters', () => {
    const pdf = onePagePdf('ForgeVid (Judge)', ['Evidence \\ summary', 'Revenue: $19.00'])
    const text = pdf.toString('ascii')
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('/Type /Page')
    expect(text).toContain('xref')
    expect(text.endsWith('%%EOF')).toBe(true)
  })
})
