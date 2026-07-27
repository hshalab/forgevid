import { describe, it, expect } from '@jest/globals'
import { applyPronunciation } from '@/lib/pronunciation'

describe('applyPronunciation', () => {
  it('leaves ordinary text untouched', () => {
    expect(applyPronunciation('Book your test drive today')).toBe('Book your test drive today')
  })

  it('respells the platform brand names', () => {
    expect(applyPronunciation('Try ForgeVid today')).toBe('Try Forge Vid today')
    expect(applyPronunciation('Visit RingYield.com')).toBe('Visit Ring Yield.com')
    expect(applyPronunciation('NeuroHires helps recruiters')).toBe('Neuro Hires helps recruiters')
  })

  it('is case-insensitive but matches whole words only', () => {
    expect(applyPronunciation('forgevid is great')).toBe('Forge Vid is great')
    expect(applyPronunciation('ForgeVidExtra should not match')).toBe('ForgeVidExtra should not match')
  })

  it('respells known car makes', () => {
    expect(applyPronunciation('A used Hyundai Elantra')).toBe('A used Hyun-day Elantra')
    expect(applyPronunciation('A 2020 Porsche 911')).toBe('A 2020 Por-shuh 911')
  })

  it('handles multiple entries in one string, longest match first', () => {
    expect(applyPronunciation('ForgeVid, RingYield and NeuroHires')).toBe('Forge Vid, Ring Yield and Neuro Hires')
  })

  it('applies extra caller-supplied entries alongside the defaults', () => {
    const result = applyPronunciation('Visit our showroom on Cahuenga', [
      { spelled: 'Cahuenga', saysAs: 'Kuh-WEN-guh' },
    ])
    expect(result).toBe('Visit our showroom on Kuh-WEN-guh')
  })

  it('returns empty/falsy input unchanged', () => {
    expect(applyPronunciation('')).toBe('')
  })
})
