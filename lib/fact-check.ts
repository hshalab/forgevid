/**
 * Post-hoc hallucination check: does the generated narration state a number
 * the source prompt never gave it? vehiclePrompt/listingPrompt (and every
 * other "facts-only" prompt in this codebase) already instruct GPT to never
 * invent a price, mileage, or count — this catches it when the model does
 * anyway, by comparing every number spoken in the finished narration against
 * every number that appeared in the prompt that generated it.
 *
 * Advisory only: flags for review, never blocks a render (see
 * legal/terms-of-service.md 6.3 — "our facts-only safeguards are
 * conveniences, not a warranty of accuracy"). False positives are expected
 * and fine here — a restated scene count, a duration mentioned in passing —
 * this is a signal for a human to glance at, not a gate to fail on.
 *
 * Relative imports only — reachable from the worker process.
 */

function normalizeNumber(raw: string): string {
  return raw.replace(/[, ]/g, '').replace(/\.00?$/, '');
}

/**
 * Every distinct numeric token in `text`, comma/decimal-normalized.
 *
 * The decimal part requires at least one digit after the dot — otherwise a
 * sentence-ending period right after a number ("...$685,000. There are...")
 * gets swallowed into the match and "685000" vs "685000." would wrongly
 * count as two different numbers.
 */
export function extractNumbers(text: string): string[] {
  return [...(text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [])]
    .map(normalizeNumber)
    .filter((n) => n.length > 0);
}

export interface FactCheckResult {
  flagged: boolean;
  /** Numbers the narration states that never appeared in the source prompt. */
  unsourcedNumbers: string[];
}

/** Check a finished narration's numbers against the prompt that produced it. */
export function checkNarrationFacts(narrationLines: string[], sourcePrompt: string): FactCheckResult {
  const sourceNumbers = new Set(extractNumbers(sourcePrompt));
  const narrationNumbers = extractNumbers(narrationLines.join(' '));
  const unsourcedNumbers = [...new Set(narrationNumbers.filter((n) => !sourceNumbers.has(n)))];
  return { flagged: unsourcedNumbers.length > 0, unsourcedNumbers };
}
