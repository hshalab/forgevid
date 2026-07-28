/**
 * Newest-arrival finder — for automotive prospect samples, the video should
 * feature the freshest car on the dealer's lot, not their homepage. Nearly
 * every dealer site lists inventory newest-first, so the FIRST vehicle
 * detail link on the inventory page is a strong "just arrived" heuristic.
 *
 * Strictly best-effort: any miss at any step (no inventory link found, page
 * unfetchable, no vehicle links recognized) falls back to the site URL the
 * tracker already had — a working homepage sample always beats a broken
 * clever one. All fetching goes through lib/safe-fetch (SSRF-guarded, size/
 * time-capped), the same boundary every other site-reading feature uses.
 */
import { safeFetch } from './safe-fetch';

/** Paths that smell like a dealer inventory index, in preference order. */
const INVENTORY_HINTS = [
  'inventory', 'used-cars', 'used-vehicles', 'usados', 'vehicles', 'cars-for-sale', 'autos',
];

/** URL fragments that identify a single-vehicle detail page. */
const VEHICLE_HINTS = ['/vehicle', '/vdp', '/detail', '/inventory/', '/used/', '/auto/'];

/** VIN-ish or year-make tails also mark detail pages (e.g. /2022-toyota-rav4-...). */
const YEAR_MAKE_PATTERN = /\/(19|20)\d{2}-[a-z]+/i;

function absolutize(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // Never wander off the dealer's own site.
    if (new URL(base).hostname !== url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function hrefsIn(html: string, base: string): string[] {
  const out: string[] = [];
  const pattern = /href\s*=\s*["']([^"'#]+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const abs = absolutize(match[1], base);
    if (abs) out.push(abs);
  }
  return out;
}

/** The inventory-index URL a homepage links to, or null. Pure; pinned by tests. */
export function findInventoryIndexUrl(homepageHtml: string, baseUrl: string): string | null {
  const links = hrefsIn(homepageHtml, baseUrl);
  for (const hint of INVENTORY_HINTS) {
    const hit = links.find((link) => new URL(link).pathname.toLowerCase().includes(hint));
    if (hit) return hit;
  }
  return null;
}

/**
 * The first vehicle-detail link on an inventory page — the newest arrival
 * under the newest-first convention. Pure; pinned by tests.
 */
export function findFirstVehicleUrl(inventoryHtml: string, baseUrl: string): string | null {
  const links = hrefsIn(inventoryHtml, baseUrl);
  const inventoryPath = new URL(baseUrl).pathname.toLowerCase();
  for (const link of links) {
    const path = new URL(link).pathname.toLowerCase();
    if (path === inventoryPath || path === '/') continue; // the index itself
    const looksLikeVehicle =
      VEHICLE_HINTS.some((hint) => path.includes(hint)) || YEAR_MAKE_PATTERN.test(path);
    // A real detail page is deeper than the index, not a filter/sort query.
    if (looksLikeVehicle && path.split('/').filter(Boolean).length >= 2) {
      return link;
    }
  }
  return null;
}

/**
 * Resolve the freshest-arrival URL for a dealer site. Returns the vehicle
 * detail URL, or the original site URL on ANY failure.
 */
export async function newestArrivalUrl(siteUrl: string): Promise<{ url: string; isVehiclePage: boolean }> {
  try {
    const homepage = await safeFetch(siteUrl, { maxBytes: 1_500_000, timeoutMs: 12_000 });
    const inventoryUrl = findInventoryIndexUrl(homepage.body.toString('utf8'), homepage.finalUrl);
    if (!inventoryUrl) return { url: siteUrl, isVehiclePage: false };

    const inventory = await safeFetch(inventoryUrl, { maxBytes: 1_500_000, timeoutMs: 12_000 });
    const vehicleUrl = findFirstVehicleUrl(inventory.body.toString('utf8'), inventory.finalUrl);
    if (!vehicleUrl) return { url: siteUrl, isVehiclePage: false };

    return { url: vehicleUrl, isVehiclePage: true };
  } catch {
    return { url: siteUrl, isVehiclePage: false };
  }
}
