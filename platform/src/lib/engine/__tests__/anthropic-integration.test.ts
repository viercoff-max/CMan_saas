// Anthropic provider through the official SDK (client injected or fetch mocked: never a real API), provider selection,
// per-tenant metering, monthly cap, platform daily cap and budget reservation.
import "./env"; // must be first: temp SQLite dir, no API keys
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../connectors/registry", () => ({ getOrdersConnector: () => null }));
vi.mock("../../channels/handoff", () => ({ notifyHandoff: async () => {} }));

import Anthropic from "@anthropic-ai/sdk";
import { handleInbound, type EngineDeps } from "../index";
import {
  anthropicClient, anthropicLLM, anthropicParams, DEFAULT_ANTHROPIC_MODEL, defaultLLM, estimateCallTokens, LLM_MAX_RETRIES,
  LLM_TIMEOUT_MS, MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS_THINKING, minCacheableTokens, normalizeLLMResult, openAiLLM,
  parseAnthropicMessage, selectProvider, type AnthropicMessagesClient, type LLMRequest,
} from "../llm";
import { AI_CAP_REASON, dataUsageMeter, recordUsage } from "../usage";
import { DEFAULT_PLATFORM_DAILY_TOKEN_CAP, platformDailyCap, platformSpendToday, releaseReservation, reserveSpend, resetSpendForTests } from "../spend";
import { getData } from "../../data";
import type { Chunk } from "../../types";
import { fakeMeter, type FakeMeter } from "./fake-meter";

const MONDAY_OPEN = new Date("2026-10-05T17:00:00Z");
const TUESDAY = new Date("2026-10-06T17:00:00Z");
const KEY = "sk-ant-test-not-real-0000";

const okBody = (text: string, usage: Record<string, number> = { input_tokens: 900, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, extra: Record<string, unknown> = {}) =>
  ({ id: "msg_test", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", stop_sequence: null, stop_details: null, content: [{ type: "text", text, citations: null }], usage, ...extra });

/** Fake SDK client (injected): each queued item is a response body or an Error to throw. Records every params object. */
function fakeClient(queue: (Record<string, unknown> | Error)[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create = vi.fn(async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(structuredClone(params));
    const next = queue.shift() ?? new Error("unexpected extra call");
    if (next instanceof Error) throw next;
    return next as unknown as Anthropic.Message;
  });
  const client: AnthropicMessagesClient = { messages: { create } };
  return { client, calls, create };
}
/** The SDK maps a status to its typed class (BadRequestError, RateLimitError, OverloadedError...). */
const apiErr = (status: number, msg = "error") => Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message: msg } }, msg, new Headers());

interface Call { url: string; headers: Record<string, string>; body: Record<string, unknown>; raw: string }
/** fetch stub (OpenAI path and the SDK's own transport): queued Response factories or Errors. Records every call. */
function stubFetch(queue: (() => Response | Error)[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const raw = String(init?.body ?? "");
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(raw) as Record<string, unknown>, raw });
    const next = queue.shift() ?? (() => new Error("unexpected extra call"));
    const r = next();
    if (r instanceof Error) throw r;
    return r;
  });
  return { calls, fn };
}
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => () => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });

const chunk = (id: string, title: string, text: string): Chunk => ({ id, tenantId: "t", sectionKey: "warranty", sourceId: null, title, text } as unknown as Chunk);
const STABLE = `STABLE RULES\n${"Responde solo con las fuentes. ".repeat(80)}`; // ~2,500 chars: above the 512-token cache minimum
const REQ: LLMRequest = {
  system: `${STABLE}\n<sources>\nS1\n</sources>`, systemParts: { stable: STABLE, dynamic: "<sources>\nS1\n</sources>" },
  user: "<customer_message>\n¿cuánto dura la garantía?\n</customer_message>", question: "¿cuánto dura la garantía?",
  sources: [chunk("1", "Garantía", "La garantía es de 1 año.")], lang: "es",
};

beforeEach(() => resetSpendForTests());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_MODEL; delete process.env.OPENAI_API_KEY; delete process.env.AI_PROVIDER;
  delete process.env.PLATFORM_DAILY_TOKEN_CAP;
});

describe("Anthropic request params (SDK messages.create)", () => {
  it("Haiku 5.5: model, max_tokens with room for thinking, effort low, thinking omitted, cache breakpoint on the stable part, one user turn", async () => {
    const { client, calls } = fakeClient([okBody("La garantía es de 1 año.")]);
    await anthropicLLM(KEY, "claude-haiku-5-5", { client })(REQ);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      model: "claude-haiku-5-5",
      max_tokens: MAX_OUTPUT_TOKENS_THINKING,
      system: [
        { type: "text", text: STABLE, cache_control: { type: "ephemeral" } },
        { type: "text", text: "<sources>\nS1\n</sources>" },
      ],
      messages: [{ role: "user", content: REQ.user }],
      output_config: { effort: "low" },
    });
    // No sampling params (400 on API version 2026-10-21 / Haiku 5.5), no disabled thinking, no prefill, no fallbacks.
    for (const k of ["temperature", "top_p", "top_k", "thinking", "fallbacks", "stream"]) expect(calls[0]).not.toHaveProperty(k);
    expect(calls[0].messages.at(-1)!.role).toBe("user");
  });

  it("Haiku 4.5 override: no effort (it 400s there), 400-token cap; 4,096-token cache minimum respected", () => {
    const p = anthropicParams("claude-haiku-4-5", REQ);
    expect(p).not.toHaveProperty("output_config");
    expect(p).not.toHaveProperty("thinking");
    expect(p.max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(minCacheableTokens("claude-haiku-4-5")).toBe(4096);
    expect((p.system as Anthropic.TextBlockParam[])[0]).not.toHaveProperty("cache_control"); // ~700 tokens < 4,096
  });

  it("a stable prefix below the model minimum gets no breakpoint; without systemParts the whole prompt is one block", () => {
    const short = { ...REQ, system: "SHORT\n<sources></sources>", systemParts: { stable: "SHORT", dynamic: "<sources></sources>" } };
    expect(minCacheableTokens("claude-haiku-5-5")).toBe(512);
    expect((anthropicParams("claude-haiku-5-5", short).system as Anthropic.TextBlockParam[]).some((b) => b.cache_control)).toBe(false);
    const whole = anthropicParams("claude-haiku-5-5", { ...REQ, systemParts: undefined });
    expect(whole.system).toEqual([{ type: "text", text: REQ.system, cache_control: { type: "ephemeral" } }]);
  });

  it("default model is claude-haiku-5-5, overridable by ANTHROPIC_MODEL", () => {
    expect(DEFAULT_ANTHROPIC_MODEL).toBe("claude-haiku-5-5");
    expect(selectProvider({ ANTHROPIC_API_KEY: "a" }).model).toBe("claude-haiku-5-5");
    expect(selectProvider({ ANTHROPIC_API_KEY: "a", ANTHROPIC_MODEL: "claude-haiku-4-5" }).model).toBe("claude-haiku-4-5");
    process.env.ANTHROPIC_API_KEY = KEY; process.env.ANTHROPIC_MODEL = "claude-sonnet-5-5";
    expect(defaultLLM().model).toBe("claude-sonnet-5-5");
  });

  it("the real SDK client: API key, 10 s timeout and 1 retry come from client options; one client per key", () => {
    const c = anthropicClient(KEY) as unknown as Anthropic;
    expect(c).toBeInstanceOf(Anthropic);
    expect(c.apiKey).toBe(KEY);
    expect(c.timeout).toBe(LLM_TIMEOUT_MS);
    expect(c.maxRetries).toBe(LLM_MAX_RETRIES);
    expect(anthropicClient(KEY)).toBe(c);
    expect(anthropicClient(`${KEY}-other`)).not.toBe(c);
  });
});

describe("Anthropic response handling", () => {
  it("returns text, model and usage incl. cache read/write tokens; skips thinking blocks", async () => {
    const { client } = fakeClient([okBody("x", { input_tokens: 120, output_tokens: 45, cache_read_input_tokens: 800, cache_creation_input_tokens: 30 }, {
      content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: "La garantía es " }, { type: "text", text: "de 1 año." }],
    })]);
    const r = normalizeLLMResult(await anthropicLLM(KEY, undefined, { client })(REQ));
    expect(r).toEqual({ text: "La garantía es de 1 año.", model: "claude-haiku-5-5", usage: { inputTokens: 120, outputTokens: 45, cacheReadTokens: 800, cacheWriteTokens: 30 } });
  });

  it("stop_reason refusal becomes [HANDOFF] (usage kept, refused text never used)", () => {
    const ref = parseAnthropicMessage(okBody("secret", { input_tokens: 5, output_tokens: 1 }, { stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } }) as unknown as Anthropic.Message, "req");
    expect(ref).toEqual({ text: "[HANDOFF]", model: "claude-haiku-5-5", usage: { inputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } });
  });

  it("stop_reason max_tokens (thinking used the cap) never sends a truncated reply: deterministic answer, usage still metered", async () => {
    const { client } = fakeClient([okBody("La garantía es de", { input_tokens: 700, output_tokens: 1024 }, { stop_reason: "max_tokens" })]);
    const r = normalizeLLMResult(await anthropicLLM(KEY, undefined, { client })(REQ));
    expect(r.text).toBe("La garantía es de 1 año.");
    expect(r.usage.outputTokens).toBe(1024);
    expect(r.model).toBe("claude-haiku-5-5");
  });

  it("empty content: deterministic answer, but the billed usage is still reported", async () => {
    const { client } = fakeClient([{ ...okBody(""), content: [] }]);
    const r = normalizeLLMResult(await anthropicLLM(KEY, undefined, { client })(REQ));
    expect(r.text).toBe("La garantía es de 1 año.");
    expect(r.usage.inputTokens).toBe(900);
    expect(r.model).not.toBe("offline");
  });
});

describe("Anthropic typed errors -> offline fallback (never metered, nothing sensitive logged)", () => {
  const cases: [string, Error, RegExp][] = [
    ["400", apiErr(400), /status 400/],
    ["401", apiErr(401), /status 401/],
    ["403", apiErr(403), /status 403/],
    ["429", apiErr(429), /status 429/],
    ["529", apiErr(529), /status 529/],
    ["500", apiErr(500), /status 500/],
    ["timeout", new Anthropic.APIConnectionTimeoutError(), /timeout/],
    ["network", new Anthropic.APIConnectionError({ message: "fetch failed" }), /connection error/],
  ];
  for (const [name, err, logged] of cases) {
    it(`${name}`, async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { client, create } = fakeClient([err]);
      const r = normalizeLLMResult(await anthropicLLM(KEY, undefined, { client })(REQ));
      expect(create).toHaveBeenCalledTimes(1); // retries live inside the SDK (maxRetries), not in the adapter
      expect(r).toEqual({ text: "La garantía es de 1 año.", usage: { inputTokens: 0, outputTokens: 0 }, model: "offline" });
      expect(JSON.stringify(warn.mock.calls)).toMatch(logged);
    });
  }

  it("logs never contain the API key, the prompt or the customer text (even when the error message echoes them)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient([apiErr(401, `bad key ${KEY} for ¿cuánto dura la garantía? STABLE RULES`)]);
    await anthropicLLM(KEY, undefined, { client })(REQ);
    const logged = JSON.stringify([...warn.mock.calls, ...err.mock.calls]);
    expect(logged).toMatch(/status 401/);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toMatch(/garant|STABLE RULES|customer_message/);
  });

  it("real SDK transport (fetch mocked): 529 is retried once by the SDK, then the answer is used", async () => {
    const s = stubFetch([json({ type: "error", error: { type: "overloaded_error", message: "o" } }, 529, { "retry-after-ms": "1" }), json(okBody("La garantía es de 1 año."))]);
    const client = new Anthropic({ apiKey: KEY, fetch: s.fn as unknown as typeof fetch, maxRetries: LLM_MAX_RETRIES, logLevel: "off" });
    const r = normalizeLLMResult(await anthropicLLM(KEY, undefined, { client })(REQ));
    expect(s.calls).toHaveLength(2);
    expect(s.calls[0].url).toMatch(/\/v1\/messages$/);
    expect(s.calls[0].body).toMatchObject({ model: "claude-haiku-5-5", output_config: { effort: "low" } });
    expect(s.calls[0].raw).not.toContain("temperature");
    expect(r.text).toBe("La garantía es de 1 año.");
  });

  it("real SDK transport: 400 is not retried", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = stubFetch([json({ type: "error", error: { type: "invalid_request_error", message: "bad" } }, 400)]);
    const client = new Anthropic({ apiKey: KEY, fetch: s.fn as unknown as typeof fetch, maxRetries: LLM_MAX_RETRIES, logLevel: "off" });
    expect(normalizeLLMResult(await anthropicLLM(KEY, undefined, { client })(REQ)).model).toBe("offline");
    expect(s.calls).toHaveLength(1);
  });
});

describe("provider selection", () => {
  it("Anthropic by default when its key is set; OpenAI only without it (or AI_PROVIDER=openai); else offline", () => {
    expect(selectProvider({}).provider).toBe("offline");
    expect(selectProvider({ ANTHROPIC_API_KEY: " " }).provider).toBe("offline");
    expect(selectProvider({ ANTHROPIC_API_KEY: "a" })).toEqual({ provider: "anthropic", key: "a", model: "claude-haiku-5-5" });
    expect(selectProvider({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" }).provider).toBe("anthropic");
    expect(selectProvider({ OPENAI_API_KEY: "o" }).provider).toBe("openai");
    expect(selectProvider({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", AI_PROVIDER: "openai" }).provider).toBe("openai");
    expect(selectProvider({ ANTHROPIC_API_KEY: "a", AI_PROVIDER: "openai" }).provider).toBe("anthropic"); // no OpenAI key
    expect(selectProvider({ OPENAI_API_KEY: "o", AI_PROVIDER: "anthropic" }).provider).toBe("openai"); // no Anthropic key
  });

  it("defaultLLM: OpenAI legacy path via fetch; offline without keys makes no request", async () => {
    process.env.OPENAI_API_KEY = "sk-openai-test";
    let s = stubFetch([json({ model: "gpt-4o-mini", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 40 } } })]);
    vi.stubGlobal("fetch", s.fn);
    const r = normalizeLLMResult(await defaultLLM()(REQ));
    expect(s.calls.map((c) => c.url)).toEqual(["https://api.openai.com/v1/chat/completions"]);
    expect(r.usage).toEqual({ inputTokens: 60, outputTokens: 10, cacheReadTokens: 40 });
    delete process.env.OPENAI_API_KEY;
    s = stubFetch([]);
    vi.stubGlobal("fetch", s.fn);
    expect(normalizeLLMResult(await defaultLLM()(REQ)).model).toBe("offline");
    expect(s.fn).not.toHaveBeenCalled();
  });

  it("openAiLLM still works as the legacy fallback", async () => {
    vi.stubGlobal("fetch", stubFetch([json({ choices: [{ message: { content: "La garantía es de 1 año." } }] })]).fn);
    expect(normalizeLLMResult(await openAiLLM("k")(REQ))).toMatchObject({ text: "La garantía es de 1 año.", model: "gpt-4o-mini" });
  });
});

// ---------------- engine: PII, metering, cap ----------------
async function setupTenant() {
  const tenantId = `t-${randomUUID()}`;
  await getData().settings.save(tenantId, { agentName: "Chefi", toneLevel: 3, crossSellLevel: 0, greeting: "", fallbackMessage: "", businessHours: "" });
  await getData().chunks.replace(tenantId, { sectionKey: "warranty" }, [{ title: "Garantía", text: "Todos los productos Chefman tienen garantía de 1 año contra defectos de fábrica." }]);
  await getData().chunks.replace(tenantId, { sectionKey: "shipping_returns" }, [{ title: "Horarios tienda", text: "Abrimos de lunes a viernes." }]);
  await getData().sections.saveContent(tenantId, "dos_donts", "Nunca prometas descuentos.");
  return tenantId;
}
let n = 0;
const ev = (tenantId: string, text: string, ext = "c1") =>
  ({ tenantId, channel: "simulator" as const, externalId: `${ext}-${tenantId}`, customerName: "Juan Pérez", text, providerMessageId: `m-${++n}` });
function deps(meter: FakeMeter, over: Partial<EngineDeps> = {}): EngineDeps {
  return { now: () => MONDAY_OPEN, getOrdersConnector: () => null, notifyHandoff: async () => {}, usage: meter, ...over };
}

describe("engine -> Anthropic SDK: no customer PII in the request params", () => {
  it("emails, phones, names and order numbers never reach messages.create params", async () => {
    const t = await setupTenant();
    const { client, calls } = fakeClient([okBody("Claro, con gusto te ayudo."), okBody("La garantía es de 1 año contra defectos de fábrica.")]);
    const meter = fakeMeter();
    const llm = anthropicLLM(KEY, "claude-haiku-5-5", { client });
    await handleInbound(ev(t, "hola, ¿la garantía cubre mi licuadora? escríbeme a juan.perez@gmail.com o al +5215512345678"), deps(meter, { llm }));
    await handleInbound(ev(t, "¿y cuánto dura la garantía? mi cel 5512345678, correo otra.persona@hotmail.com"), deps(meter, { llm }));
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      const raw = JSON.stringify(c);
      expect(raw).not.toMatch(/juan\.perez|gmail\.com|otra\.persona|hotmail|5215512345678|5512345678|Juan Pérez/);
      expect(raw).toMatch(/\[email\]|\[phone\]/);
      const sys = c.system as Anthropic.TextBlockParam[];
      expect(sys[0].text).toMatch(/STRICT RULES/);
      expect(sys[0].text).not.toMatch(/<source id=/); // per-question sources live after the (possible) cache breakpoint
      expect(sys[1].text).toMatch(/^<sources>/);
      expect(sys[1]).not.toHaveProperty("cache_control");
    }
    // Both calls metered on this tenant: input = uncached + cache read + cache write.
    expect(meter.records).toEqual([
      { tenantId: t, requests: 1, inputTokens: 900, outputTokens: 60 },
      { tenantId: t, requests: 1, inputTokens: 900, outputTokens: 60 },
    ]);
  });

  it("validator still guards model output (invented promo is blocked and handed off)", async () => {
    const t = await setupTenant();
    const { client } = fakeClient([okBody("La garantía es de 1 año y hoy tienes 20% de descuento con el cupón CHEF20.")]);
    const r = await handleInbound(ev(t, "¿Cuánto dura la garantía?"), deps(fakeMeter(), { llm: anthropicLLM(KEY, undefined, { client }) }));
    expect(r).toMatchObject({ escalated: true, reason: "no_answer" });
    expect(r.text).not.toMatch(/CHEF20|descuento/);
  });

  it("a refusal hands the conversation to a person", async () => {
    const t = await setupTenant();
    const { client } = fakeClient([okBody("no", { input_tokens: 10, output_tokens: 1 }, { stop_reason: "refusal" })]);
    const meter = fakeMeter();
    const r = await handleInbound(ev(t, "¿Cuánto dura la garantía?"), deps(meter, { llm: anthropicLLM(KEY, undefined, { client }) }));
    expect(r).toMatchObject({ escalated: true, reason: "no_answer" });
    expect(meter.records).toEqual([{ tenantId: t, requests: 1, inputTokens: 10, outputTokens: 1 }]);
  });
});

describe("metering", () => {
  it("records cache tokens as input and is tenant-scoped: A's calls are never billed to B", async () => {
    const A = await setupTenant(); const B = await setupTenant();
    const meter = fakeMeter();
    const llm = async () => ({ text: "La garantía es de 1 año contra defectos de fábrica.", model: "claude-haiku-5-5", usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 700, cacheWriteTokens: 10 } });
    await handleInbound(ev(A, "¿Cuánto dura la garantía?"), deps(meter, { llm }));
    await handleInbound(ev(A, "¿la garantía cubre defectos?"), deps(meter, { llm }));
    expect(meter.records).toEqual([
      { tenantId: A, requests: 1, inputTokens: 810, outputTokens: 50 },
      { tenantId: A, requests: 1, inputTokens: 810, outputTokens: 50 },
    ]);
    expect(meter.records.some((r) => r.tenantId === B)).toBe(false);
  });

  it("the offline fallback is not metered", async () => {
    const t = await setupTenant();
    const meter = fakeMeter();
    const r = await handleInbound(ev(t, "¿Cuánto dura la garantía?"), deps(meter)); // no key -> offline
    expect(r.text).toMatch(/1 año/);
    expect(meter.records).toEqual([]);
  });

  it("a metering failure never breaks the reply", async () => {
    const t = await setupTenant();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const llm = async () => ({ text: "La garantía es de 1 año contra defectos de fábrica.", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });
    const r = await handleInbound(ev(t, "¿Cuánto dura la garantía?"), deps(fakeMeter({ failRecord: true }), { llm }));
    expect(r).toMatchObject({ escalated: false });
    expect(r.text).toMatch(/1 año/);
    expect(JSON.stringify(err.mock.calls)).toMatch(/usage\.record failed/);
  });

  it("real data layer: recordUsage adds to this tenant's month only", async () => {
    const A = `t-${randomUUID()}`; const B = `t-${randomUUID()}`;
    await recordUsage(dataUsageMeter, A, { text: "x", model: "claude-haiku-5-5", usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100 } }, MONDAY_OPEN);
    await recordUsage(dataUsageMeter, A, { text: "x", model: "offline", usage: { inputTokens: 0, outputTokens: 0 } }, MONDAY_OPEN);
    expect(await getData().usage.get(A, "2026-10-01")).toMatchObject({ requests: 1, inputTokens: 110, outputTokens: 5 });
    expect(await getData().usage.get(B, "2026-10-01")).toMatchObject({ requests: 0, inputTokens: 0, outputTokens: 0 });
  });
});

describe("monthly cap", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => warn.mockRestore());

  it("cap reached: the paid LLM is NOT called; the deterministic fallback answers; not metered", async () => {
    const t = await setupTenant();
    const meter = fakeMeter(); meter.budget.set(t, 0);
    const llm = vi.fn(async () => "no");
    const r = await handleInbound(ev(t, "¿Cuánto dura la garantía?"), deps(meter, { llm }));
    expect(llm).not.toHaveBeenCalled();
    expect(r).toMatchObject({ escalated: false });
    expect(r.text).toMatch(/garantía de 1 año/);
    expect(meter.records).toEqual([]);
    const conv = await getData().conversations.getOrCreate(t, "simulator", `c1-${t}`);
    expect((await getData().messages.list(t, conv.id)).at(-1)!.meta.aiCap).toBe(true);
  });

  it("cap reached and no deterministic answer: hand off with reason ai_cap_reached (fits escalation_reason <= 40)", async () => {
    const t = await setupTenant();
    const meter = fakeMeter(); meter.budget.set(t, 0);
    const llm = vi.fn(async () => "no");
    const r = await handleInbound(ev(t, "¿horarios tienda?"), deps(meter, { llm }));
    expect(llm).not.toHaveBeenCalled();
    expect(r).toMatchObject({ escalated: true, reason: AI_CAP_REASON });
    expect(AI_CAP_REASON).toBe("ai_cap_reached");
    expect(AI_CAP_REASON.length).toBeLessThanOrEqual(40);
    const conv = await getData().conversations.getOrCreate(t, "simulator", `c1-${t}`);
    expect(conv.status).toBe("needs_human");
    expect((await getData().messages.list(t, conv.id)).at(-1)!.meta).toMatchObject({ intent: "ai_cap_reached", escalationReason: "ai_cap_reached" });
  });

  it("audits the cap once per tenant per day (and again the next day)", async () => {
    const t = await setupTenant(); const other = await setupTenant();
    const meter = fakeMeter(); meter.budget.set(t, 0);
    const llm = vi.fn(async () => "La garantía es de 1 año contra defectos de fábrica.");
    for (const ext of ["a", "b", "c"]) await handleInbound(ev(t, "¿Cuánto dura la garantía?", ext), deps(meter, { llm }));
    expect(meter.audits).toEqual([{ tenantId: t, detail: "day=2026-10-05" }]);
    await handleInbound(ev(t, "¿Cuánto dura la garantía?", "d"), deps(meter, { llm, now: () => TUESDAY }));
    expect(meter.audits).toEqual([{ tenantId: t, detail: "day=2026-10-05" }, { tenantId: t, detail: "day=2026-10-06" }]);
    // Cross-tenant: tenant `other` still has budget, its LLM is called and no audit is written for it.
    await handleInbound(ev(other, "¿Cuánto dura la garantía?"), deps(meter, { llm }));
    expect(llm).toHaveBeenCalledTimes(1);
    expect(meter.audits.some((a) => a.tenantId === other)).toBe(false);
  });

  it("tenant A at its cap never blocks tenant B, and B's usage never lowers A's budget", async () => {
    const A = await setupTenant(); const B = await setupTenant();
    const meter = fakeMeter(); meter.budget.set(A, 0); meter.budget.set(B, 5000);
    const llm = vi.fn(async () => ({ text: "La garantía es de 1 año contra defectos de fábrica.", model: "m", usage: { inputTokens: 1000, outputTokens: 100 } }));
    await handleInbound(ev(B, "¿Cuánto dura la garantía?"), deps(meter, { llm }));
    await handleInbound(ev(A, "¿Cuánto dura la garantía?"), deps(meter, { llm }));
    expect(llm).toHaveBeenCalledTimes(1);
    expect(meter.budget.get(B)).toBe(3900);
    expect(meter.budget.get(A)).toBe(0);
    expect(meter.records.map((r) => r.tenantId)).toEqual([B]);
  });

  it("budget unreadable: fails closed (no paid call, no audit) but the customer still gets the fallback", async () => {
    const t = await setupTenant();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const meter = fakeMeter({ failRemaining: true });
    const llm = vi.fn(async () => "x");
    const r = await handleInbound(ev(t, "¿Cuánto dura la garantía?"), deps(meter, { llm }));
    expect(llm).not.toHaveBeenCalled();
    expect(r.text).toMatch(/1 año/);
    expect(meter.audits).toEqual([]);
    expect(JSON.stringify(err.mock.calls)).toMatch(/usage\.remaining failed/);
  });

  it("real data layer: an unknown tenant has no budget (fail closed) -> no paid call", async () => {
    const t = await setupTenant(); // settings/chunks only: no tenants row
    const llm = vi.fn(async () => "x");
    await handleInbound(ev(t, "¿Cuánto dura la garantía?"), { now: () => MONDAY_OPEN, getOrdersConnector: () => null, notifyHandoff: async () => {}, llm });
    expect(llm).not.toHaveBeenCalled();
    expect(await getData().audit.find(t, { action: "ai.cap_reached", detail: "day=2026-10-05" })).toBe("day=2026-10-05");
  });
});

describe("budget reservation (M3): the call's upper bound must fit, so parallel calls cannot overshoot", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => warn.mockRestore());

  it("remaining > 0 but below the call estimate: no paid call, cap audited", async () => {
    const t = await setupTenant();
    const meter = fakeMeter(); meter.budget.set(t, 50);
    const llm = vi.fn(async () => "La garantía es de 1 año contra defectos de fábrica.");
    const r = await handleInbound(ev(t, "¿Cuánto dura la garantía?"), deps(meter, { llm }));
    expect(llm).not.toHaveBeenCalled();
    expect(r.text).toMatch(/1 año/);
    expect(meter.audits).toEqual([{ tenantId: t, detail: "day=2026-10-05" }]);
  });

  it("parallel calls: in-flight reservations count against the tenant budget", async () => {
    const t = await setupTenant();
    const est = estimateCallTokens({ system: "x".repeat(3500), user: "y" }, "claude-haiku-5-5");
    const a = await reserveSpend(t, est, est * 1.5, MONDAY_OPEN);
    expect(a.ok).toBe(true);
    expect(await reserveSpend(t, est, est * 1.5, MONDAY_OPEN)).toEqual({ ok: false, reason: "tenant_cap" });
    // another tenant is unaffected (cross-tenant negative)
    expect((await reserveSpend(`${t}-other`, est, est * 1.5, MONDAY_OPEN)).ok).toBe(true);
    if (a.ok) releaseReservation(a.reservation, 10);
    expect((await reserveSpend(t, est, est * 1.5, MONDAY_OPEN)).ok).toBe(true);
  });

  it("engine: two parallel questions with budget for one: only one paid call", async () => {
    // Measure the engine's real per-call estimate on an identical tenant, then give the test tenant room for 1.5 calls.
    const probe = await setupTenant();
    let probed: LLMRequest | null = null;
    await handleInbound(ev(probe, "¿Cuánto dura la garantía?"), deps(fakeMeter(), { llm: async (req) => { probed = req; return "La garantía es de 1 año."; } }));
    const est = estimateCallTokens(probed!);
    const t = await setupTenant();
    const meter = fakeMeter(); meter.budget.set(t, Math.floor(est * 1.5));
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const llm = vi.fn(async () => { await gate; return { text: "La garantía es de 1 año contra defectos de fábrica.", model: "m", usage: { inputTokens: 900, outputTokens: 50 } }; });
    const p1 = handleInbound(ev(t, "¿Cuánto dura la garantía?", "p1"), deps(meter, { llm }));
    const p2 = handleInbound(ev(t, "¿Cuánto dura la garantía?", "p2"), deps(meter, { llm }));
    await new Promise((r) => setTimeout(r, 50));
    release();
    await Promise.all([p1, p2]);
    expect(llm).toHaveBeenCalledTimes(1);
  });
});

describe("platform daily cap (PLATFORM_DAILY_TOKEN_CAP)", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => warn.mockRestore());

  it("parses the env (default 5,000,000; 0 stops paid calls; junk falls back to the default)", () => {
    expect(platformDailyCap({})).toBe(DEFAULT_PLATFORM_DAILY_TOKEN_CAP);
    expect(DEFAULT_PLATFORM_DAILY_TOKEN_CAP).toBe(5_000_000);
    expect(platformDailyCap({ PLATFORM_DAILY_TOKEN_CAP: "2_000_000" })).toBe(2_000_000);
    expect(platformDailyCap({ PLATFORM_DAILY_TOKEN_CAP: "0" })).toBe(0);
    expect(platformDailyCap({ PLATFORM_DAILY_TOKEN_CAP: "lots" })).toBe(DEFAULT_PLATFORM_DAILY_TOKEN_CAP);
  });

  it("the day is shared by ALL tenants: once spent, every tenant gets the free fallback, next UTC day resumes", async () => {
    const A = await setupTenant(); const B = await setupTenant();
    process.env.PLATFORM_DAILY_TOKEN_CAP = "4000";
    const meter = fakeMeter();
    const llm = vi.fn(async () => ({ text: "La garantía es de 1 año contra defectos de fábrica.", model: "m", usage: { inputTokens: 2500, outputTokens: 100 } }));
    const day = new Date("2031-01-07T12:00:00Z"); // own UTC day: the shared counter starts empty
    await handleInbound(ev(A, "¿Cuánto dura la garantía?"), deps(meter, { llm, now: () => day }));
    expect(llm).toHaveBeenCalledTimes(1);
    expect(platformSpendToday(day).used).toBe(2600);
    const r = await handleInbound(ev(B, "¿Cuánto dura la garantía?"), deps(meter, { llm, now: () => day }));
    expect(llm).toHaveBeenCalledTimes(1); // B was not metered or capped itself: the platform breaker stopped it
    expect(r.text).toMatch(/1 año/);
    expect(meter.audits).toEqual([]); // not a tenant cap
    expect(JSON.stringify(warn.mock.calls)).toMatch(/platform daily AI token cap reached/);
    const r2 = await handleInbound(ev(B, "¿horarios tienda?", "z"), deps(meter, { llm, now: () => day }));
    expect(r2).toMatchObject({ escalated: true, reason: "no_answer" });
    const next = new Date("2031-01-08T00:30:00Z");
    await handleInbound(ev(B, "¿Cuánto dura la garantía?", "y"), deps(meter, { llm, now: () => next }));
    expect(llm).toHaveBeenCalledTimes(2);
  });

  it("the shared counter (rateLimits) stops calls even when this process has no record of the spend", async () => {
    const t = await setupTenant();
    process.env.PLATFORM_DAILY_TOKEN_CAP = "3000";
    const day = new Date("2031-02-03T12:00:00Z");
    const first = await reserveSpend(t, 2500, 1e9, day);
    expect(first.ok).toBe(true);
    resetSpendForTests(); // as if another instance had spent it
    expect(await reserveSpend(t, 2500, 1e9, day)).toEqual({ ok: false, reason: "platform_cap" });
  });

  it("PLATFORM_DAILY_TOKEN_CAP=0: no paid call at all", async () => {
    const t = await setupTenant();
    process.env.PLATFORM_DAILY_TOKEN_CAP = "0";
    const llm = vi.fn(async () => "x");
    const r = await handleInbound(ev(t, "¿Cuánto dura la garantía?"), deps(fakeMeter(), { llm }));
    expect(llm).not.toHaveBeenCalled();
    expect(r.text).toMatch(/1 año/);
  });
});
