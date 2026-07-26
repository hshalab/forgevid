/**
 * Provider-agnostic text-LLM client — OpenAI or Google Gemini.
 *
 * Gemini exposes an OpenAI-COMPATIBLE endpoint, so every existing call site
 * keeps using the OpenAI SDK unchanged; only the client's baseURL/key and the
 * model name switch. Selection:
 *
 *   LLM_PROVIDER=gemini | openai   — explicit choice (needs that provider's key)
 *   (unset)                        — auto: OpenAI if OPENAI_API_KEY, else Gemini
 *
 * Keys: OPENAI_API_KEY (or legacy OPENAI_SECRET_KEY) / GEMINI_API_KEY (or
 * GOOGLE_API_KEY). Model overrides: GEMINI_MODEL, GEMINI_FAST_MODEL.
 *
 * Scope: TEXT completions only. Whisper transcription, DALL-E images and the
 * moderation endpoint have no Gemini equivalent on the compat layer and stay on
 * OpenAI (their call sites keep using openAiApiKey() directly).
 */
import OpenAI from 'openai';
import { openAiApiKey } from '../openai-key';
import { lazyClient } from '../lazy-client';
import { withProviderReliability } from '../provider-reliability';

export type LlmProvider = 'openai' | 'gemini';

export function geminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || undefined;
}

export function llmProvider(): LlmProvider {
  const forced = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (forced === 'gemini' && geminiApiKey()) return 'gemini';
  if (forced === 'openai' && openAiApiKey()) return 'openai';
  // Auto-detect: keep the historical default (OpenAI) when both are set.
  if (openAiApiKey()) return 'openai';
  if (geminiApiKey()) return 'gemini';
  return 'openai';
}

/** Is ANY text-LLM provider configured? (Gates that used hasOpenAiKey().) */
export function hasLlmKey(): boolean {
  return Boolean(openAiApiKey() || geminiApiKey());
}

/**
 * Overridable so Gemini can be served from Vertex AI (a Google Cloud product)
 * instead of the AI Studio endpoint by setting GEMINI_BASE_URL in the
 * environment — no code change needed. Default stays AI Studio's compat layer.
 */
const GEMINI_BASE_URL =
  process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/';

/** Construct a fresh client for the active provider (rarely needed directly). */
export function createLlmClient(): OpenAI {
  const client = llmProvider() === 'gemini'
    ? new OpenAI({ apiKey: geminiApiKey(), baseURL: GEMINI_BASE_URL })
    : new OpenAI({ apiKey: openAiApiKey() });
  const originalCreate = client.chat.completions.create.bind(client.chat.completions);
  client.chat.completions.create = ((...args: Parameters<typeof originalCreate>) =>
    withProviderReliability('llm', () => originalCreate(...args))) as typeof client.chat.completions.create;
  return client;
}

/** Shared lazy client — import this instead of constructing new OpenAI(...). */
export const llm = lazyClient<OpenAI>(createLlmClient);

/**
 * The model name for the active provider. 'standard' replaces gpt-4-class
 * calls; 'fast' replaces gpt-4o-mini / gpt-3.5-turbo-class calls.
 *
 * Gemini default is the `gemini-flash-latest` ALIAS, not a pinned version:
 * Google retires numbered models for new API keys (gemini-2.5-flash 404s with
 * "no longer available to new users"), and the alias always resolves to the
 * current stable Flash. Pin via GEMINI_MODEL / GEMINI_FAST_MODEL if needed.
 * Names are normalised to the canonical `models/…` resource form.
 */
/**
 * Extract the JSON payload from an LLM reply. Gemini (and occasionally GPT)
 * wraps JSON in ```json fences or adds prose around it even when asked not to —
 * strict JSON.parse on the raw content then fails. Strips fences and slices the
 * outermost {...} or [...] span; returns the input unchanged when no braces are
 * found so the caller's own parse error still surfaces.
 */
export function extractJson(raw: string): string {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const objStart = cleaned.indexOf('{');
  const arrStart = cleaned.indexOf('[');
  const start = objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart);
  if (start === -1) return cleaned;
  const end = cleaned[start] === '{' ? cleaned.lastIndexOf('}') : cleaned.lastIndexOf(']');
  return end > start ? cleaned.slice(start, end + 1) : cleaned;
}

export function llmModel(tier: 'standard' | 'fast' = 'standard'): string {
  if (llmProvider() === 'gemini') {
    const name =
      (tier === 'fast'
        ? process.env.GEMINI_FAST_MODEL || process.env.GEMINI_MODEL
        : process.env.GEMINI_MODEL) || 'gemini-flash-latest';
    return name.startsWith('models/') ? name : `models/${name}`;
  }
  return tier === 'fast' ? 'gpt-4o-mini' : 'gpt-4';
}
