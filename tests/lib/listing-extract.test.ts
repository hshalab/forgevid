import { describe, it, expect } from '@jest/globals'
import { extractFacts, extractPhotoUrls } from '@/lib/listing-extract'

const BASE = 'https://dealer.example.com/inventory/2022-toyota-rav4'

describe('extractPhotoUrls', () => {
  it('takes og:image first, then gallery images, dedup and gallery order', () => {
    const html = `
      <meta property="og:image" content="/photos/lead.jpg" />
      <img src="/photos/1.jpg">
      <img src="/photos/2.jpg">
      <img src="/photos/1.jpg">`
    expect(extractPhotoUrls(html, BASE)).toEqual([
      'https://dealer.example.com/photos/lead.jpg',
      'https://dealer.example.com/photos/1.jpg',
      'https://dealer.example.com/photos/2.jpg',
    ])
  })

  it('reads lazy-load attributes dealer templates use (data-src / data-lazy / srcset)', () => {
    const html = `
      <img data-src="/lazy/a.jpg">
      <img data-lazy="/lazy/b.png">
      <img srcset="/small.jpg 480w, /large.jpg 1200w">`
    expect(extractPhotoUrls(html, BASE)).toEqual([
      'https://dealer.example.com/lazy/a.jpg',
      'https://dealer.example.com/lazy/b.png',
      'https://dealer.example.com/large.jpg',
    ])
  })

  it('allows off-domain photo CDNs (real inventory photos are syndicated)', () => {
    const html = `<img src="https://cdn.dealercarsearch.com/vehicle/9987.jpg">`
    expect(extractPhotoUrls(html, BASE)).toEqual(['https://cdn.dealercarsearch.com/vehicle/9987.jpg'])
  })

  it('rejects logos, icons, sprites, svg/gif — not real inventory photos', () => {
    const html = `
      <img src="/assets/logo.png">
      <img src="/icons/phone.svg">
      <img src="/sprite.gif">
      <img src="/photos/actual-car.jpg">`
    expect(extractPhotoUrls(html, BASE)).toEqual(['https://dealer.example.com/photos/actual-car.jpg'])
  })
})

describe('extractFacts', () => {
  it('pulls the vehicle title, price, and mileage verbatim — never invented', () => {
    const html = `
      <meta property="og:title" content="2022 Toyota RAV4 XLE | Franco Automotors" />
      <div class="price">$28,900</div>
      <span>Mileage: 24,150 miles</span>`
    expect(extractFacts(html, 'auto')).toEqual({
      title: '2022 Toyota RAV4 XLE',
      price: '$28,900',
      keyFact: '24,150 miles',
    })
  })

  it('pulls beds/baths for a property listing', () => {
    const html = `
      <h1>1925 Demo Street, Miami</h1>
      <div>$625,000</div>
      <ul><li>4 beds</li><li>3 baths</li></ul>`
    const facts = extractFacts(html, 'realestate')
    expect(facts.price).toBe('$625,000')
    expect(facts.keyFact).toBe('4 bed · 3 bath')
  })

  it('returns null facts rather than guessing when the page states none', () => {
    const facts = extractFacts('<h1>Welcome to our lot</h1>', 'auto')
    expect(facts.price).toBeNull()
    expect(facts.keyFact).toBeNull()
    expect(facts.title).toBe('Welcome to our lot')
  })

  it('ignores prices hidden inside scripts', () => {
    const html = `<script>var x = "$99,999";</script><h1>Car</h1>`
    expect(extractFacts(html, 'auto').price).toBeNull()
  })
})
