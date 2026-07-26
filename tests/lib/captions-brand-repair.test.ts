import { describe, it, expect } from '@jest/globals'
import { normalizeSpokenUrls, type CaptionCue } from '@/lib/captions'

/**
 * Whisper mishears the cloned voice's brand names in new ways every so often
 * ("Ring Guild", "NeuroGires" — reported from live clips 2026-07-26). These
 * tests pin every known mishearing so extending the fix list can't silently
 * drop an old one.
 */

function cue(text: string, words?: string[]): CaptionCue {
  return {
    start: 0,
    end: 3,
    text,
    words: words?.map((word, i) => ({ word, start: i * 0.3, end: i * 0.3 + 0.25 })),
  }
}

describe('normalizeSpokenUrls — brand mishearing repair', () => {
  it.each([
    ['Ring Guild dot com', 'RingYield.com'],
    ['ring guild dot com', 'RingYield.com'],
    ['Ring gild dot com', 'RingYield.com'],
    ['Ring Shield dot com', 'RingYield.com'],
    ['ring yield dot com', 'RingYield.com'],
    ['Ringil punto com', 'RingYield.com'],
    ['Ringgill punto com', 'RingYield.com'],
    ['Ringyil dot com', 'RingYield.com'],
    ['ring iel punto com', 'RingYield.com'],
    ['NeuroGires punto com', 'NeuroHires.com'],
    ['Neurojires punto com', 'NeuroHires.com'],
    ['Forgevit dot com', 'ForgeVid.com'],
    ['neuro gires punto com', 'NeuroHires.com'],
    ['neuro guires dot com', 'NeuroHires.com'],
    ['NeuroHires dot com', 'NeuroHires.com'],
    ['neuro higher dot com', 'NeuroHires.com'],
    ['forge bid dot com', 'ForgeVid.com'],
    ['ForgeBeat dot com', 'ForgeVid.com'],
  ])('repairs "%s" to "%s"', (heard, expected) => {
    const c = cue(`Visit ${heard} today`)
    normalizeSpokenUrls([c])
    expect(c.text).toContain(expected)
  })

  it('repairs the karaoke WORDS too, merging split brand tokens with preserved timing', () => {
    const c = cue('Conócelo en Ring Guild punto com', ['Conócelo', 'en', 'Ring', 'Guild', 'punto', 'com'])
    normalizeSpokenUrls([c])
    expect(c.text).toContain('RingYield.com')
    const words = (c.words ?? []).map((w) => w.word)
    expect(words).toEqual(['Conócelo', 'en', 'RingYield.com'])
  })

  it('leaves ordinary sentences untouched', () => {
    const c = cue('The guild of blacksmiths hires higher apprentices')
    normalizeSpokenUrls([c])
    expect(c.text).toBe('The guild of blacksmiths hires higher apprentices')
  })

  it('does NOT fuzzy-snap real domains that merely resemble a brand', () => {
    const c = cue('Shop at rings dot com and ringcentral dot com today')
    normalizeSpokenUrls([c])
    expect(c.text).toContain('rings.com')
    expect(c.text).toContain('ringcentral.com')
    expect(c.text).not.toContain('RingYield')
  })
})
