/**
 * Shared CSV-import plumbing: size/row-count bounds, header/row splitting, and
 * ownership-checking a batch of AdCreative ids against the caller. Both
 * app/api/growth-operator/conversions/import and
 * .../creative-performance/import need exactly this shape — factored out
 * once the second one made it a real duplication, not before.
 *
 * Relative imports only — reachable from the worker process.
 */
import { prisma } from './prisma';
import { splitCsvLine } from './listing-brief';

export class CsvImportError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CsvImportError';
    this.status = status;
  }
}

export interface ParsedCsv {
  headers: string[];
  /** Raw cells per data row (header excluded), in file order. */
  rows: string[][];
}

/** Strip a BOM, drop blank lines, enforce size/row-count bounds, split the header row. */
export function parseCsvBody(csv: string, opts: { maxBytes?: number; maxRows?: number } = {}): ParsedCsv {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const maxRows = opts.maxRows ?? 1000;
  if (Buffer.byteLength(csv, 'utf8') > maxBytes) {
    throw new CsvImportError(`CSV must be ${Math.round(maxBytes / 1_000_000)} MB or smaller`, 413);
  }
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2 || lines.length > maxRows + 1) {
    throw new CsvImportError(`CSV requires a header and 1–${maxRows} rows`, 400);
  }
  const headers = splitCsvLine(lines[0]).map((value) => value.trim());
  const rows = lines.slice(1).map((line) => splitCsvLine(line));
  return { headers, rows };
}

/** Throws unless every required column is present in the parsed header. */
export function assertHeaders(headers: string[], required: string[]): void {
  if (required.some((name) => !headers.includes(name))) {
    throw new CsvImportError(`Required columns: ${required.join(', ')}`, 400);
  }
}

/**
 * Every creativeId in the batch must be owned by userId, or the whole import
 * is rejected — one bad row invalidates the batch rather than silently
 * skipping it. Returns each owned creative's campaignId, since every import
 * route needs it afterward to call recomputeCampaignPerformance.
 */
export async function ownedCreativeCampaigns(userId: string, creativeIds: string[]): Promise<Map<string, string>> {
  const owned = await prisma.adCreative.findMany({
    where: { userId, id: { in: creativeIds } },
    select: { id: true, campaignId: true },
  });
  if (owned.length !== creativeIds.length) {
    throw new CsvImportError('One or more creatives are invalid or not owned by this account', 403);
  }
  return new Map(owned.map((c) => [c.id, c.campaignId]));
}
