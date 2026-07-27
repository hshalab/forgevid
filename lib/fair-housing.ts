/**
 * Fair Housing advertising-language check for real-estate listing copy.
 *
 * The Fair Housing Act (and most state real-estate advertising rules) bars ads
 * that state a preference, limitation, or discrimination based on race,
 * color, religion, sex, familial status, national origin, or disability.
 * HUD's own advertising guidance flags certain phrases as red flags even when
 * an agent didn't intend them that way ("no children", "walking distance to
 * church", "empty-nesters"). Because an agent's own free-text `highlights`
 * feed straight into the GPT narration prompt (see listingPrompt in
 * listing-brief.ts), a risky phrase in the input can come straight out in the
 * voiceover.
 *
 * This is a HEURISTIC flag surfaced in the listing preview for the agent to
 * review before approving generation — it is not a legal compliance
 * guarantee (see legal/terms-of-service.md 6.3) and never blocks generation
 * on its own; the agent remains responsible for what their ad claims.
 *
 * Relative imports only — reachable from the worker process.
 */

export type FairHousingCategory =
  | 'familial_status'
  | 'religion'
  | 'national_origin_or_race'
  | 'disability'
  | 'sex'
  | 'source_of_income';

export interface FairHousingFlag {
  /** The exact text that tripped the rule, for the agent to locate and review. */
  phrase: string;
  category: FairHousingCategory;
  reason: string;
}

interface Rule {
  pattern: RegExp;
  category: FairHousingCategory;
  reason: string;
}

const RULES: Rule[] = [
  { pattern: /\bno (?:kids|children)\b/i, category: 'familial_status', reason: 'Excludes families with children' },
  { pattern: /\badults?[- ]only\b/i, category: 'familial_status', reason: 'Excludes families with children' },
  { pattern: /\bempty[- ]nesters?\b/i, category: 'familial_status', reason: 'Signals a preference against families with children' },
  { pattern: /\bsingles?[- ]only\b/i, category: 'familial_status', reason: 'Signals a preference against families' },
  { pattern: /\bideal for (?:a )?(?:family|families)\b/i, category: 'familial_status', reason: 'Stating a preference FOR families can also read as exclusionary of non-families' },
  { pattern: /\bmother[- ]in[- ]law( suite| unit)?\b/i, category: 'familial_status', reason: 'Implies a family-structure preference; consider "accessory suite" instead' },
  { pattern: /\bbachelor(?:'s)? pad\b/i, category: 'sex', reason: 'Signals a preference by sex' },
  { pattern: /\bwalking distance to (?:a |the )?(?:church|synagogue|temple|mosque)\b/i, category: 'religion', reason: 'References a specific religious institution' },
  { pattern: /\b(?:christian|catholic|jewish|muslim)[- ]friendly\b/i, category: 'religion', reason: 'References religion' },
  { pattern: /\b(?:no|not accepting|does not accept) section[- ]?8\b/i, category: 'source_of_income', reason: 'Refuses a housing-voucher source of income — restricted or banned outright in many states and cities' },
  { pattern: /\bable[- ]bodied\b/i, category: 'disability', reason: 'Signals a preference by ability' },
  { pattern: /\bno wheelchairs?\b/i, category: 'disability', reason: 'Excludes people who use a wheelchair' },
  { pattern: /\bexclusive (?:neighborhood|community)\b/i, category: 'national_origin_or_race', reason: 'Coded exclusionary language flagged by HUD advertising guidance' },
  { pattern: /\bno (?:section[- ]?8|vouchers?)\b/i, category: 'source_of_income', reason: 'Refuses a housing-voucher source of income' },
];

/** Scan free text (typically a listing's `highlights`) for Fair Housing risk phrases. */
export function checkFairHousing(text: string | undefined | null): FairHousingFlag[] {
  if (!text) return [];
  const flags: FairHousingFlag[] = [];
  for (const rule of RULES) {
    const match = text.match(rule.pattern);
    if (match) flags.push({ phrase: match[0], category: rule.category, reason: rule.reason });
  }
  return flags;
}
