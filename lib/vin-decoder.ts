/**
 * Free VIN decoding via NHTSA's public vPIC API — no key, no cost. Used to
 * BACKFILL gaps in a dealer's own feed (year/make/model/trim/body style),
 * never to override what the feed already states: the feed is the dealer's
 * own representation and stays authoritative (legal/terms-of-service.md 6.3
 * — "any factual claims... are your representations, not ours").
 *
 * Fails open on any network, timeout, or decode error: an NHTSA outage must
 * never block a vehicle video from generating, it just skips the enrichment.
 *
 * Relative imports only — reachable from the worker process.
 */
import { safeFetch } from './safe-fetch';

export interface VinDecodeResult {
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  bodyClass?: string;
  fuelType?: string;
  driveType?: string;
  transmission?: string;
  engineCylinders?: string;
}

// Standard VIN alphabet excludes I, O, Q (too easily confused with 1/0).
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;

export function looksLikeVin(value: string): boolean {
  return VIN_RE.test(value.trim());
}

function cleanField(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 && text !== 'Not Applicable' ? text : undefined;
}

/** Decode a VIN, or return null if it doesn't look like one or decoding fails. */
export async function decodeVin(vin: string): Promise<VinDecodeResult | null> {
  const clean = vin.trim().toUpperCase();
  if (!looksLikeVin(clean)) return null;

  try {
    const res = await safeFetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${encodeURIComponent(clean)}?format=json`,
      { timeoutMs: 8_000, maxBytes: 2 * 1024 * 1024, acceptTypes: ['application/json', 'text/json', 'text'] },
    );
    const json = JSON.parse(res.body.toString('utf8'));
    const row = json?.Results?.[0];
    if (!row) return null;

    // ErrorCode "0" (or "0,..." for informational-only codes appended after a
    // comma) means a clean decode. Anything else — check-digit mismatch,
    // unrecognized manufacturer — is too unreliable to enrich a listing from.
    const errorCode = String(row.ErrorCode ?? '').split(',')[0].trim();
    if (errorCode !== '0') return null;

    const year = Number(row.ModelYear);
    return {
      year: Number.isFinite(year) && year > 1980 ? year : undefined,
      make: cleanField(row.Make),
      model: cleanField(row.Model),
      trim: cleanField(row.Trim),
      bodyClass: cleanField(row.BodyClass),
      fuelType: cleanField(row.FuelTypePrimary),
      driveType: cleanField(row.DriveType),
      transmission: cleanField(row.TransmissionStyle),
      engineCylinders: cleanField(row.EngineCylinders),
    };
  } catch (error) {
    console.error('[VIN Decoder] decode failed (non-fatal):', error);
    return null;
  }
}
