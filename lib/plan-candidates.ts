/**
 * Multi-candidate storyboard generation — the "generate several candidate
 * plans, auto-score, render the strongest" loop from the controlled
 * learning system. Candidates are PLANS, not renders: each one costs LLM
 * tokens only (planScenes), so best-of-N is cheap; only the winner goes
 * through TTS + stock search + ffmpeg.
 *
 * Scoring is deterministic and explainable (rules-first, like
 * lib/inventory.ts and lib/provider-router.ts) — no trained ranker until
 * the evaluations this module feeds have accumulated real evidence. Every
 * candidate's score breakdown is recorded so a future ranker has labeled
 * data to learn from.
 *
 * Relative imports only — reachable from the worker process.
 */
import { planScenes } from './video-generator';
import type { NarrationLanguage, PlannedScene } from './video-generator';
import { spokenLine } from './video-generator';

/** Words-per-second of typical TTS narration — used to estimate speech time. */
const NARRATION_WPS = 2.5;

/** Camera grammar / prose words that make a stock-footage query WORSE. */
const BAD_QUERY_WORDS = new Set([
  'close-up', 'closeup', 'shot', 'scene', 'view', 'angle', 'pan', 'zoom',
  'camera', 'footage', 'beautiful', 'stunning', 'amazing', 'showing',
]);

export interface CandidateScore {
  total: number;
  durationFit: number;
  queryQuality: number;
  queryVariety: number;
  factCoverage: number;
  sceneCountSanity: number;
}

export interface ScoredCandidate {
  scenes: PlannedScene[];
  score: CandidateScore;
}

export interface PlanCandidatesResult {
  winner: PlannedScene[];
  selectedIndex: number;
  /** Compact per-candidate summary for metadata/evaluations — never the full scenes. */
  summary: Array<{ index: number; sceneCount: number; score: CandidateScore; selected: boolean }>;
}

function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[, ]/g, ''));
}

/** Deterministic, explainable plan scoring — each dimension 0-100. */
export function scorePlan(scenes: PlannedScene[], prompt: string, requestedDuration: number): CandidateScore {
  const lines = scenes.map((scene) => spokenLine(scene));

  // 1. Duration fit: estimated speech time vs the requested duration.
  const words = lines.join(' ').split(/\s+/).filter(Boolean).length;
  const speechSeconds = words / NARRATION_WPS;
  const ratio = requestedDuration > 0 ? speechSeconds / requestedDuration : 1;
  const durationFit = Math.max(0, 100 - Math.abs(1 - ratio) * 100);

  // 2. Query quality: concrete 2-4 word noun queries beat prose and camera grammar.
  const queryScores = scenes.map((scene) => {
    const queryWords = (scene.searchQuery ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (queryWords.length === 0) return 0;
    let score = 100;
    if (queryWords.length > 5) score -= (queryWords.length - 5) * 15;
    if (queryWords.length < 2) score -= 30;
    score -= queryWords.filter((word) => BAD_QUERY_WORDS.has(word)).length * 25;
    return Math.max(0, score);
  });
  const queryQuality = queryScores.length
    ? queryScores.reduce((sum, value) => sum + value, 0) / queryScores.length
    : 0;

  // 3. Query variety: near-duplicate queries produce near-duplicate footage.
  const distinct = new Set(scenes.map((scene) => (scene.searchQuery ?? '').toLowerCase().trim())).size;
  const queryVariety = scenes.length ? (distinct / scenes.length) * 100 : 0;

  // 4. Fact coverage: numbers in the prompt (a price, a mileage) that made
  // it into the narration — the same facts-only priority the fact-check
  // guards after the render.
  const promptNumbers = numbersIn(prompt);
  const narrationNumbers = new Set(numbersIn(lines.join(' ')));
  const factCoverage = promptNumbers.length
    ? (promptNumbers.filter((n) => narrationNumbers.has(n)).length / promptNumbers.length) * 100
    : 100;

  // 5. Scene-count sanity: ~5s/scene is the sweet spot this pipeline renders best.
  const ideal = Math.max(2, Math.round(requestedDuration / 5));
  const sceneCountSanity = Math.max(0, 100 - Math.abs(scenes.length - ideal) * 20);

  const total =
    durationFit * 0.3 + queryQuality * 0.25 + queryVariety * 0.15 + factCoverage * 0.2 + sceneCountSanity * 0.1;

  return {
    total: Number(total.toFixed(1)),
    durationFit: Number(durationFit.toFixed(1)),
    queryQuality: Number(queryQuality.toFixed(1)),
    queryVariety: Number(queryVariety.toFixed(1)),
    factCoverage: Number(factCoverage.toFixed(1)),
    sceneCountSanity: Number(sceneCountSanity.toFixed(1)),
  };
}

/**
 * Plan N candidate storyboards and pick the best. Fails soft: if any
 * individual plan call throws, the surviving candidates compete; if ALL
 * fail, the error surfaces (same visibility as a single planScenes
 * failure). Note planScenes itself degrades to a heuristic fallback plan
 * rather than throwing when the LLM is down — in that case the candidates
 * are near-identical and scoring just picks the first, which is exactly
 * the single-plan behavior.
 */
export async function planSceneCandidates(
  script: string,
  duration: number,
  language: NarrationLanguage,
  count: number,
  prompt: string,
): Promise<PlanCandidatesResult> {
  const n = Math.max(2, Math.min(3, count));
  const settled = await Promise.allSettled(
    Array.from({ length: n }, () => planScenes(script, duration, language)),
  );
  const candidates: ScoredCandidate[] = settled
    .filter((result): result is PromiseFulfilledResult<PlannedScene[]> => result.status === 'fulfilled')
    .map((result) => result.value)
    .filter((scenes) => scenes.length > 0)
    .map((scenes) => ({ scenes, score: scorePlan(scenes, prompt, duration) }));

  if (candidates.length === 0) {
    const firstError = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    throw firstError?.reason instanceof Error
      ? firstError.reason
      : new Error('Failed to plan any candidate storyboards');
  }

  let selectedIndex = 0;
  candidates.forEach((candidate, i) => {
    if (candidate.score.total > candidates[selectedIndex].score.total) selectedIndex = i;
  });

  return {
    winner: candidates[selectedIndex].scenes,
    selectedIndex,
    summary: candidates.map((candidate, i) => ({
      index: i,
      sceneCount: candidate.scenes.length,
      score: candidate.score,
      selected: i === selectedIndex,
    })),
  };
}
