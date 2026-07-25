import { describe, it, expect } from '@jest/globals'
import { scoreItem } from '@/lib/inventory'

const NOW = new Date('2026-07-25T12:00:00.000Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

describe('scoreItem', () => {
  it('flags a brand-new item as a new arrival with no video yet', () => {
    const result = scoreItem(
      { firstSeenAt: daysAgo(1), lastSeenAt: NOW },
      [],
      NOW,
    )
    expect(result.isNewArrival).toBe(true)
    expect(result.hasRecentVideo).toBe(false)
    expect(result.reasons).toContain('new arrival — no video yet')
    expect(result.reasons).toContain('never had a video made')
  })

  it('scores an aging item with no video higher than a fresh item with a recent video', () => {
    const aging = scoreItem(
      { firstSeenAt: daysAgo(45), lastSeenAt: NOW },
      [],
      NOW,
    )
    const freshWithVideo = scoreItem(
      { firstSeenAt: daysAgo(3), lastSeenAt: NOW },
      [{ priceText: '$24,999', videoId: 'v1', createdAt: daysAgo(1) }],
      NOW,
    )
    expect(aging.score).toBeGreaterThan(freshWithVideo.score)
    expect(aging.reasons.some((r) => r.includes('days in inventory'))).toBe(true)
  })

  it('recognizes a video within the recency window as "has recent video"', () => {
    const result = scoreItem(
      { firstSeenAt: daysAgo(30), lastSeenAt: NOW },
      [{ priceText: '$500', videoId: 'v1', createdAt: daysAgo(5) }],
      NOW,
    )
    expect(result.hasRecentVideo).toBe(true)
    expect(result.reasons).not.toContain('never had a video made')
  })

  it('does NOT call a video stale before the recency window elapses', () => {
    const result = scoreItem(
      { firstSeenAt: daysAgo(30), lastSeenAt: NOW },
      [{ priceText: '$500', videoId: 'v1', createdAt: daysAgo(13) }],
      NOW,
    )
    expect(result.hasRecentVideo).toBe(true)
  })

  it('calls a video stale once the recency window has elapsed', () => {
    const result = scoreItem(
      { firstSeenAt: daysAgo(30), lastSeenAt: NOW },
      [{ priceText: '$500', videoId: 'v1', createdAt: daysAgo(15) }],
      NOW,
    )
    expect(result.hasRecentVideo).toBe(false)
    expect(result.reasons.some((r) => r.includes('no video in the last'))).toBe(true)
  })

  it('detects a price change since the last video by text inequality only', () => {
    const changed = scoreItem(
      { firstSeenAt: daysAgo(20), lastSeenAt: NOW },
      [
        { priceText: '$24,999', videoId: 'v1', createdAt: daysAgo(10) },
        { priceText: '$22,999', videoId: null, createdAt: daysAgo(1) },
      ],
      NOW,
    )
    expect(changed.priceChangedSinceLastVideo).toBe(true)
    expect(changed.reasons).toContain('price changed since the last video')

    const unchanged = scoreItem(
      { firstSeenAt: daysAgo(20), lastSeenAt: NOW },
      [
        { priceText: '$24,999', videoId: 'v1', createdAt: daysAgo(10) },
        { priceText: '$24,999', videoId: null, createdAt: daysAgo(1) },
      ],
      NOW,
    )
    expect(unchanged.priceChangedSinceLastVideo).toBe(false)
  })

  it('never fabricates a price-change claim when there is no prior video to compare against', () => {
    const result = scoreItem(
      { firstSeenAt: daysAgo(5), lastSeenAt: NOW },
      [{ priceText: '$24,999', videoId: null, createdAt: daysAgo(1) }],
      NOW,
    )
    expect(result.priceChangedSinceLastVideo).toBe(false)
  })

  it('caps the aging component of the score so a 5-year-old stale record does not dominate', () => {
    const veryOld = scoreItem(
      { firstSeenAt: daysAgo(1000), lastSeenAt: NOW },
      [],
      NOW,
    )
    const cappedAt60 = scoreItem(
      { firstSeenAt: daysAgo(60), lastSeenAt: NOW },
      [],
      NOW,
    )
    expect(veryOld.score).toBe(cappedAt60.score)
  })
})
