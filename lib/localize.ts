/**
 * Localize an existing video into another language, reusing its scene
 * structure (keywords, search queries, durations) so a batch of language
 * variants match on everything except what's spoken. Stock footage search
 * always stays English regardless of narration language (see
 * NarrationLanguage's own doc comment in video-generator.ts) — translating
 * searchQuery would just return worse-matched clips, not different ones.
 *
 * Every number, price, and this platform's own brand names must survive
 * translation UNCHANGED — a mistranslated price is the same "facts-only"
 * risk this codebase already guards against in listing-brief.ts and
 * vehicle-feed.ts. A scene whose translation drops a number that was
 * actually there falls back to the ORIGINAL line, rather than risk a
 * silently wrong fact reaching a paid customer's ad.
 *
 * Relative imports only — reachable from the worker process.
 */
import { llm, llmModel, hasLlmKey } from './ai/llm';
import { spokenLine } from './video-generator';
import type { NarrationLanguage, PlannedScene, ResolvedScene } from './video-generator';
import { NARRATION_LANGUAGE_NAMES } from './video-generator';
import { approvedTranslation, getLocalizationProfile } from './localization-memory';

export interface LocalizeOptions {
  /**
   * When set, the user's corporate localization layer applies: previously
   * human-approved translations (translation memory) are reused verbatim
   * instead of re-asking the LLM, and the profile's tone/formality/glossary
   * steer whatever still needs translating. Omitted (e.g. in tests or
   * system contexts) → plain stateless translation, exactly as before.
   */
  userId?: string;
  /**
   * The language the SOURCE lines are in — the translation-memory key's
   * first half. Defaults to 'en'; callers localizing an already-localized
   * video should pass its actual language or memory lookups will miss.
   */
  sourceLanguage?: string;
}

function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[, ]/g, ''));
}

/** Every number in `original` must appear, digit-for-digit, in `translated`. */
function preservesNumbers(original: string, translated: string): boolean {
  const originalNums = numbersIn(original);
  if (originalNums.length === 0) return true;
  const translatedNums = new Set(numbersIn(translated));
  return originalNums.every((n) => translatedNums.has(n));
}

/**
 * Translate narration lines into another language, one-to-one and in order.
 * Degrades to the ORIGINAL lines (never blocks, never invents) when no LLM
 * key is configured, the model's reply doesn't parse back to the same line
 * count, or the call fails outright.
 */
export async function translateNarrationLines(
  lines: string[],
  targetLanguage: NarrationLanguage,
  options: LocalizeOptions = {},
): Promise<string[]> {
  if (lines.length === 0) return [];

  // Corporate localization memory: lines a human already approved for this
  // user+language pair are reused verbatim — no LLM call, no drift from the
  // approved wording. Best-effort: a memory lookup failure just means a
  // normal translation.
  const fromMemory = new Map<number, string>();
  let profileDirectives = '';
  if (options.userId) {
    try {
      const sourceLanguage = options.sourceLanguage ?? 'en';
      const [profile, hits] = await Promise.all([
        getLocalizationProfile(options.userId),
        Promise.all(lines.map((line) => approvedTranslation(options.userId!, sourceLanguage, targetLanguage, line))),
      ]);
      hits.forEach((hit, i) => {
        if (hit) fromMemory.set(i, hit);
      });
      const glossaryPairs = Object.entries((profile.glossary as Record<string, string>) ?? {})
        .filter(([term, rendering]) => typeof term === 'string' && typeof rendering === 'string')
        .slice(0, 100);
      profileDirectives =
        ` Use a ${profile.tone} tone with ${profile.formality} formality.` +
        (glossaryPairs.length
          ? ` Always render these terms exactly as specified: ${glossaryPairs
              .map(([term, rendering]) => `"${term}" → "${rendering}"`)
              .join(', ')}.`
          : '');
    } catch (error) {
      console.warn('[Localize] localization profile/memory unavailable (translating without it):', error);
    }
  }
  if (fromMemory.size === lines.length) {
    return lines.map((_, i) => fromMemory.get(i)!);
  }
  if (!hasLlmKey()) return lines.map((line, i) => fromMemory.get(i) ?? line);

  const languageName = NARRATION_LANGUAGE_NAMES[targetLanguage];
  const pending = lines.map((line, i) => ({ line, i })).filter(({ i }) => !fromMemory.has(i));
  const numbered = pending.map(({ line }, n) => `${n + 1}. ${line}`).join('\n');

  try {
    const response = await llm.chat.completions.create({
      model: llmModel(),
      messages: [
        {
          role: 'system',
          content:
            `Translate video narration lines into ${languageName}. Reply with ONLY the ` +
            `translated lines, one per line, in the SAME numbered order — no extra commentary. ` +
            `Keep every number, price, and percentage EXACTLY as written (do not localize digit ` +
            `formats or convert currency). Never translate the brand names ForgeVid, RingYield, ` +
            `or NeuroHires — keep them exactly as written.` +
            profileDirectives,
        },
        { role: 'user', content: numbered },
      ],
      max_tokens: 2048,
      temperature: 0.3,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? '';
    const translated = raw
      .split('\n')
      .map((line) => line.replace(/^\s*\d+[.)]\s*/, '').trim())
      .filter(Boolean);

    if (translated.length !== pending.length) {
      console.error(
        `[Localize] translation returned ${translated.length} lines for ${pending.length} input lines — falling back to originals`,
      );
      return lines.map((line, i) => fromMemory.get(i) ?? line);
    }

    const result = [...lines];
    pending.forEach(({ line, i }, n) => {
      result[i] = preservesNumbers(line, translated[n]) ? translated[n] : line;
    });
    fromMemory.forEach((approved, i) => {
      result[i] = approved;
    });
    return result;
  } catch (error) {
    console.error('[Localize] translation failed (falling back to original lines):', error);
    return lines.map((line, i) => fromMemory.get(i) ?? line);
  }
}

/**
 * Build a preset-scene plan (see GenerationOptions.presetScenes) with
 * translated narration and everything else — keywords, search query,
 * duration, visual elements — carried over unchanged from the source video's
 * persisted scenes, so the new render shares the same visual body and pacing.
 */
export interface BackTranslationLine {
  index: number;
  original: string;
  backTranslated: string;
  /** Word-overlap similarity 0-1 between the original and the round trip. */
  similarity: number;
  flagged: boolean;
}

export interface BackTranslationReport {
  lines: BackTranslationLine[];
  flaggedCount: number;
}

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );
}

/** Jaccard similarity over content words — deterministic, explainable. */
export function lineSimilarity(a: string, b: string): number {
  const setA = wordSet(a);
  const setB = wordSet(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  setA.forEach((word) => {
    if (setB.has(word)) overlap += 1;
  });
  return overlap / (setA.size + setB.size - overlap);
}

/**
 * Back-translation verification: translate the TRANSLATED lines back to
 * English and compare each round trip against its original with a
 * deterministic word-overlap score. A low-similarity line means the
 * translation may have drifted in meaning — surfaced to the human
 * reviewer, never auto-corrected. Fail-open: any LLM failure returns null
 * (the review still happens; it just lacks this report).
 */
export async function backTranslationReport(
  originalLines: string[],
  translatedLines: string[],
  targetLanguage: NarrationLanguage,
): Promise<BackTranslationReport | null> {
  if (!hasLlmKey() || originalLines.length === 0) return null;
  if (originalLines.length !== translatedLines.length) return null;
  try {
    const numbered = translatedLines.map((line, i) => `${i + 1}. ${line}`).join('\n');
    const response = await llm.chat.completions.create({
      model: llmModel(),
      messages: [
        {
          role: 'system',
          content:
            `Translate these ${NARRATION_LANGUAGE_NAMES[targetLanguage]} lines into English, literally and faithfully. ` +
            `Reply with ONLY the translated lines, one per line, in the SAME numbered order.`,
        },
        { role: 'user', content: numbered },
      ],
      max_tokens: 2048,
      temperature: 0,
    });
    const raw = response.choices[0]?.message?.content?.trim() ?? '';
    const backLines = raw
      .split('\n')
      .map((line) => line.replace(/^\s*\d+[.)]\s*/, '').trim())
      .filter(Boolean);
    if (backLines.length !== originalLines.length) return null;

    const lines = originalLines.map((original, index) => {
      const similarity = lineSimilarity(original, backLines[index]);
      return {
        index,
        original,
        backTranslated: backLines[index],
        similarity: Number(similarity.toFixed(2)),
        flagged: similarity < 0.3,
      };
    });
    return { lines, flaggedCount: lines.filter((line) => line.flagged).length };
  } catch (error) {
    console.warn('[Localize] back-translation failed (review proceeds without it):', error);
    return null;
  }
}

export async function localizedPresetScenes(
  scenes: ResolvedScene[],
  targetLanguage: NarrationLanguage,
  options: LocalizeOptions = {},
): Promise<PlannedScene[]> {
  const originalLines = scenes.map((scene) => spokenLine(scene));
  const translatedLines = await translateNarrationLines(originalLines, targetLanguage, options);

  return scenes.map((scene, i) => ({
    id: scene.id,
    index: scene.index,
    description: scene.description,
    narration: translatedLines[i],
    searchQuery: scene.searchQuery,
    keywords: scene.keywords,
    duration: scene.duration,
    visualElements: scene.visualElements,
  }));
}
