// LLM adapter. Provider order (resolved per call by defaultLLM()):
//   1. Anthropic Messages API through the official SDK (@anthropic-ai/sdk). ANTHROPIC_API_KEY; model ANTHROPIC_MODEL,
//      default claude-haiku-5-5. The default provider.
//   2. OpenAI Chat Completions (OPENAI_API_KEY, OPENAI_MODEL): legacy, only when no Anthropic key (or AI_PROVIDER=openai).
//   3. Deterministic offline fallback (no key, or the API failed): extractive answer from the best chunk, else [HANDOFF].
// Never logs prompts, replies or keys: status codes / error classes only (the SDK's own logger is turned off).
import Anthropic from "@anthropic-ai/sdk";
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
/** Current Haiku (claude-api skill, model table). Override with ANTHROPIC_MODEL. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
/**
 * Output cap for models WITHOUT thinking (Haiku 4.5, OpenAI). Replies are capped at ~700 chars (validate.ts
 * MAX_REPLY_CHARS) ~ 200-250 tokens; leave headroom.
 */
export const MAX_OUTPUT_TOKENS = 400;
/**
 * Output cap for models whose adaptive thinking is on by default (Haiku 5.5 and the 5.x family): thinking counts
 * toward max_tokens, so leave room for it plus the short answer (skill: "short-output route ... max_tokens 1024").
 */
export const MAX_OUTPUT_TOKENS_THINKING = 1024;
/** Per-attempt timeout (SDK `timeout`, ms) and retries (SDK `maxRetries`): worst case ~2 x 10 s plus SDK backoff. */
export const LLM_TIMEOUT_MS = 10_000;
export const LLM_MAX_RETRIES = 1;
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

// ---------------- model rules (claude-api skill) ----------------
/** Models that run adaptive thinking when `thinking` is omitted (Haiku 5.5, Sonnet/Opus 5.x, Fable, Mythos). */
const THINKING_DEFAULT_ON = /^claude-(haiku-5|sonnet-5|opus-5|fable|mythos)/;
/** Models that accept output_config.effort (it 400s on Haiku 4.5 / Sonnet 4.5 and older). */
const EFFORT_MODELS = /^claude-(haiku-5|sonnet-5|opus-5|opus-4-[5-8]|sonnet-4-6|fable|mythos)/;

export const maxOutputTokensFor = (model: string) => (THINKING_DEFAULT_ON.test(model) ? MAX_OUTPUT_TOKENS_THINKING : MAX_OUTPUT_TOKENS);

/**
 * Minimum cacheable prefix in tokens (skill, prompt-caching table). Shorter prefixes silently do not cache, so the
 * breakpoint is only placed when the stable part is long enough.
 */
export function minCacheableTokens(model: string): number {
  if (/^claude-(haiku-5-5|opus-5|sonnet-5-5|fable|mythos-5)/.test(model)) return 512;
  if (/^claude-(opus-4-7|mythos-preview)/.test(model)) return 2048;
  if (/^claude-haiku-4-5/.test(model)) return 4096;
  return 1024; // Opus 4.8, Sonnet 5, Sonnet 4.6/4.5, Opus 4.1/4 and unknown models
}

/** Rough token estimate for budgeting / cache decisions (~3.5 chars per token; Spanish runs a bit denser). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.5);

/** Upper bound of what one call can cost: prompt estimate + the output cap. Used to reserve budget before the call. */
export function estimateCallTokens(req: Pick<LLMRequest, "system" | "user">, model = DEFAULT_ANTHROPIC_MODEL): number {
  return estimateTokens(req.system) + estimateTokens(req.user) + maxOutputTokensFor(model);
}

// ---------------- Anthropic (official SDK) ----------------
/** The slice of the SDK client the adapter uses; tests inject a fake with the same shape. */
export interface AnthropicMessagesClient {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

/**
 * Messages API params (exported for tests). The stable part of the system prompt (rules, tone, brand rules: identical
 * for every question of a tenant) carries the cache breakpoint; the per-question sources follow it, uncached.
 * - Haiku 5.5 (default): thinking omitted (= adaptive, the skill's rule: use effort as the lever, not "disabled"),
 *   effort "low" (skill: lowest-cost level, for chat / simple high-volume routes), max_tokens 1024 (room for thinking).
 * - No temperature/top_p/top_k (400 on API version 2026-10-21 and on Haiku 5.5), no assistant prefill.
 */
export function anthropicParams(model: string, req: LLMRequest): Anthropic.MessageCreateParamsNonStreaming {
  const stable = req.systemParts?.stable ?? req.system;
  const cacheable = estimateTokens(stable) >= minCacheableTokens(model);
  const breakpoint = cacheable ? { cache_control: { type: "ephemeral" as const } } : {};
  const system: Anthropic.TextBlockParam[] = req.systemParts
    ? [{ type: "text", text: req.systemParts.stable, ...breakpoint }, { type: "text", text: req.systemParts.dynamic }]
    : [{ type: "text", text: req.system, ...breakpoint }];
  return {
    model,
    max_tokens: maxOutputTokensFor(model),
    system,
    messages: [{ role: "user", content: req.user }],
    ...(EFFORT_MODELS.test(model) ? { output_config: { effort: "low" as const } } : {}),
  };
}

/** Maps an SDK response. Reads content blocks by type (a response can begin with thinking blocks). */
export function parseAnthropicMessage(msg: Pick<Anthropic.Message, "content" | "stop_reason" | "usage"> & { model?: string }, requested: string): LLMResult {
  const u = msg.usage;
  const usage: LLMUsage = {
    inputTokens: u?.input_tokens ?? 0, outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0, cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
  };
  const model = msg.model || requested;
  // A safety refusal is billed but its text must never reach the customer: hand off to a person.
  // (Haiku 5.5 has no server-side fallback, so no `fallbacks` param is sent.)
  if (msg.stop_reason === "refusal") return { text: HANDOFF_TOKEN, usage, model };
  // Cut off (thinking used the cap, or a long answer): never send a truncated reply; the caller answers deterministically.
  if (msg.stop_reason === "max_tokens") return { text: "", usage, model };
  const text = (msg.content ?? [])
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("").trim();
  return { text, usage, model };
}

/** Error class + status only (an SDK error message can echo request details). */
function describeAnthropicError(e: unknown): string {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (e instanceof Anthropic.APIConnectionError) return "connection error";
  if (e instanceof Anthropic.RateLimitError) return "status 429";
  if (e instanceof Anthropic.AuthenticationError) return "status 401";
  if (e instanceof Anthropic.PermissionDeniedError) return "status 403";
  if (e instanceof Anthropic.BadRequestError) return "status 400";
  if (e instanceof Anthropic.InternalServerError) return `status ${e.status}`;
  if (e instanceof Anthropic.APIError) return `status ${e.status ?? "unknown"}`;
  return e instanceof Error ? e.name : "error";
}

let cachedClient: { key: string; client: AnthropicMessagesClient } | null = null;
/** One SDK client per API key: timeout and retries through client options; SDK logging off (no request details). */
export function anthropicClient(apiKey: string): AnthropicMessagesClient {
  if (cachedClient?.key !== apiKey) {
    cachedClient = { key: apiKey, client: new Anthropic({ apiKey, timeout: LLM_TIMEOUT_MS, maxRetries: LLM_MAX_RETRIES, logLevel: "off" }) };
  }
  return cachedClient.client;
}

export interface AnthropicOpts { client?: AnthropicMessagesClient }

export function anthropicLLM(apiKey: string, model = DEFAULT_ANTHROPIC_MODEL, o: AnthropicOpts = {}): LLM {
  return async (req) => {
    try {
      const client = o.client ?? anthropicClient(apiKey);
      const msg = await client.messages.create(anthropicParams(model, req));
      const r = parseAnthropicMessage(msg, model);
      // Empty / cut-off text but tokens billed: keep the usage (it is metered), answer deterministically.
      return r.text ? r : { ...r, text: offlineAnswer(req) };
    } catch (e) {
      warnFallback("anthropic", describeAnthropicError(e));
      return offlineLLM(req);
    }
  };
}

function warnFallback(provider: string, why: string) {
  // Never log the request or response body (customer text) nor headers (API key). Status / error class only.
  console.warn(`[engine] ${provider} unavailable (${why}), using offline fallback`);
}

// ---------------- OpenAI (legacy, optional; plain fetch) ----------------
export class LLMHttpError extends Error {
  constructor(public status: number, public retryAfterMs: number | null, label: string) { super(`${label} ${status}`); this.name = "LLMHttpError"; }
}
/** 429 rate limit, 5xx and network errors are retried; 4xx (bad request, auth, billing) are not. */
const isRetryable = (e: unknown) =>
  e instanceof LLMHttpError ? e.status === 429 || e.status >= 500 : !(e instanceof SyntaxError);

export interface HttpOpts { timeoutMs?: number; retryDelayMs?: number; sleep?: (ms: number) => Promise<void> }
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const OPENAI_TIMEOUT_MS = 15_000;

/** POST JSON with an overall deadline (default 15 s) and at most ONE retry, honoring `retry-after` (capped at 3 s). */
async function postJson(label: string, url: string, headers: Record<string, string>, body: unknown, o: HttpOpts): Promise<unknown> {
  const deadline = Date.now() + (o.timeoutMs ?? OPENAI_TIMEOUT_MS);
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
      warnFallback("openai", e instanceof LLMHttpError ? `status ${e.status}` : e instanceof Error ? e.name : "error");
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

/** Resolved at call time so env changes (tests, setup) are honored. The model is exposed for budget estimates. */
export function defaultLLM(): LLM & { model?: string } {
  const s = selectProvider();
  if (s.provider === "anthropic") return Object.assign(anthropicLLM(s.key, s.model), { model: s.model });
  if (s.provider === "openai") return Object.assign(openAiLLM(s.key, s.model), { model: s.model });
  return offlineLLM;
}
