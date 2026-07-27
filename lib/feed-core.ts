/**
 * Shared machinery for every "point us at your feed" vertical.
 *
 * Real estate (MLS), automotive (DMS inventory), and e-commerce (product feed)
 * all differ only in their field names and what a video says about each item;
 * the plumbing — parse JSON or XML, find the array of records, look fields up by
 * case-insensitive alias, dig photo URLs out of a dozen shapes — is identical.
 * It lived once in mls-feed.ts; this is the same code, extracted so the two new
 * verticals cannot drift from the tested one.
 *
 * Everything here is PURE (text in, records out). Fetching a feed URL is done by
 * the route behind lib/safe-fetch, because a feed URL is attacker-supplied data.
 *
 * Relative imports only — reachable from the worker process.
 */

import { XMLParser } from 'fast-xml-parser';

export class FeedParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedParseError';
  }
}

const normaliseKey = (s: string) => s.toLowerCase().replace(/[\s_:-]/g, '');

/** Case- and separator-insensitive lookup across a record's keys (first match). */
export function pick(record: Record<string, unknown>, aliases: string[]): unknown {
  const wanted = new Set(aliases.map(normaliseKey));
  for (const [key, value] of Object.entries(record)) {
    if (wanted.has(normaliseKey(key))) return value;
  }
  return undefined;
}

/**
 * EVERY value whose key matches an alias, in record order.
 *
 * Photos are the reason this exists: a Google Merchant item carries them in
 * BOTH `image_link` and `additional_image_link`, so picking only the first
 * field drops every extra shot.
 */
export function pickAll(record: Record<string, unknown>, aliases: string[]): unknown[] {
  const wanted = new Set(aliases.map(normaliseKey));
  const out: unknown[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (wanted.has(normaliseKey(key))) out.push(value);
  }
  return out;
}

export function asText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

export function asCount(value: unknown): number | undefined {
  const n = Number(asText(value));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

/** Money arrives as 685000, "685000", "$685,000", or "28900.00 USD". */
export function asPrice(value: unknown): string | undefined {
  const text = asText(value);
  if (!text) return undefined;
  const bare = Number(text.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(bare) || bare <= 0) return text;
  // Drop a trailing .00 that feed exports love, keep real cents.
  const rounded = Number.isInteger(bare) ? bare : Math.round(bare * 100) / 100;
  return `$${rounded.toLocaleString('en-US')}`;
}

/**
 * Dig photo/media URLs out of whatever shape a feed buried them in, in order.
 *
 * RESO uses Media[].MediaURL; Google Merchant uses image_link / additional_
 * image_link; portal XML uses <Photo url="…"> or <Photo>…</Photo>; some feeds
 * put a whitespace/semicolon/pipe-separated string in one field. Only http(s)
 * survives — a feed must never smuggle file:// or javascript: to the renderer.
 */
export function extractPhotos(raw: unknown): string[] {
  const urls: string[] = [];
  const visit = (node: unknown): void => {
    if (!node) return;
    if (typeof node === 'string') {
      for (const part of node.split(/[\s;|]+/)) {
        if (/^https?:\/\//i.test(part)) urls.push(part);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node === 'object') {
      const record = node as Record<string, unknown>;
      const direct = pick(record, [
        'MediaURL', 'MediaUrl', 'Url', 'href', '#text', 'Photo', 'Image',
        'image_link', 'additional_image_link', 'ImageUrl', 'src',
        // url_standard/url_zoom: BigCommerce's catalog Image object field names.
        'url_standard', 'url_zoom',
      ]);
      if (direct) visit(direct);
      else Object.values(record).forEach(visit);
    }
  };
  visit(raw);
  return [...new Set(urls)];
}

/**
 * A vertical describes its feed with this: how to recognise a record (a field
 * that must be present), and how to turn a raw record into its domain object.
 */
export interface FeedShape<T> {
  /** Aliases for the field that identifies a real record (address, VIN, title). */
  identityAliases: string[];
  /** Map one raw record to a domain object, or throw FeedParseError. */
  toItem: (record: Record<string, unknown>, index: number) => T;
  /** What one row is called, for error messages ("listing", "vehicle"). */
  noun: string;
}

/** Records from a JSON feed: a bare array, or `{ value: [...] }` (RESO/OData). */
function jsonRecords(text: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new FeedParseError('The feed is not valid JSON');
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown>)?.value)
      ? ((parsed as Record<string, unknown>).value as unknown[])
      // Shopify wraps products; try the common single-key envelopes.
      : Array.isArray((parsed as Record<string, unknown>)?.products)
        ? ((parsed as Record<string, unknown>).products as unknown[])
        : null;
  if (!rows) throw new FeedParseError('Expected an array, or an object with a `value` or `products` array');
  return rows.map((r) => (r ?? {}) as Record<string, unknown>);
}

/** Records from an XML feed: the first array of objects that look like records. */
function xmlRecords(text: string, shape: FeedShape<unknown>): Record<string, unknown>[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', trimValues: true });
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(text) as Record<string, unknown>;
  } catch {
    throw new FeedParseError('The feed is not valid XML');
  }

  const found: Record<string, unknown>[][] = [];
  const walk = (node: unknown): void => {
    if (found.length > 0 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.length > 0 && node.every((n) => n && typeof n === 'object')) {
        found.push(node as Record<string, unknown>[]);
      }
      return;
    }
    for (const value of Object.values(node as Record<string, unknown>)) {
      if (found.length > 0) return;
      // A single record does not become an array — recognise it by its identity field.
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (asText(pick(value as Record<string, unknown>, shape.identityAliases))) {
          found.push([value as Record<string, unknown>]);
          return;
        }
      }
      walk(value);
    }
  };
  walk(doc);
  return found[0] ?? [];
}

/** Parse a feed of either shape into domain objects, dispatching on content-type. */
export function parseFeed<T>(text: string, contentType: string, shape: FeedShape<T>): T[] {
  const bare = contentType.split(';')[0].trim().toLowerCase();
  const first = text.trimStart()[0];

  let records: Record<string, unknown>[];
  if (bare.includes('json') || (!bare.includes('xml') && (first === '{' || first === '['))) {
    records = jsonRecords(text);
  } else if (bare.includes('xml') || first === '<') {
    records = xmlRecords(text, shape as FeedShape<unknown>);
  } else {
    throw new FeedParseError('Could not tell whether the feed is JSON or XML');
  }

  if (records.length === 0) throw new FeedParseError(`No ${shape.noun}s found in the feed`);
  return records.map((r, i) => shape.toItem(r, i));
}
