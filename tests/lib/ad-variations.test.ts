import { expandVariations, VariationError } from '@/lib/ad-variations'

describe('ad variation matrix', () => {
  it('defaults to one English landscape variant', () => {
    expect(expandVariations({})).toEqual([
      expect.objectContaining({
        label: 'EN · 16:9',
        aspectRatio: '16:9',
        language: 'en',
        axes: { aspect: '16:9', language: 'en' },
      }),
    ])
  })

  it('expands hooks across each selected language', () => {
    const variants = expandVariations({
      hooks: [
        { label: 'value', narration: 'See the practical value.' },
        { label: 'fresh', narration: 'Take a fresh look today.' },
      ],
      aspectRatios: ['9:16'],
      languages: ['en', 'es'],
    })

    expect(variants).toHaveLength(4)
    expect(variants.map((variant) => variant.language)).toEqual(['en', 'en', 'es', 'es'])
    expect(variants[2]).toEqual(expect.objectContaining({
      label: 'hook:value · ES · 9:16',
      axes: { hook: 'value', cta: undefined, aspect: '9:16', language: 'es' },
    }))
  })

  it('counts languages when enforcing the render limit', () => {
    expect(() => expandVariations({
      hooks: Array.from({ length: 4 }, (_, index) => ({
        label: `hook-${index}`,
        narration: `Narration ${index}`,
      })),
      ctas: Array.from({ length: 2 }, (_, index) => ({
        label: `cta-${index}`,
        narration: `Call to action ${index}`,
      })),
      aspectRatios: ['16:9', '9:16'],
      languages: ['en', 'es'],
    })).toThrow(VariationError)
  })
})
