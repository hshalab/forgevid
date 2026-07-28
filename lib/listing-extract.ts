/**
 * Listing-page harvester — turns a dealer's vehicle-detail page (or a
 * broker's property page) into the raw material for a REAL inventory
 * video: the item's title, price, key fact (mileage / beds-baths), and
 * its own gallery photos. This is what makes a prospect sample show THE
 * ACTUAL CAR THEY ARE SELLING instead of stock footage — the entire pitch
 * in one render.
 *
 * Parsing is deliberately tolerant (dealer sites are template soup):
 * lazy-load attributes (data-src/data-lazy/srcset) are read alongside
 * src, photos may live on third-party CDNs (allowed — downloads still go
 * through safe-fetch's SSRF guard), and every extracted FACT is verbatim
 * from the page — nothing is ever invented (same facts-only rule as
 * lib/listing-brief.ts).
 */
import fs from 'fs';
import path from 'path';
import { safeFetch } from './safe-fetch';
import { newestArrivalUrl } from './newest-inventory';

export interface ListingFacts {
  title: string | null;
  price: string | null;
  /** Mileage for vehicles, beds/baths for properties — whichever the page states. */
  keyFact: string | null;
  photoUrls: string[];
}

const PHOTO_BLACKLIST = /logo|icon|sprite|banner|badge|placeholder|avatar|flag|button|arrow|pixel|blank|loading|spinner|\.svg|\.gif/i;
const PHOTO_EXT = /\.(jpe?g|png|webp)(\?|$)/i;

function absolutize(raw: string, base: string): string | null {
  try {
    const url = new URL(raw.trim(), base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Pull every candidate photo URL out of the page, gallery order preserved. */
export function extractPhotoUrls(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined) => {
    if (!raw) return;
    const abs = absolutize(raw, baseUrl);
    if (!abs || seen.has(abs)) return;
    if (PHOTO_BLACKLIST.test(abs) || !PHOTO_EXT.test(abs)) return;
    seen.add(abs);
    urls.push(abs);
  };

  // og:image first — it is almost always the listing's lead photo.
  const og = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
    ?? html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  push(og?.[1]);

  // <img> tags: src plus the lazy-load variants dealer templates use.
  const imgPattern = /<img[^>]+>/gi;
  let tag: RegExpExecArray | null;
  while ((tag = imgPattern.exec(html)) !== null) {
    const t = tag[0];
    const attr = (name: string) => t.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
    // srcset: take the last (largest) candidate.
    const srcset = attr('srcset') ?? attr('data-srcset');
    if (srcset) push(srcset.split(',').pop()?.trim().split(/\s+/)[0]);
    push(attr('data-src') ?? attr('data-lazy') ?? attr('data-original') ?? attr('src'));
  }
  return urls;
}

/** Verbatim facts off the page — null when the page doesn't state them. */
export function extractFacts(html: string, vertical: 'auto' | 'realestate'): Omit<ListingFacts, 'photoUrls'> {
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');

  const ogTitle = text.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1];
  const h1 = text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, ' ');
  const title = (ogTitle ?? h1 ?? '').replace(/\s+/g, ' ').replace(/\s*[|·-]\s*[^|·-]{0,60}$/, '').trim() || null;

  const price = text.match(/\$\s?\d{1,3}(?:,\d{3})+(?!\d)/)?.[0]?.replace(/\s/, '') ?? null;

  let keyFact: string | null = null;
  if (vertical === 'auto') {
    const miles = text.match(/([\d,]{4,})\s*(?:mi\b|miles|millas)/i)?.[1];
    keyFact = miles ? `${miles} miles` : null;
  } else {
    const beds = text.match(/(\d+)\s*(?:bed|beds|bedrooms|hab)/i)?.[1];
    const baths = text.match(/(\d+(?:\.\d)?)\s*(?:bath|baths|bathrooms|bañ)/i)?.[1];
    keyFact = beds ? `${beds} bed${baths ? ` · ${baths} bath` : ''}` : null;
  }
  return { title, price, keyFact };
}

/**
 * Fetch a listing page and download up to `maxPhotos` of ITS photos to
 * local temp files. Photos under 25KB are skipped (icons survive the URL
 * filter; real inventory photos never come that small). Returns null when
 * the page yields fewer than 3 usable photos — the caller falls back.
 */
export async function harvestListing(
  listingUrl: string,
  vertical: 'auto' | 'realestate',
  maxPhotos = 6,
): Promise<(ListingFacts & { localPhotos: string[] }) | null> {
  try {
    const page = await safeFetch(listingUrl, { maxBytes: 2_000_000, timeoutMs: 15_000 });
    const html = page.body.toString('utf8');
    const facts = extractFacts(html, vertical);
    const photoUrls = extractPhotoUrls(html, page.finalUrl);

    const tempDir = path.join(process.cwd(), 'public', 'temp');
    fs.mkdirSync(tempDir, { recursive: true });
    const localPhotos: string[] = [];
    for (const url of photoUrls) {
      if (localPhotos.length >= maxPhotos) break;
      try {
        const photo = await safeFetch(url, {
          maxBytes: 10 * 1024 * 1024,
          timeoutMs: 12_000,
          acceptTypes: ['image'],
          headers: { Accept: 'image/*', Referer: listingUrl },
        });
        if (photo.body.length < 25_000) continue;
        const ext = /webp/i.test(photo.contentType) ? 'webp' : /png/i.test(photo.contentType) ? 'png' : 'jpg';
        const local = path.join(tempDir, `listing_${Date.now()}_${localPhotos.length}.${ext}`);
        fs.writeFileSync(local, photo.body);
        localPhotos.push(local);
      } catch {
        /* blocked/dead photo — try the next */
      }
    }

    if (localPhotos.length < 3) {
      for (const p of localPhotos) { try { fs.unlinkSync(p); } catch { /* ignore */ } }
      return null;
    }
    return { ...facts, photoUrls, localPhotos };
  } catch {
    return null;
  }
}

export interface ResolvedListing extends ListingFacts {
  localPhotos: string[];
  /** True = a single vehicle/property with its own price; false = an inventory grid of real items. */
  isSingleListing: boolean;
}

/**
 * The full resolver a prospect sample uses: turn whatever URL we have
 * (homepage or a specific listing) into the best available REAL footage of
 * the dealer's own inventory, in priority order:
 *   1. the given URL harvested directly (growth-daily already passes a
 *      vehicle detail URL for auto — this fires with price + facts);
 *   2. resolve the site's newest arrival and harvest THAT detail page;
 *   3. fall back to the inventory INDEX grid (real vehicle thumbnails, no
 *      single price) — still their actual cars, not stock.
 * Returns null only when the site yields nothing scrapable (JS-rendered
 * SPAs, anti-scraping) — the caller then uses site images / stock.
 */
export async function resolveListingForSample(
  url: string,
  vertical: 'auto' | 'realestate',
  maxPhotos = 6,
): Promise<ResolvedListing | null> {
  const direct = await harvestListing(url, vertical, maxPhotos);
  if (direct) return { ...direct, isSingleListing: true };

  const nav = await newestArrivalUrl(url);
  if (nav.isVehiclePage && nav.url !== url) {
    const detail = await harvestListing(nav.url, vertical, maxPhotos);
    if (detail) return { ...detail, isSingleListing: true };
  }
  if (nav.inventoryUrl) {
    const grid = await harvestListing(nav.inventoryUrl, vertical, maxPhotos);
    if (grid) {
      return { title: null, price: null, keyFact: null, photoUrls: grid.photoUrls, localPhotos: grid.localPhotos, isSingleListing: false };
    }
  }
  return null;
}
