/**
 * Narration proofread pass — orthography only, applied before TTS so a
 * misspelled word is never SPOKEN or burned into captions. Spanish is the
 * priority (missing accents and anglicized spellings are the recurring
 * failure: "vehiculo"→"vehículo", "financiacion"→"financiación"), but the
 * pass runs for every language on the generation path.
 *
 * Hard rules, enforced in code not just the prompt:
 *  - corrections may fix SPELLING/ACCENTS/ORTHOGRAPHY only — a reply that
 *    changes wording still gets through only line-by-line, and any line
 *    that drops or alters a NUMBER (a price, a mileage) reverts to the
 *    original (same facts-only guard as lib/localize.ts);
 *  - line-count mismatch → originals unchanged;
 *  - any LLM failure → originals unchanged (never block a render on the
 *    proofreader).
 *
 * Relative imports only — reachable from the worker process.
 */
import { llm, llmModel, hasLlmKey } from './ai/llm';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  pt: 'Portuguese',
  fr: 'French',
  de: 'German',
  it: 'Italian',
};

function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[, ]/g, ''));
}

function preservesNumbers(original: string, corrected: string): boolean {
  const originalNums = numbersIn(original);
  if (originalNums.length === 0) return true;
  const correctedNums = new Set(numbersIn(corrected));
  return originalNums.every((n) => correctedNums.has(n));
}

/**
 * Proofread narration lines in `language`. Returns corrected lines
 * one-to-one with the input; every guard failure returns the original line.
 */
export async function proofreadLines(lines: string[], language: string): Promise<string[]> {
  if (lines.length === 0 || !hasLlmKey()) return lines;
  const languageName = LANGUAGE_NAMES[language] ?? language;
  const numbered = lines.map((line, i) => `${i + 1}. ${line}`).join('\n');

  try {
    const response = await llm.chat.completions.create({
      model: llmModel(),
      messages: [
        {
          role: 'system',
          content:
            `You are a strict ${languageName} proofreader for spoken video narration. Correct ONLY ` +
            `spelling, accents/diacritics, and orthography. NEVER rephrase, reorder, translate, or ` +
            `change any number, price, or brand name. If a line is already correct, return it ` +
            `unchanged. Reply with ONLY the lines, one per line, in the SAME numbered order.`,
        },
        { role: 'user', content: numbered },
      ],
      max_tokens: 2048,
      temperature: 0,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? '';
    const corrected = raw
      .split('\n')
      .map((line) => line.replace(/^\s*\d+[.)]\s*/, '').trim())
      .filter(Boolean);

    if (corrected.length !== lines.length) {
      console.warn(
        `[Proofread] returned ${corrected.length} lines for ${lines.length} — keeping originals`,
      );
      return lines;
    }

    return lines.map((original, i) =>
      preservesNumbers(original, corrected[i]) ? corrected[i] : original,
    );
  } catch (error) {
    console.warn('[Proofread] failed (keeping original narration):', error);
    return lines;
  }
}
