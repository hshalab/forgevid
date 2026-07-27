/**
 * Automotive inventory ingestion — a dealership's DMS feed into a video per car.
 *
 * A dealership photographs every vehicle for its listings and its inventory
 * system (vAuto, Dealer.com, HomeNet, DealerCenter, ...) already exports a feed.
 * Point us at it and each car on the lot becomes a narrated, captioned video the
 * same hour, with its price / mileage / year burned in — the facts a shopper
 * actually wants on screen.
 *
 * Nothing is invented: the video says only what the feed says (a dealer is
 * legally accountable for what an ad claims). A vehicle with no photos is
 * rejected by name.
 *
 * The parser is PURE and shares lib/feed-core with real estate and e-commerce.
 * Relative imports only — reachable from the worker process.
 */

import {
  FeedParseError,
  asCount,
  asPrice,
  asText,
  extractPhotos,
  parseFeed,
  pick,
  pickAll,
  type FeedShape,
} from './feed-core';
import type { LowerThird } from './lower-third';
import { decodeVin, looksLikeVin, type VinDecodeResult } from './vin-decoder';

export interface Vehicle {
  /** The dealer's own stock number or VIN, echoed back so they can match rows. */
  ref: string;
  /** "2022 Toyota RAV4 XLE" — the headline. */
  title: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  price?: string;
  /** Formatted for display, e.g. "24,000 mi". */
  mileage?: string;
  /** Free-text selling points from the dealer's own listing copy. */
  highlights?: string;
  photos: string[];
  /**
   * True when `title` was built from year/make/model/trim because the feed
   * had no title field of its own — never set for a feed-supplied or
   * user-submitted explicit title. VIN enrichment uses this to know whether
   * recomposing the title (once more parts are filled in) is safe, instead of
   * re-deriving the same fact by re-running composeTitle() and string-
   * comparing, which would misfire if a real title happened to match that format.
   */
  titleComposed?: boolean;
}

export class VehicleParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VehicleParseError';
  }
}

const ALIASES = {
  ref: ['StockNumber', 'Stock', 'StockNo', 'VIN', 'Vin', 'id', 'ref', 'InventoryId'],
  year: ['Year', 'ModelYear', 'VehicleYear'],
  make: ['Make', 'Manufacturer', 'Brand'],
  model: ['Model', 'ModelName'],
  trim: ['Trim', 'TrimLevel', 'Series', 'Edition'],
  price: ['Price', 'SellingPrice', 'ListPrice', 'InternetPrice', 'SalePrice', 'Msrp', 'MSRP'],
  mileage: ['Mileage', 'Odometer', 'Miles', 'KM', 'Kilometers'],
  highlights: ['Description', 'Comments', 'Features', 'Options', 'SellerNotes', 'DealerNotes'],
  media: ['Photos', 'Images', 'ImageUrls', 'PhotoUrls', 'Media', 'Pictures'],
  // A full "2022 Toyota RAV4" title, if the feed provides one directly.
  title: ['Title', 'VehicleTitle', 'Headline', 'Name'],
};

/** "24000", "24,000", "24000 miles" -> "24,000 mi". Unknown units pass through. */
function formatMileage(value: unknown): string | undefined {
  const text = asText(value);
  if (!text) return undefined;
  const n = Number(text.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return text;
  const unit = /km|kilomet/i.test(text) ? 'km' : 'mi';
  return `${Math.round(n).toLocaleString('en-US')} ${unit}`;
}

/** Build "2022 Toyota RAV4 XLE" from parts when the feed has no title field. */
function composeTitle(v: Pick<Vehicle, 'year' | 'make' | 'model' | 'trim'>): string {
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ').trim();
}

const VEHICLE_SHAPE: FeedShape<Vehicle> = {
  // A record is a real vehicle if it has a stock number, VIN, or make/model.
  identityAliases: [...ALIASES.ref, ...ALIASES.make, ...ALIASES.model],
  noun: 'vehicle',
  toItem(record, index) {
    const photos = extractPhotos(pickAll(record, ALIASES.media));
    const year = asCount(pick(record, ALIASES.year));
    const make = asText(pick(record, ALIASES.make));
    const model = asText(pick(record, ALIASES.model));
    const trim = asText(pick(record, ALIASES.trim));
    const ref = asText(pick(record, ALIASES.ref)) ?? `feed-${index + 1}`;

    const explicitTitle = asText(pick(record, ALIASES.title));
    const title = explicitTitle ?? composeTitle({ year, make, model, trim });
    if (!title) {
      throw new VehicleParseError(`Feed entry ${index + 1} (${ref}): no title, make, or model`);
    }
    if (photos.length === 0) {
      throw new VehicleParseError(`Feed entry ${index + 1} (${title}): no photos`);
    }

    return {
      ref,
      title,
      titleComposed: !explicitTitle,
      year,
      make,
      model,
      trim,
      price: asPrice(pick(record, ALIASES.price)),
      mileage: formatMileage(pick(record, ALIASES.mileage)),
      highlights: asText(pick(record, ALIASES.highlights))?.slice(0, 1000),
      photos,
    };
  },
};

export function parseVehicleFeed(text: string, contentType = ''): Vehicle[] {
  try {
    return parseFeed(text, contentType, VEHICLE_SHAPE);
  } catch (error) {
    if (error instanceof FeedParseError) throw new VehicleParseError(error.message);
    throw error;
  }
}

/** Turn body style / drivetrain / fuel type into a short factual line. */
function describeVinExtras(decoded: VinDecodeResult): string | undefined {
  const parts = [decoded.bodyClass, decoded.driveType, decoded.fuelType].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * Best-effort enrichment for a vehicle that already parsed successfully (has a
 * title, and photos) but is missing detail fields a free NHTSA VIN decode can
 * fill in — dealer feeds vary wildly in completeness. NEVER overwrites a field
 * the feed already provided; the feed is the dealer's own representation of
 * the car (see the module doc above and legal/terms-of-service.md 6.3).
 *
 * A no-op when `ref` isn't VIN-shaped, nothing is actually missing, or the
 * decode fails/times out — callers can run this unconditionally over a batch.
 */
export async function enrichVehicleFromVin(vehicle: Vehicle): Promise<Vehicle> {
  const missingSomething = !vehicle.year || !vehicle.make || !vehicle.model || !vehicle.trim;
  if (!missingSomething || !looksLikeVin(vehicle.ref)) return vehicle;

  const decoded = await decodeVin(vehicle.ref);
  if (!decoded) return vehicle;

  const year = vehicle.year ?? decoded.year;
  const make = vehicle.make ?? decoded.make;
  const model = vehicle.model ?? decoded.model;
  const trim = vehicle.trim ?? decoded.trim;

  // Only rebuild the headline from parts when the feed's title WAS composed
  // from them — an explicit dealer-supplied title always wins.
  const title = vehicle.titleComposed ? composeTitle({ year, make, model, trim }) || vehicle.title : vehicle.title;

  return {
    ...vehicle,
    year,
    make,
    model,
    trim,
    title,
    highlights: vehicle.highlights ?? describeVinExtras(decoded),
  };
}

/** The generation prompt: facts only, and an explicit ban on inventing them. */
export function vehiclePrompt(vehicle: Vehicle, sceneCount: number): string {
  const facts: string[] = [];
  if (vehicle.mileage) facts.push(`${vehicle.mileage} on the odometer`);
  if (vehicle.trim) facts.push(`the ${vehicle.trim} trim`);

  return [
    `A used-car dealership listing video for a ${vehicle.title}.`,
    facts.length ? `It has ${facts.join(' and ')}.` : '',
    vehicle.price ? `It is priced at ${vehicle.price}.` : '',
    vehicle.highlights ? `Selling points: ${vehicle.highlights}.` : '',
    `There are ${sceneCount} photographs, shown in order.`,
    'Write a confident, trustworthy dealership voiceover that names the vehicle and',
    'its real features, using ONLY the facts above — never invent options, mileage,',
    'a price, or a warranty. Close by inviting the viewer to book a test drive.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Title + "$28,900 · 24,000 mi · 2022" burned into the opening seconds. */
export function vehicleLowerThird(vehicle: Vehicle): LowerThird {
  return {
    title: vehicle.title,
    facts: [vehicle.price, vehicle.mileage, vehicle.year ? String(vehicle.year) : undefined].filter(
      (f): f is string => Boolean(f),
    ),
    start: 0.6,
    duration: 4.5,
  };
}
