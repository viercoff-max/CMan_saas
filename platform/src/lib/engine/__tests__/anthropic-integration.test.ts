// Wave 2B: Anthropic provider (fetch mocked, never a real API), provider selection, per-tenant metering and monthly cap.
import "./env"; // must be first: temp SQLite dir, no API keys
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../connectors/registry", () => ({ getOrdersConnector: () => null }));
vi.mock("../../channels/handoff", () => ({ notifyHandoff: async () => {} }));

import { handleInbound, type EngineDeps } from "../index";
import {
  ANTHROPIC_URL, ANTHROPIC_VERSION, anthropicBody, anthropicLLM, DEFAULT_ANTHROPIC_MODEL, defaultLLM, MAX_OUTPUT_TOKENS,
  normalizeLLMResult, openAiLLM, parseAnthropic, selectProvider, type LLMRequest,
} from "../llm";
import { AI_CAP_REASON, dataUsageMeter, recordUsage } from "../usage";
import { getData } from "../../data";
import type { Chunk } from "../../types";
import { fakeMeter, type FakeMeter } from "./fake-meter";

const MONDAY_OPEN = new Date("2026-10-05T17:00:00Z");
const TUESDAY = new Date("2026-10-06T17:00:00Z");
const KEY = "sk-ant-test-not-real-0000";

interface Call { url: string; headers: Record<string, string>; body: Record<string, unknown>; raw: string }
const okBody = (text: string, usage: Record<string, number> = { input_tokens: 900, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, extra: Record<string, unknown> = {}) =>
  ({ id: "msg_test", type: "message", role: "assistant", model: "claude-haiku-4-5-20251001", stop_reason: "end_turn", content: [{ type: "text", text }], usage, ...extra });

/** fetch stub: each queued item is a Response factory or an Error to throw. Records every call. */
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
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => () => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });

const chunk = (id: string, title: string, text: string): Chunk => ({ id, tenantId: "t", sectionKey: "warranty", sourceId: null, title, text } as unknown as Chunk);
const REQ: LLMRequest = {
  system: "STABLE RULES\n<sources>\nS1\n</sources>", systemParts: { stable: "STABLE RULES", dynamic: "<sources>\nS1\n</sources>" },
  user: "<customer_message>\n¿cuánto dura la garantía?\n</customer_message>", question: "¿cuánto dura la garantía?",
  sources: [chunk("1", "Garantía", "La garantía es de 1 año.")], lang: "es",
};
const noSleep = { sleep: async () => {}, retryDelayMs: 1 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_MODEL; delete process.env.OPENAI_API_KEY; delete process.env.AI_PROVIDER;
});

describe("Anthropic request shape", () => {
  it("POSTs /v1/messages with key + version headers, model, small max_tokens, cacheable system block, one user turn", async () => {
    const { calls } = stubFetch([json(okBody("La garantía es de 1 año."))]);
    await anthropicLLM(KEY, "claude-haiku-4-5")(REQ);
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c.url).toBe(ANTHROPIC_URL);
    expect(c.url).toBe("https://api.anthropic.com/v1/messages");
    expect(c.headers["x-api-key"]).toBe(KEY);
    expect(c.headers["anthropic-version"]).toBe(ANTHROPIC_VERSION);
    expect(c.headers["content-type"]).toBe("application/json");
    expect(c.body).toEqual({
      model: "claude-haiku-4-5",
      max_tokens: MAX_OUTPUT_TOKENS,
      system: [
        { type: "text", text: "STABLE RULES", cache_control: { type: "ephemeral" } },
        { type: "text", text: "<sources>\nS1\n</sources>" },
      ],
      messages: [{ role: "user", content: REQ.user }],
    });
    expect(MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(500);
    // No sampling params (rejected on API version 2026-10-21), no thinking for Haiku 4.5, no prefill.
    expect(c.body).not.toHaveProperty("temperature");
    expect(c.body).not.toHaveProperty("thinking");
  });

  it("without systemParts the whole system prompt is one cacheable block; Haiku 5.x gets thinking disabled", () => {
    const b = anthropicBody("claude-haiku-5-5", { ...REQ, systemParts: undefined });
    expect(b.system).toEqual([{ type: "text", text: REQ.system, cache_control: { type: "ephemeral" } }]);
    expect(b).toMatchObject({ thinking: { type: "disabled" } });
  });

  it("default model is claude-haiku-4-5, overridable by ANTHROPIC_MODEL", async () => {
    expect(DEFAULT_ANTHROPIC_MODEL).toBe("claude-haiku-4-5");
    process.env.ANTHROPIC_API_KEY = KEY;
    let s = stubFetch([json(okBody("ok"))]);
    await defaultLLM()(REQ);
    expect(s.calls[0].body.model).toBe("claude-haiku-4-5");
    process.env.ANTHROPIC_MODEL = "claude-haiku-5-5";
    s = stubFetch([json(okBody("ok"))]);
    await defaultLLM()(REQ);
    expect(s.calls[0].body.model).toBe("claude-haiku-5-5");
  });
});

describe("Anthropic response parsing", () => {
  it("returns text, model and usage incl. cache read/write tokens", async () => {
    stubFetch([json(okBody("La garantía es de 1 año.", { input_tokens: 120, output_tokens: 45, cache_read_input_tokens: 800, cache_creation_input_tokens: 30 }))]);
    const r = normalizeLLMResult(await anthropicLLM(KEY)(REQ));
    expect(r).toEqual({ text: "La garantía es de 1 año.", model: "claude-haiku-4-5-20251001", usage: { inputTokens: 120, outputTokens: 45, cacheReadTokens: 800, cacheWriteTokens: 30 } });
  });

  it("joins text blocks, ignores other block types; refusal becomes [HANDOFF] (usage kept)", () => {
    const r = parseAnthropic({ model: "m", content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Hola. " }, { type: "text", text: "Adiós." }], usage: { input_tokens: 1, output_tokens: 2 } }, "req");
    expect(r.text).toBe("Hola. Adiós.");
    const ref = parseAnthropic({ model: "m", stop_reason: "refusal", content: [{ type: "text", text: "secret" }], usage: { input_tokens: 5, output_tokens: 1 } }, "req");
    expect(ref.text).toBe("[HANDOFF]");
    expect(ref.usage.inputTokens).toBe(5);
    expect(parseAnthropic(null, "req")).toMatchObject({ text: "", model: "req", usage: { inputTokens: 0, outputTokens: 0 } });
  });

  it("empty content: deterministic answer, but the billed usage is still reported", async () => {
    stubFetch([json({ ...okBody(""), content: [] })]);
    const r = normalizeLLMResult(await anthropicLLM(KEY)(REQ));
    expect(r.text).toBe("La garantía es de 1 año.");
    expect(r.usage.inputTokens).toBe(900);
    expect(r.model).not.toBe("offline");
  });
});

describe("Anthropic errors and retries", () => {
  it("one retry on 529 overloaded, then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    const { calls } = stubFetch([json({ type: "error", error: { type: "overloaded_error" } }, 529), json(okBody("La garantía es de 1 año."))]);
    const r = normalizeLLMResult(await anthropicLLM(KEY, undefined, { sleep, retryDelayMs: 5 })(REQ));
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(5);
    expect(r.model).toBe("claude-haiku-4-5-20251001");
  });

  it("429 honors retry-after (capped at 3 s)", async () => {
    const sleep = vi.fn(async () => {});
    stubFetch([json({ type: "error", error: { type: "rate_limit_error" } }, 429, { "retry-after": "2" }), json(okBody("ok"))]);
    await anthropicLLM(KEY, undefined, { sleep })(REQ);
    expect(sleep).toHaveBeenCalledWith(2000);
    const sleep2 = vi.fn(async () => {});
    stubFetch([json({}, 429, { "retry-after": "60" }), json(okBody("ok"))]);
    await anthropicLLM(KEY, undefined, { sleep: sleep2 })(REQ);
    expect(sleep2).toHaveBeenCalledWith(3000);
  });

  it("at most ONE retry: two 500s -> offline fallback, not metered", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { calls } = stubFetch([json({}, 500), json({}, 503)]);
    const r = normalizeLLMResult(await anthropicLLM(KEY, undefined, noSleep)(REQ));
    expect(calls).toHaveLength(2);
    expect(r).toEqual({ text: "La garantía es de 1 año.", usage: { inputTokens: 0, outputTokens: 0 }, model: "offline" });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("4xx (bad request / auth / billing) is not retried", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const status of [400, 401, 402, 403]) {
      const { calls } = stubFetch([json({ type: "error", error: { type: "invalid_request_error" } }, status)]);
      expect(normalizeLLMResult(await anthropicLLM(KEY, undefined, noSleep)(REQ)).model).toBe("offline");
      expect(calls).toHaveLength(1);
    }
  });

  it("network error is retried once", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { calls } = stubFetch([() => new TypeError("fetch failed"), json(okBody("ok"))]);
    expect(normalizeLLMResult(await anthropicLLM(KEY, undefined, noSleep)(REQ)).text).toBe("ok");
    expect(calls).toHaveLength(2);
  });

  it("timeout aborts the request and falls back without retrying", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fn = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fn);
    const r = normalizeLLMResult(await anthropicLLM(KEY, undefined, { timeoutMs: 30, ...noSleep })(REQ));
    expect(r.model).toBe("offline");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("logs never contain the API key, the prompt or the customer text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch([json({ error: { message: `bad key ${KEY}` } }, 401)]);
    await anthropicLLM(KEY, undefined, noSleep)(REQ);
    const logged = JSON.stringify([...warn.mock.calls, ...err.mock.calls]);
    expect(logged).toMatch(/status 401/);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toMatch(/garant|STABLE RULES|customer_message/);
  });
});

describe("provider selection", () => {
  it("Anthropic by default when its key is set; OpenAI only without it (or AI_PROVIDER=openai); else offline", () => {
    expect(selectProvider({}).provider).toBe("offline");
    expect(selectProvider({ ANTHROPIC_API_KEY: " " }).provider).toBe("offline");
    expect(selectProvider({ ANTHROPIC_API_KEY: "a" })).toEqual({ provider: "anthropic", key: "a", model: "claude-haiku-4-5" });
    expect(selectProvider({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" }).provider).toBe("anthropic");
    expect(selectProvider({ OPENAI_API_KEY: "o" }).provider).toBe("openai");
    expect(selectProvider({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", AI_PROVIDER: "openai" }).provider).toBe("openai");
    expect(selectProvider({ ANTHROPIC_API_KEY: "a", AI_PROVIDER: "openai" }).provider).toBe("anthropic"); // no OpenAI key
    expect(selectProvider({ OPENAI_API_KEY: "o", AI_PROVIDER: "anthropic" }).provider).toBe("openai"); // no Anthropic key
    expect(selectProvider({ ANTHROPIC_API_KEY: "a", ANTHROPIC_MODEL: "claude-haiku-5-5" }).model).toBe("claude-haiku-5-5");
  });

  it("defaultLLM routes to the selected provider's endpoint", async () => {
    process.env.ANTHROPIC_API_KEY = KEY; process.env.OPENAI_API_KEY = "sk-openai-test";
    let s = stubFetch([json(okBody("ok"))]);
    await defaultLLM()(REQ);
    expect(s.calls.map((c) => c.url)).toEqual([ANTHROPIC_URL]);
    delete process.env.ANTHROPIC_API_KEY;
    s = stubFetch([json({ model: "gpt-4o-mini", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 40 } } })]);
    const r = normalizeLLMResult(await defaultLLM()(REQ));
    expect(s.calls.map((c) => c.url)).toEqual(["https://api.openai.com/v1/chat/completions"]);
    expect(r.usage).toEqual({ inputTokens: 60, outputTokens: 10, cacheReadTokens: 40 });
    delete process.env.OPENAI_API_KEY;
    const spy = stubFetch([]);
    expect(normalizeLLMResult(await defaultLLM()(REQ)).model).toBe("offline");
    expect(spy.fn).not.toHaveBeenCalled();
  });

  it("openAiLLM still works as the legacy fallback", async () => {
    stubFetch([json({ choices: [{ message: { content: "La garantía es de 1 año." } }] })]);
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

describe("engine -> Anthropic: no customer PII in the request", () => {
  it("emails, phones, names and order numbers never reach the Anthropic request body", async () => {
    const t = await setupTenant();
    process.env.ANTHROPIC_API_KEY = KEY;
    const { calls } = stubFetch([json(okBody("Claro, con gusto te ayudo.")), json(okBody("La garantía es de 1 año contra defectos de fábrica."))]);
    const meter = fakeMeter();
    await handleInbound(ev(t, "hola, ¿la garantía cubre mi licuadora? escríbeme a juan.perez@gmail.com o al +5215512345678"), deps(meter));
    await handleInbound(ev(t, "¿y cuánto dura la garantía? mi cel 5512345678, correo otra.persona@hotmail.com"), deps(meter));
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.url).toBe(ANTHROPIC_URL);
      expect(c.raw).not.toMatch(/juan\.perez|gmail\.com|otra\.persona|hotmail|5215512345678|5512345678|Juan Pérez/);
      expect(c.raw).toMatch(/\[email\]|\[phone\]/);
      const sys = c.body.system as { text: string; cache_control?: unknown }[];
      expect(sys[0].cache_control).toEqual({ type: "ephemeral" });
      expect(sys[0].text).toMatch(/STRICT RULES/);
      expect(sys[0].text).not.toMatch(/<source id=/); // per-question sources live after the cache breakpoint
      expect(sys[1].text).toMatch(/^<sources>/);
    }
    // Both calls metered on this tenant: input = uncached + cache read + cache write.
    expect(meter.records).toEqual([
      { tenantId: t, requests: 1, inputTokens: 900, outputTokens: 60 },
      { tenantId: t, requests: 1, inputTokens: 900, outputTokens: 60 },
    ]);
  });

  it("validator still guards Anthropic output (invented promo is blocked and handed off)", async () => {
    const t = await setupTenant();
    process.env.ANTHROPIC_API_KEY = KEY;
    stubFetch([json(okBody("La garantía es de 1 año y hoy tienes 20% de descuento con el cupón CHEF20."))]);
    const r = await handleInbound(ev(t, "¿Cuánto dura la garantía?"), deps(fakeMeter()));
    expect(r).toMatchObject({ escalated: true, reason: "no_answer" });
    expect(r.text).not.toMatch(/CHEF20|descuento/);
  });
});

describe("metering", () => {
  it("records cache tokens as input and is tenant-scoped: A's calls are never billed to B", async () => {
    const A = await setupTenant(); const B = await setupTenant();
    const meter = fakeMeter();
    const llm = async () => ({ text: "La garantía es de 1 año contra defectos de fábrica.", model: "claude-haiku-4-5", usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 700, cacheWriteTokens: 10 } });
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
    await recordUsage(dataUsageMeter, A, { text: "x", model: "claude-haiku-4-5", usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100 } }, MONDAY_OPEN);
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
    process.env.ANTHROPIC_API_KEY = KEY;
    const s = stubFetch([]);
    const meter = fakeMeter(); meter.budget.set(t, 0);
    const llm = vi.fn(async () => "no");
    const r = await handleInbound(ev(t, "¿Cuánto dura la garantía?"), deps(meter, { llm }));
    expect(llm).not.toHaveBeenCalled();
    expect(s.fn).not.toHaveBeenCalled();
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
