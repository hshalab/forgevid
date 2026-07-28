import { describe, it, expect } from '@jest/globals'
import { findAllVehicleUrls, findFirstVehicleUrl, findInventoryIndexUrl } from '@/lib/newest-inventory'

const BASE = 'https://dealer.example.com/'

describe('findInventoryIndexUrl', () => {
  it('finds the inventory link on a typical dealer homepage', () => {
    const html = `
      <a href="/about">About</a>
      <a href="/inventory?sort=newest">View Inventory</a>
      <a href="/contact">Contact</a>`
    expect(findInventoryIndexUrl(html, BASE)).toBe('https://dealer.example.com/inventory?sort=newest')
  })

  it('recognizes Spanish inventory paths', () => {
    const html = `<a href="/autos-usados">Autos Usados</a>`
    expect(findInventoryIndexUrl(html, BASE)).toBe('https://dealer.example.com/autos-usados')
  })

  it('never follows a link off the dealer domain', () => {
    const html = `<a href="https://evil.example.net/inventory">Inventory</a>`
    expect(findInventoryIndexUrl(html, BASE)).toBeNull()
  })

  it('returns null when nothing inventory-shaped exists', () => {
    const html = `<a href="/about">About</a><a href="/financing">Financing</a>`
    expect(findInventoryIndexUrl(html, BASE)).toBeNull()
  })
})

describe('findFirstVehicleUrl', () => {
  const INDEX = 'https://dealer.example.com/inventory'

  it('returns the FIRST vehicle detail link — newest-first is the dealer-site convention', () => {
    const html = `
      <a href="/inventory">All</a>
      <a href="/inventory/2024-toyota-rav4-xle-12345">2024 RAV4</a>
      <a href="/inventory/2019-honda-civic-99887">2019 Civic</a>`
    expect(findFirstVehicleUrl(html, INDEX)).toBe(
      'https://dealer.example.com/inventory/2024-toyota-rav4-xle-12345',
    )
  })

  it('recognizes vdp/vehicle/detail URL shapes', () => {
    const html = `<a href="/vdp/used-2023-ford-f150">F-150</a>`
    expect(findFirstVehicleUrl(html, INDEX)).toBe('https://dealer.example.com/vdp/used-2023-ford-f150')
  })

  it('skips the index itself, the homepage, and shallow non-detail links', () => {
    const html = `
      <a href="/inventory">Inventory</a>
      <a href="/">Home</a>
      <a href="/financing">Financing</a>`
    expect(findFirstVehicleUrl(html, INDEX)).toBeNull()
  })

  it('never returns an off-domain link', () => {
    const html = `<a href="https://cars.example.org/vehicle/123">Syndicated</a>`
    expect(findFirstVehicleUrl(html, INDEX)).toBeNull()
  })
})

describe('findInventoryIndexUrl — feed/sub-view exclusion', () => {
  it('skips /inventory/feed and picks the clean inventory index', () => {
    const html = `
      <a href="/inventory/feed/">XML feed</a>
      <a href="/inventory/">Browse Inventory</a>
      <a href="/inventory/filter/suv">SUVs</a>`
    expect(findInventoryIndexUrl(html, BASE)).toBe('https://dealer.example.com/inventory/')
  })

  it('never returns an rss/xml/api/sitemap endpoint even if it is the only inventory link', () => {
    const html = `<a href="/inventory/feed.xml">feed</a>`
    expect(findInventoryIndexUrl(html, BASE)).toBeNull()
  })
})

describe('findAllVehicleUrls', () => {
  const INDEX = 'https://dealer.example.com/inventory'
  it('returns every distinct vehicle detail link in page order (newest first)', () => {
    const html = `
      <a href="/inventory">All</a>
      <a href="/inventory/2024-toyota-rav4-111">RAV4</a>
      <a href="/inventory/2019-honda-civic-222">Civic</a>
      <a href="/inventory/2024-toyota-rav4-111?utm=x">RAV4 dup</a>
      <a href="/vdp/2021-ford-f150-333">F150</a>`
    expect(findAllVehicleUrls(html, INDEX)).toEqual([
      'https://dealer.example.com/inventory/2024-toyota-rav4-111',
      'https://dealer.example.com/inventory/2019-honda-civic-222',
      'https://dealer.example.com/vdp/2021-ford-f150-333',
    ])
  })
  it('excludes the index, feeds, and off-domain links', () => {
    const html = `
      <a href="/inventory">Index</a>
      <a href="/inventory/feed.xml">Feed</a>
      <a href="https://cars.other.com/vehicle/9">Syndicated</a>
      <a href="/inventory/2020-kia-soul-44">Real</a>`
    expect(findAllVehicleUrls(html, INDEX)).toEqual(['https://dealer.example.com/inventory/2020-kia-soul-44'])
  })
  it('findFirstVehicleUrl returns the first of findAllVehicleUrls', () => {
    const html = `<a href="/inventory/2024-a-1">A</a><a href="/inventory/2023-b-2">B</a>`
    expect(findFirstVehicleUrl(html, INDEX)).toBe('https://dealer.example.com/inventory/2024-a-1')
  })
})
