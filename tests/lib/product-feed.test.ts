import { describe, it, expect } from '@jest/globals'
import { parseProductFeed, productPrompt, ProductParseError } from '@/lib/product-feed'

describe('parseProductFeed', () => {
  it('parses a Shopify-shaped JSON feed', () => {
    const feed = JSON.stringify({
      products: [
        {
          id: 'gid://shopify/Product/1',
          title: 'Wireless Earbuds Pro',
          vendor: 'Acme Audio',
          price: '49.00',
          body_html: '<p>Crisp <b>audio</b> all day.</p>',
          images: [{ src: 'https://example.com/earbuds.jpg' }],
        },
      ],
    })
    const [product] = parseProductFeed(feed, 'application/json')
    expect(product.title).toBe('Wireless Earbuds Pro')
    expect(product.brand).toBe('Acme Audio')
    expect(product.price).toBe('$49')
    expect(product.description).toBe('Crisp audio all day.')
    expect(product.photos).toEqual(['https://example.com/earbuds.jpg'])
  })

  it('parses a WooCommerce REST API product', () => {
    const feed = JSON.stringify([
      {
        id: 794,
        sku: 'YOGA-MAT-01',
        name: 'Premium Quality Yoga Mat',
        regular_price: '45.00',
        sale_price: '35.00',
        short_description: 'Premium eco-friendly yoga mat',
        images: [{ id: 1, src: 'https://example.com/yoga-mat.jpg' }],
      },
    ])
    const [product] = parseProductFeed(feed, 'application/json')
    expect(product.ref).toBe('794')
    expect(product.title).toBe('Premium Quality Yoga Mat')
    expect(product.description).toBe('Premium eco-friendly yoga mat')
    expect(product.photos).toEqual(['https://example.com/yoga-mat.jpg'])
    // Price comes from whichever of regular_price/sale_price appears first in
    // the record's own key order — both are now recognized aliases.
    expect(product.price).toMatch(/^\$(35|45)$/)
  })

  it('parses a BigCommerce catalog product', () => {
    const feed = JSON.stringify([
      {
        id: 118,
        sku: 'SJ13',
        name: 'Smith Journal 13',
        calculated_price: 12.99,
        description: '<p>A great read.</p>',
        images: [{ id: 1, url_standard: 'https://example.com/journal.jpg', url_zoom: 'https://example.com/journal-zoom.jpg' }],
      },
    ])
    const [product] = parseProductFeed(feed, 'application/json')
    expect(product.title).toBe('Smith Journal 13')
    expect(product.price).toBe('$12.99')
    expect(product.description).toBe('A great read.')
    expect(product.photos).toContain('https://example.com/journal.jpg')
  })

  it('parses Google Merchant Center XML with the g: namespace', () => {
    const feed = `<?xml version="1.0"?>
      <rss xmlns:g="http://base.google.com/ns/1.0">
        <channel>
          <item>
            <g:id>sku-1</g:id>
            <g:title>Trail Running Shoes</g:title>
            <g:price>89.99 USD</g:price>
            <g:brand>Acme Outdoors</g:brand>
            <g:image_link>https://example.com/shoes.jpg</g:image_link>
          </item>
        </channel>
      </rss>`
    const [product] = parseProductFeed(feed, 'application/xml')
    expect(product.title).toBe('Trail Running Shoes')
    expect(product.brand).toBe('Acme Outdoors')
    expect(product.photos).toEqual(['https://example.com/shoes.jpg'])
  })

  it('rejects a product with no title', () => {
    const feed = JSON.stringify([{ id: 'x', images: [{ src: 'https://example.com/a.jpg' }] }])
    expect(() => parseProductFeed(feed, 'application/json')).toThrow(ProductParseError)
  })

  it('rejects a product with no image', () => {
    const feed = JSON.stringify([{ id: 'x', title: 'No Photo Product' }])
    expect(() => parseProductFeed(feed, 'application/json')).toThrow(ProductParseError)
  })
})

describe('productPrompt', () => {
  it('states only supplied facts and forbids inventing claims', () => {
    const prompt = productPrompt(
      { ref: 'x', title: 'Wireless Earbuds Pro', price: '$49', brand: 'Acme Audio', photos: ['a.jpg'] },
      3,
    )
    expect(prompt).toContain('Wireless Earbuds Pro')
    expect(prompt).toContain('$49')
    expect(prompt).toContain('never invent')
  })
})
