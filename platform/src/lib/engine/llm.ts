// LLM adapter. Provider order (resolved per call by defaultLLM()):
//   1. Anthropic Messages API (ANTHROPIC_API_KEY; model ANTHROPIC_MODEL, default claude-haiku-4-5) - the default.
//   2. OpenAI Chat Completions (OPENAI_API_KEY, OPENAI_MODEL) - legacy, only when no Anthropic key (or AI_PROVIDER=openai).
//   3. Deterministic offline fallback (no key, or the API failed): extractive answer from the best chunk, else [HANDOFF].
// Plain fetch (the official @anthropic-ai/sdk is not a dependency of this project). Never logs prompts, replies or keys:
// status codes / error classes only.
import type { Chunk } from "../types";
import type { Lang } from "./lang";
import { HANDOFF_TOKEN } from "./prompt";
import { tokenize } from "./retrieve";

export interface LLMRequest {
  /** Full system prompt (stable rules + sources). */
  system: string;
  /** Optional split of `system` for prompt caching: system === `${stable}\n${dynamic}`. */
  systemParts?: { stable: string; dynamic: string };
  user: string;
  /** Raw (redacted) customer question, used only by the offline fallback. */
  question: string;
  sources: Chunk[];
  lang: Lang;
}
export interface LLMUsage { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }
export interface LLMResult { text: string; usage: LLMUsage; model: string }
/** Providers return LLMResult. A bare string (test fakes) is accepted and treated as a call with unknown usage. */
export type LLM = (req: LLMRequest) => Promise<LLMResult | string>;

export const OFFLINE_MODEL = "offline";
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2026-10-21";
/** Replies are capped at ~700 chars (validate.ts MAX_REPLY_CHARS) ~ 200-250 tokens; leave headroom. */
export const MAX_OUTPUT_TOKENS = 400;
export const LLM_TIMEOUT_MS = 15_000;
const zero = (): LLMUsage => ({ inputTokens: 0, outputTokens: 0 });

export function normalizeLLMResult(out: LLMResult | string): LLMResult {
  return typeof out === "string" ? { text: out, usage: zero(), model: "unknown" } : out;
}

/** Total prompt tokens of a call (uncached + cache writes + cache reads): what the monthly cap counts as input. */
export function totalInputTokens(u: LLMUsage): number {
  return (u.inputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0);
}

/** Deterministic extractive answer: best 1-2 sentences of the top chunk that overlap the question, else [HANDOFF]. */
export function offlineAnswer(req: Pick<LLMRequest, "question" | "sources">): string {
  const top = req.sources[0];
  if (!top) return HANDOFF_TOKEN;
  const q = new Set(tokenize(req.question));
  const sentences = top.text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 3);
  const scored = sentences.map((s, i) => ({ s, i, score: tokenize(s).filter((t) => q.has(t)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 2)
    .sort((a, b) => a.i - b.i);
  if (!scored.length) return HANDOFF_TOKEN;
  const words = scored.map((x) => x.s).join(" ").split(/\s+/);
  return words.slice(0, 80).join(" ") + (words.length > 80 ? "…" : "");
}

/** The deterministic fallback as an LLM (costs nothing, never metered). */
export const offlineLLM = async (req: LLMRequest): Promise<LLMResult> =>
  ({ text: offlineAnswer(req), usage: zero(), model: OFFLINE_MODEL });

// ---------------- shared HTTP helper (deadline + one retry) ----------------
export class LLMHttpError extends Error {
  constructor(public status: number, public retryAfterMs: number | null, label: string) { super(`${label} ${status}`); this.name = "LLMHttpError"; }
}
/** 429 rate limit, 5xx, 529 overloaded and network errors are retried; 4xx (bad request, auth, billing) are not. */
const isRetryable = (e: unknown) =>
  e instanceof LLMHttpError ? e.status === 429 || e.status >= 500 : !(e instanceof SyntaxError);

export interface HttpOpts { timeoutMs?: number; retryDelayMs?: number; sleep?: (ms: number) => Promise<void> }
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** POST JSON with an overall deadline (default 15 s) and at most ONE retry, honoring `retry-after` (capped at 3 s). */
async function postJson(label: string, url: string, headers: Record<string, string>, body: unknown, o: HttpOpts): Promise<unknown> {
  const deadline = Date.now() + (o.timeoutMs ?? LLM_TIMEOUT_MS);
  const sleep = o.sleep ?? realSleep;
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(1, deadline - Date.now()));
    try {
      const res = await fetch(url, { method: "POST", signal: ctrl.signal, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
      if (!res.ok) {
        const ra = Number(res.headers.get("retry-after"));
        throw new LLMHttpError(res.status, Number.isFinite(ra) && ra > 0 ? ra * 1000 : null, label);
      }
      return await res.json();
    } catch (e) {
      const timedOut = ctrl.signal.aborted;
      const wait = Math.min(e instanceof LLMHttpError && e.retryAfterMs !== null ? e.retryAfterMs : (o.retryDelayMs ?? 800), 3000);
      if (attempt >= 1 || timedOut || !isRetryable(e) || deadline - Date.now() <= wait + 500) throw e;
      await sleep(wait);
    } finally {
      clearTimeout(timer);
    }
  }
}

function warnFallback(provider: string, e: unknown) {
  // Never log the request or response body (customer text) nor headers (API key). Status / error class only.
  const why = e instanceof LLMHttpError ? `status ${e.status}` : e instanceof Error ? e.name : "error";
  console.warn(`[engine] ${provider} unavailable (${why}), using offline fallback`);
}

// ---------------- Anthropic ----------------
interface AnthropicResponse {
  model?: string;
  stop_reason?: string;
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

/**
 * Request body for POST /v1/messages (exported for tests). The stable part of the system prompt (rules, tone, brand
 * rules: identical for every question of a tenant) carries the cache breakpoint; the per-question sources follow it.
 */
export function anthropicBody(model: string, req: LLMRequest) {
  const system = req.systemParts
    ? [
        { type: "text", text: req.systemParts.stable, cache_control: { type: "ephemeral" } },
        { type: "text", text: req.systemParts.dynamic },
      ]
    : [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }];
  return {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages: [{ role: "user", content: req.user }],
    // Haiku 5.x runs adaptive thinking by default; short support replies do not need it (it would eat max_tokens).
    ...(/^claude-haiku-5/.test(model) ? { thinking: { type: "disabled" } } : {}),
  };
}

export function parseAnthropic(data: unknown, requested: string): LLMResult {
  const d = (data ?? {}) as AnthropicResponse;
  const u = d.usage ?? {};
  const usage: LLMUsage = {
    inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
  const model = d.model || requested;
  // A safety refusal is billed but its text must never reach the customer: hand off to a person.
  if (d.stop_reason === "refusal") return { text: HANDOFF_TOKEN, usage, model };
  const text = (d.content ?? []).filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("").trim();
  return { text, usage, model };
}

export function anthropicLLM(apiKey: string, model = DEFAULT_ANTHROPIC_MODEL, o: HttpOpts = {}): LLM {
  return async (req) => {
    try {
      const data = await postJson("anthropic", ANTHROPIC_URL, { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION }, anthropicBody(model, req), o);
      const r = parseAnthropic(data, model);
      // Empty text but tokens billed: keep the usage (it is metered), answer deterministically.
      return r.text ? r : { ...r, text: offlineAnswer(req) };
    } catch (e) {
      warnFallback("anthropic", e);
      return offlineLLM(req);
    }
  };
}

// ---------------- OpenAI (legacy, optional) ----------------
interface OpenAiResponse {
  model?: string;
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

export function openAiLLM(apiKey: string, model = DEFAULT_OPENAI_MODEL, o: HttpOpts = {}): LLM {
  return async (req) => {
    try {
      const data = (await postJson("openai", "https://api.openai.com/v1/chat/completions", { authorization: `Bearer ${apiKey}` }, {
        model, temperature: 0.2, max_tokens: MAX_OUTPUT_TOKENS,
        messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
      }, o)) as OpenAiResponse;
      const u = data?.usage ?? {};
      const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
      // OpenAI's prompt_tokens includes the cached ones: split them so totalInputTokens() does not count them twice.
      const usage: LLMUsage = { inputTokens: Math.max(0, (u.prompt_tokens ?? 0) - cached), outputTokens: u.completion_tokens ?? 0, cacheReadTokens: cached };
      const text = data?.choices?.[0]?.message?.content?.trim() ?? "";
      return { text: text || offlineAnswer(req), usage, model: data?.model || model };
    } catch (e) {
      warnFallback("openai", e);
      return offlineLLM(req);
    }
  };
}

// ---------------- selection ----------------
export type Provider = "anthropic" | "openai" | "offline";

/**
 * AI_PROVIDER ('anthropic' | 'openai') picks a provider when that provider's key is set. Otherwise Anthropic when
 * ANTHROPIC_API_KEY is set, then OpenAI when OPENAI_API_KEY is set, else the offline fallback.
 */
export function selectProvider(env: Record<string, string | undefined> = process.env): { provider: Provider; key: string; model: string } {
  const anthropic = env.ANTHROPIC_API_KEY?.trim() ?? "";
  const openai = env.OPENAI_API_KEY?.trim() ?? "";
  const pref = env.AI_PROVIDER?.trim().toLowerCase();
  const a = { provider: "anthropic" as const, key: anthropic, model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL };
  const o = { provider: "openai" as const, key: openai, model: env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL };
  if (pref === "openai" && openai) return o;
  if (anthropic) return a;
  if (openai) return o;
  return { provider: "offline", key: "", model: OFFLINE_MODEL };
}

/** Resolved at call time so env changes (tests, setup) are honored. */
export function defaultLLM(): LLM {
  const s = selectProvider();
  if (s.provider === "anthropic") return anthropicLLM(s.key, s.model);
  if (s.provider === "openai") return openAiLLM(s.key, s.model);
  return offlineLLM;
}
