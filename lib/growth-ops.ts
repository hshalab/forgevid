/**
 * Daily growth-ops selection logic — the pure half of
 * scripts/growth-daily.ts (which renders samples and emails the digest).
 *
 * Reads the outbound trackers (outbound/*.csv — gitignored prospect data;
 * this module only ever sees their CONTENT at runtime, never ships it) and
 * decides two things:
 *   1. pickDailyBatch — which accounts get a personalized sample today
 *      (file order IS priority order: the trackers are hand-sorted with
 *      HIGH VALUE rows on top and OVERSIZE at the bottom).
 *   2. followUpsDue — which already-sampled accounts are due a D+2 / D+5 /
 *      D+10 touch, with a ready-to-send message per stage and language.
 *
 * COMPLIANCE: nothing in this module (or its consumers) contacts a
 * prospect. Everything is assembled for the OPERATOR's inbox; a human
 * sends every message — same guarantee the no-autonomous-outreach test
 * enforces repo-wide.
 */

export type Vertical = 'auto' | 'realestate' | 'ecom';

export interface TrackerRow {
  status: string;
  name: string;
  website: string;
  city: string;
  metro: string;
  phone: string;
  contactName: string;
  email: string;
  instagram: string;
  whatsapp: string;
  language: string;
  sampleSent: string;
  sampleDate: string;
  response: string;
  notes: string;
}

/** Split one CSV line respecting double-quoted fields (which contain commas). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Parse a tracker CSV (the shared 22-column layout in outbound/PLAYBOOK.md). */
export function parseTracker(content: string): TrackerRow[] {
  const lines = content.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim());
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    return {
      status: (cols[0] ?? '').trim().toUpperCase(),
      name: (cols[1] ?? '').trim(),
      website: (cols[2] ?? '').trim(),
      city: (cols[3] ?? '').trim(),
      metro: (cols[4] ?? '').trim(),
      phone: (cols[5] ?? '').trim(),
      contactName: (cols[7] ?? '').trim(),
      email: (cols[10] ?? '').trim(),
      instagram: (cols[11] ?? '').trim(),
      whatsapp: (cols[12] ?? '').trim(),
      language: (cols[13] ?? '').trim(),
      sampleSent: (cols[14] ?? '').trim(),
      sampleDate: (cols[15] ?? '').trim(),
      response: (cols[16] ?? '').trim(),
      notes: (cols[21] ?? '').trim(),
    };
  });
}

export interface BatchPick {
  vertical: Vertical;
  row: TrackerRow;
}

/**
 * Pick today's sample batch: NEW rows with a website, in file (= priority)
 * order, spread across verticals by `mix`. When a vertical runs short, the
 * remainder backfills from the others in mix order — the daily quota is
 * the commitment, the mix is a preference.
 */
export function pickDailyBatch(
  trackers: Record<Vertical, TrackerRow[]>,
  mix: Record<Vertical, number> = { auto: 6, realestate: 2, ecom: 2 },
): BatchPick[] {
  const eligible: Record<Vertical, TrackerRow[]> = {
    auto: [],
    realestate: [],
    ecom: [],
  };
  (Object.keys(trackers) as Vertical[]).forEach((vertical) => {
    eligible[vertical] = (trackers[vertical] ?? []).filter(
      (row) => row.status === 'NEW' && row.website && !row.sampleSent,
    );
  });

  const picks: BatchPick[] = [];
  const total = Object.values(mix).reduce((sum, n) => sum + n, 0);

  // First pass: honor the mix.
  (Object.keys(mix) as Vertical[]).forEach((vertical) => {
    for (const row of eligible[vertical].splice(0, mix[vertical])) {
      picks.push({ vertical, row });
    }
  });
  // Backfill to the full quota from whatever remains, mix order.
  for (const vertical of Object.keys(mix) as Vertical[]) {
    while (picks.length < total && eligible[vertical].length) {
      picks.push({ vertical, row: eligible[vertical].shift()! });
    }
  }
  return picks;
}

/**
 * Bay Area detection across the trackers' inconsistent metro values
 * ("Bay Area", "San Francisco Bay Area CA", city names). Substring match,
 * lowercase — a new tracker source shouldn't silently fall out of the
 * operator's home-turf half of the daily batch.
 */
const BAY_AREA_MARKERS = [
  'bay area', 'san jose', 'san francisco', 'oakland', 'hayward', 'fremont',
  'richmond', 'concord', 'redwood city', 'santa clara', 'union city',
  'daly city', 'san pablo', 'east bay', 'peninsula',
];

export function isBayAreaMetro(metro: string): boolean {
  const value = metro.toLowerCase();
  return BAY_AREA_MARKERS.some((marker) => value.includes(marker));
}

/** Split every tracker's rows into Bay Area vs everywhere else. */
export function splitByMetro(trackers: Record<Vertical, TrackerRow[]>): {
  bay: Record<Vertical, TrackerRow[]>;
  rest: Record<Vertical, TrackerRow[]>;
} {
  const bay = { auto: [], realestate: [], ecom: [] } as Record<Vertical, TrackerRow[]>;
  const rest = { auto: [], realestate: [], ecom: [] } as Record<Vertical, TrackerRow[]>;
  (Object.keys(trackers) as Vertical[]).forEach((vertical) => {
    for (const row of trackers[vertical] ?? []) {
      (isBayAreaMetro(row.metro) ? bay : rest)[vertical].push(row);
    }
  });
  return { bay, rest };
}

export type FollowUpStage = 'D+2' | 'D+5' | 'D+10';

export interface FollowUpDue {
  vertical: Vertical;
  row: TrackerRow;
  daysSince: number;
  stage: FollowUpStage;
  message: string;
}

const FOLLOW_UP_TEMPLATES: Record<FollowUpStage, Record<'en' | 'es', (brand: string) => string>> = {
  'D+2': {
    en: (brand) =>
      `Hi again — just making sure the ${brand} video came through. Happy to run a couple more of your listings/vehicles if it's easier to judge with more examples.`,
    es: (brand) =>
      `Hola de nuevo — solo confirmando que le llegó el video de ${brand}. Con gusto le preparo un par más si es más fácil evaluarlo con más ejemplos.`,
  },
  'D+5': {
    en: (brand) =>
      `Quick one — I can set ${brand} up on a $99 pilot: 5 videos of your own inventory, no subscription, done this week. If they don't earn their keep, walk away. Want me to start?`,
    es: (brand) =>
      `Algo rápido — puedo arrancar con ${brand} un piloto de $99: 5 videos de su propio inventario, sin suscripción, listos esta semana. Si no dan resultado, lo deja ahí. ¿Empezamos?`,
  },
  'D+10': {
    en: (brand) =>
      `Last note from me — if video isn't a priority for ${brand} right now, no problem. If you know another dealer/agent who'd want their inventory turned into videos automatically, I'd appreciate the intro.`,
    es: (brand) =>
      `Última nota — si el video no es prioridad para ${brand} ahora, no hay problema. Si conoce a otro negocio que quiera convertir su inventario en videos automáticamente, le agradezco la referencia.`,
  },
};

function stageFor(daysSince: number): FollowUpStage | null {
  if (daysSince >= 10) return 'D+10';
  if (daysSince >= 5) return 'D+5';
  if (daysSince >= 2) return 'D+2';
  return null;
}

/**
 * Accounts sampled but silent, grouped into follow-up stages by days since
 * the sample went out. Excludes anything with a recorded response (those
 * are conversations, not follow-ups) and every terminal status.
 */
export function followUpsDue(
  trackers: Record<Vertical, TrackerRow[]>,
  today: Date,
): FollowUpDue[] {
  const due: FollowUpDue[] = [];
  (Object.keys(trackers) as Vertical[]).forEach((vertical) => {
    for (const row of trackers[vertical] ?? []) {
      if (row.status !== 'SAMPLE_SENT' || row.response) continue;
      if (!row.sampleDate) continue;
      const sent = new Date(row.sampleDate);
      if (Number.isNaN(sent.getTime())) continue;
      const daysSince = Math.floor((today.getTime() - sent.getTime()) / 86_400_000);
      const stage = stageFor(daysSince);
      if (!stage) continue;
      const lang = row.language.toUpperCase() === 'ES' ? 'es' : 'en';
      due.push({
        vertical,
        row,
        daysSince,
        stage,
        message: FOLLOW_UP_TEMPLATES[stage][lang](row.name),
      });
    }
  });
  // Most-overdue first — D+10s are about to go cold.
  return due.sort((a, b) => b.daysSince - a.daysSince);
}
