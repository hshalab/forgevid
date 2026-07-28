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

/** Feed/data endpoints that contain an inventory hint but are NOT browsable pages. */
const NON_PAGE = /\/(feed|rss|xml|sitemap|api|json|export|\.xml|\.json|\.rss)/i;

/** The inventory-index URL a homepage links to, or null. Pure; pinned by tests. */
export function findInventoryIndexUrl(homepageHtml: string, baseUrl: string): string | null {
  const links = hrefsIn(homepageHtml, baseUrl).filter((link) => !NON_PAGE.test(new URL(link).pathname));
  for (const hint of INVENTORY_HINTS) {
    const matches = links.filter((link) => new URL(link).pathname.toLowerCase().includes(hint));
    if (matches.length) {
      // Prefer the shortest matching path (…/inventory over …/inventory/feed
      // /…/inventory/filter/foo) — the clean index, not a sub-view.
      return matches.sort((a, b) => new URL(a).pathname.length - new URL(b).pathname.length)[0];
    }
  }
  return null;
}

/**
 * EVERY vehicle-detail link on an inventory page, in page order, deduped.
 * The customer "just my website" on-ramp crawls these to build a whole
 * inventory. Pure; pinned by tests.
 */
export function findAllVehicleUrls(inventoryHtml: string, baseUrl: string): string[] {
  const links = hrefsIn(inventoryHtml, baseUrl);
  const inventoryPath = new URL(baseUrl).pathname.toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const url = new URL(link);
    const path = url.pathname.toLowerCase();
    if (path === inventoryPath || path === '/') continue; // the index itself
    if (NON_PAGE.test(path)) continue;
    const looksLikeVehicle =
      VEHICLE_HINTS.some((hint) => path.includes(hint)) || YEAR_MAKE_PATTERN.test(path);
    if (!looksLikeVehicle || path.split('/').filter(Boolean).length < 2) continue;
    // Dedup on path (ignore tracking query strings) so ?utm=… duplicates collapse.
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(link);
  }
  return out;
}

/**
 * The first vehicle-detail link on an inventory page — the newest arrival
 * under the newest-first convention. Pure; pinned by tests.
 */
export function findFirstVehicleUrl(inventoryHtml: string, baseUrl: string): string | null {
  return findAllVehicleUrls(inventoryHtml, baseUrl)[0] ?? null;
}

/**
 * Resolve the freshest-arrival URL for a dealer site. Returns the vehicle
 * detail URL, or the original site URL on ANY failure.
 */
export async function newestArrivalUrl(
  siteUrl: string,
): Promise<{ url: string; isVehiclePage: boolean; inventoryUrl: string | null }> {
  try {
    const homepage = await safeFetch(siteUrl, { maxBytes: 1_500_000, timeoutMs: 12_000 });
    const inventoryUrl = findInventoryIndexUrl(homepage.body.toString('utf8'), homepage.finalUrl);
    if (!inventoryUrl) return { url: siteUrl, isVehiclePage: false, inventoryUrl: null };

    const inventory = await safeFetch(inventoryUrl, { maxBytes: 1_500_000, timeoutMs: 12_000 });
    const vehicleUrl = findFirstVehicleUrl(inventory.body.toString('utf8'), inventory.finalUrl);
    if (!vehicleUrl) return { url: siteUrl, isVehiclePage: false, inventoryUrl };

    return { url: vehicleUrl, isVehiclePage: true, inventoryUrl };
  } catch {
    return { url: siteUrl, isVehiclePage: false, inventoryUrl: null };
  }
}
