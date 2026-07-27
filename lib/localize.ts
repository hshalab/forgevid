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
): Promise<string[]> {
  if (lines.length === 0) return [];
  if (!hasLlmKey()) return lines;

  const languageName = NARRATION_LANGUAGE_NAMES[targetLanguage];
  const numbered = lines.map((line, i) => `${i + 1}. ${line}`).join('\n');

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
            `or NeuroHires — keep them exactly as written.`,
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

    if (translated.length !== lines.length) {
      console.error(
        `[Localize] translation returned ${translated.length} lines for ${lines.length} input lines — falling back to originals`,
      );
      return lines;
    }

    return lines.map((original, i) =>
      preservesNumbers(original, translated[i]) ? translated[i] : original,
    );
  } catch (error) {
    console.error('[Localize] translation failed (falling back to original lines):', error);
    return lines;
  }
}

/**
 * Build a preset-scene plan (see GenerationOptions.presetScenes) with
 * translated narration and everything else — keywords, search query,
 * duration, visual elements — carried over unchanged from the source video's
 * persisted scenes, so the new render shares the same visual body and pacing.
 */
export async function localizedPresetScenes(
  scenes: ResolvedScene[],
  targetLanguage: NarrationLanguage,
): Promise<PlannedScene[]> {
  const originalLines = scenes.map((scene) => spokenLine(scene));
  const translatedLines = await translateNarrationLines(originalLines, targetLanguage);

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
