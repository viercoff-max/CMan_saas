// sendToCustomer Telegram branch: plain-text sendMessage, 4096-char split, error mapping, never throws (fetch mocked).
import "./env-secrets"; // temp SQLite + DATA_DIR + test APP_SECRET
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveChannelForTest } from "../../data/__tests__/fixtures";
import { getData } from "../../data";
import { sendToCustomer } from "../send";
import { isWindowExpired } from "../repo";
import { TELEGRAM_API } from "../telegram";
import { classifySendError } from "@/app/(app)/inbox/send-errors";

const uid = () => randomUUID().replace(/-/g, "").slice(0, 10);
const tokenFor = (t: string) => `${String(Date.now()).slice(-9)}:AAH${t.padEnd(32, "x")}`;

type Call = { url: string; body: Record<string, unknown> };
function stub(...responses: [number, unknown][]) {
  const calls: Call[] = [];
  let i = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const [status, payload] = responses[Math.min(i++, responses.length - 1)] ?? [200, { ok: true, result: { message_id: 1 } }];
    return new Response(JSON.stringify(payload), { status });
  }));
  return calls;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function setup() {
  const t = `t-${uid()}`;
  const botToken = tokenFor(t);
  await saveChannelForTest(t, "telegram", { status: "connected", secrets: { botToken, webhookSecret: "sec_ret" }, publicInfo: { externalId: `b${uid()}`, displayName: "@Bot" } });
  const conv = await getData().conversations.getOrCreate(t, "telegram", "9001", "Ana");
  return { t, conv, botToken };
}

describe("sendToCustomer: Telegram", () => {
  it("POSTs sendMessage with chat_id + text only (no parse_mode)", async () => {
    const { t, conv, botToken } = await setup();
    const calls = stub([200, { ok: true, result: { message_id: 1 } }]);
    expect(await sendToCustomer(t, conv, "Hola *Ana* <b>x</b>")).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${TELEGRAM_API}/bot${botToken}/sendMessage`);
    expect(calls[0].body).toEqual({ chat_id: "9001", text: "Hola *Ana* <b>x</b>" });
  });
  it("splits replies longer than 4096 characters", async () => {
    const { t, conv } = await setup();
    const calls = stub([200, { ok: true, result: {} }]);
    const text = Array.from({ length: 600 }, (_, i) => `Frase número ${i}.`).join(" ");
    expect(text.length).toBeGreaterThan(4096);
    expect(await sendToCustomer(t, conv, text)).toEqual({ ok: true });
    expect(calls.length).toBeGreaterThan(1);
    for (const c of calls) expect(String(c.body.text).length).toBeLessThanOrEqual(4096);
    expect(calls.map((c) => c.body.text).join(" ")).toBe(text);
  });
  it("maps Telegram errors to inbox-friendly reasons and never throws", async () => {
    const { t, conv, botToken } = await setup();
    stub([401, { ok: false, error_code: 401, description: "Unauthorized" }]);
    const bad = await sendToCustomer(t, conv, "hola");
    expect(bad).toEqual({ ok: false, error: "telegram_token_invalid (http 401)" });
    expect(classifySendError(bad.error)).toBe("e.token");
    expect(JSON.stringify(bad)).not.toContain(botToken);

    stub([403, { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }]);
    expect(await sendToCustomer(t, conv, "hola")).toEqual({ ok: false, error: "telegram_bot_blocked_by_user (http 403)" });

    stub([429, { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 30 } }]);
    expect(await sendToCustomer(t, conv, "hola")).toEqual({ ok: false, error: "rate_limited retry_after=30s (http 429)" });

    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("socket hang up"))));
    const net = await sendToCustomer(t, conv, "hola");
    expect(net).toEqual({ ok: false, error: "network_error" });
    expect(classifySendError(net.error)).toBe("e.network");
  });
  it("retries once when Telegram asks to wait a short moment", async () => {
    const { t, conv } = await setup();
    vi.useFakeTimers();
    const calls = stub([429, { ok: false, error_code: 429, parameters: { retry_after: 1 } }], [200, { ok: true, result: {} }]);
    const p = sendToCustomer(t, conv, "hola");
    await vi.advanceTimersByTimeAsync(1100);
    expect(await p).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });
  it("refuses when not connected or token missing; no network call", async () => {
    const t = `t-${uid()}`;
    const conv = await getData().conversations.getOrCreate(t, "telegram", "1", "");
    const calls = stub();
    expect(await sendToCustomer(t, conv, "hola")).toEqual({ ok: false, error: "channel_not_connected" });
    await saveChannelForTest(t, "telegram", { status: "connected", publicInfo: { externalId: `b${uid()}` } });
    expect(await sendToCustomer(t, conv, "hola")).toEqual({ ok: false, error: "missing_token" });
    expect(calls).toHaveLength(0);
  });
  it("cross-tenant: tenant B's conversation is never sent with tenant A's bot", async () => {
    const a = await setup();
    const tB = `t-${uid()}`;
    const convB = await getData().conversations.getOrCreate(tB, "telegram", "9001", "Ana");
    const calls = stub();
    expect(await sendToCustomer(tB, convB, "hola")).toEqual({ ok: false, error: "channel_not_connected" });
    expect(calls.some((c) => c.url.includes(a.botToken))).toBe(false);
  });
  it("has no 24 h window (agents can always reply)", () => {
    expect(isWindowExpired("telegram", null)).toBe(false);
    expect(isWindowExpired("telegram", new Date(Date.now() - 30 * 86400_000).toISOString())).toBe(false);
    expect(isWindowExpired("whatsapp", new Date(Date.now() - 30 * 86400_000).toISOString())).toBe(true);
  });
});
