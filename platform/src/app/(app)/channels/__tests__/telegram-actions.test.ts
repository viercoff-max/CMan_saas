// Telegram connect / re-register / disconnect server actions with the REAL auth.ts + SQLite (e2e harness) and a mocked
// Telegram Bot API (no network).
import "@/e2e/setup";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("@/e2e/mocks")).headersMock());
vi.mock("next/cache", async () => (await import("@/e2e/mocks")).cacheMock());

import { getDb } from "@/lib/db";
import { sign } from "@/lib/crypto";
import { hashPassword } from "@/lib/auth";
import { getData } from "@/lib/data";
import { asUser, newTenant, type TestTenant } from "@/e2e/helpers";
import { connectTelegram, disconnectTelegram, reregisterTelegramWebhook } from "../actions";
import type { TelegramChannelSecrets } from "@/lib/channels/telegram-secret";

let seq = 0;
const newToken = () => `${700000000 + (++seq) + Math.floor(Math.random() * 1000) * 1000}:AAH${randomUUID().replace(/-/g, "")}`;
const botId = (t: string) => t.split(":")[0];

type Call = { method: string; token: string; body: Record<string, unknown> };
const log: string[] = [];
function stubTelegram(o: { getMe?: [number, unknown]; setWebhook?: [number, unknown] } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
    const m = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/.exec(String(input));
    if (!m) throw new Error(`unexpected network call: ${String(input).slice(0, 30)}`);
    const [, token, method] = m;
    calls.push({ method, token, body: JSON.parse(String(init.body ?? "{}")) });
    log.push(`tg:${method}`);
    const reply = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s });
    if (method === "getMe") return reply(...(o.getMe ?? [200, { ok: true, result: { id: Number(botId(token)), is_bot: true, first_name: "Ayuda", username: `Bot${botId(token)}bot` } }]));
    if (method === "setWebhook") return reply(...(o.setWebhook ?? [200, { ok: true, result: true }]));
    return reply(200, { ok: true, result: true });
  }));
  return calls;
}

async function addAgent(tenantId: string): Promise<TestTenant> {
  const userId = randomUUID();
  getDb().prepare("INSERT INTO users (id, tenant_id, email, name, password_hash, role) VALUES (?,?,?,?,?,?)")
    .run(userId, tenantId, `agent-${userId}@example.test`, "agent", hashPassword("not-a-real-password"), "agent");
  const payload = `${userId}.${tenantId}.${Date.now() + 3_600_000}`;
  return { tenantId, userId, cookie: `${payload}.${sign(payload)}` };
}

let A: TestTenant;
beforeEach(async () => { A = await newTenant("Chefman"); log.length = 0; process.env.PUBLIC_URL = "https://inbox.test"; });
afterEach(() => { asUser(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); process.env.PUBLIC_URL = "https://inbox.test"; });

describe("connectTelegram", () => {
  it("getMe -> channels.save -> secrets.set -> setWebhook, in that order, with the right params", async () => {
    const data = getData();
    // Pass-through spies that record the call order.
    const origSave = data.channels.save.bind(data.channels);
    const origSet = data.secrets.set.bind(data.secrets);
    vi.spyOn(data.channels, "save").mockImplementation(async (...a) => { log.push("channels.save"); return origSave(...a); });
    vi.spyOn(data.secrets, "set").mockImplementation(async (...a) => { log.push("secrets.set"); return origSet(...a); });

    const token = newToken();
    const calls = stubTelegram();
    asUser(A);
    const r = await connectTelegram({ botToken: `  ${token}  ` });
    expect(r).toEqual({ ok: true, username: `Bot${botId(token)}bot`, webhook: "ok" });
    expect(log.slice(0, 4)).toEqual(["tg:getMe", "channels.save", "secrets.set", "tg:setWebhook"]);

    const acc = await data.channels.get(A.tenantId, "telegram");
    expect(acc.status).toBe("connected");
    expect(acc.publicInfo).toMatchObject({ externalId: botId(token), displayName: `@Bot${botId(token)}bot`, webhook: "ok" });
    expect(JSON.stringify(acc.publicInfo)).not.toContain(token);
    const sec = await data.secrets.get<TelegramChannelSecrets>(A.tenantId, "channel", "telegram");
    expect(sec?.botToken).toBe(token);
    expect(sec?.webhookSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const sw = calls.find((c) => c.method === "setWebhook")!;
    expect(sw.token).toBe(token);
    expect(sw.body).toEqual({
      url: `https://inbox.test/api/webhooks/telegram/${acc.webhookId}`,
      secret_token: sec?.webhookSecret, allowed_updates: ["message", "edited_message"], drop_pending_updates: true,
    });
    expect(acc.webhookId).toBeTruthy();
  });

  it("rejects a malformed token without calling Telegram", async () => {
    const calls = stubTelegram();
    asUser(A);
    expect(await connectTelegram({ botToken: "not-a-token" })).toEqual({ ok: false, error: "invalid" });
    expect(await connectTelegram({})).toEqual({ ok: false, error: "invalid" });
    expect(calls).toHaveLength(0);
    expect((await getData().channels.get(A.tenantId, "telegram")).status).toBe("disconnected");
  });

  it("a token Telegram rejects stores nothing", async () => {
    stubTelegram({ getMe: [401, { ok: false, error_code: 401, description: "Unauthorized" }] });
    asUser(A);
    expect(await connectTelegram({ botToken: newToken() })).toEqual({ ok: false, error: "token" });
    expect((await getData().channels.get(A.tenantId, "telegram")).status).toBe("disconnected");
    expect(await getData().secrets.get(A.tenantId, "channel", "telegram")).toBeNull();
  });

  it("a bot already connected to another brand -> in_use, and B's token is NOT stored", async () => {
    const token = newToken();
    stubTelegram();
    asUser(A);
    expect((await connectTelegram({ botToken: token })).ok).toBe(true);
    const B = await newTenant("Otra marca");
    asUser(B);
    expect(await connectTelegram({ botToken: token })).toEqual({ ok: false, error: "in_use" });
    expect((await getData().channels.get(B.tenantId, "telegram")).status).not.toBe("connected");
    expect(await getData().secrets.get(B.tenantId, "channel", "telegram")).toBeNull();
    // A is untouched
    expect((await getData().secrets.get<TelegramChannelSecrets>(A.tenantId, "channel", "telegram"))?.botToken).toBe(token);
  });

  it("PUBLIC_URL that is not public HTTPS: saved, no setWebhook, warning state; re-register later works", async () => {
    process.env.PUBLIC_URL = "http://localhost:3000";
    const calls = stubTelegram();
    asUser(A);
    const r = await connectTelegram({ botToken: newToken() });
    expect(r).toMatchObject({ ok: true, webhook: "needs_https" });
    expect(calls.map((c) => c.method)).toEqual(["getMe"]);
    expect((await getData().channels.get(A.tenantId, "telegram")).publicInfo.webhook).toBe("needs_https");

    process.env.PUBLIC_URL = "https://tunnel.example.com";
    const before = (await getData().secrets.get<TelegramChannelSecrets>(A.tenantId, "channel", "telegram"))!.webhookSecret;
    expect(await reregisterTelegramWebhook()).toEqual({ ok: true, webhook: "ok" });
    const after = (await getData().secrets.get<TelegramChannelSecrets>(A.tenantId, "channel", "telegram"))!.webhookSecret;
    expect(after).not.toBe(before); // rotated
    const sw = calls.find((c) => c.method === "setWebhook")!;
    expect(String(sw.body.url)).toMatch(/^https:\/\/tunnel\.example\.com\/api\/webhooks\/telegram\//);
    expect(sw.body.secret_token).toBe(after);
    expect((await getData().channels.get(A.tenantId, "telegram")).publicInfo.webhook).toBe("ok");
  });

  it("setWebhook failure keeps the bot connected with a 'failed' webhook state", async () => {
    stubTelegram({ setWebhook: [400, { ok: false, error_code: 400, description: "Bad Request: bad webhook" }] });
    asUser(A);
    expect(await connectTelegram({ botToken: newToken() })).toMatchObject({ ok: true, webhook: "failed" });
    expect((await getData().channels.get(A.tenantId, "telegram")).publicInfo.webhook).toBe("failed");
  });

  it("switching bots deletes the old bot's webhook", async () => {
    const calls = stubTelegram();
    asUser(A);
    const old = newToken(), next = newToken();
    await connectTelegram({ botToken: old });
    await connectTelegram({ botToken: next });
    expect(calls.some((c) => c.method === "deleteWebhook" && c.token === old)).toBe(true);
  });

  it("agent role gets 403 on connect, re-register and disconnect; nothing is written or called", async () => {
    const calls = stubTelegram();
    asUser(await addAgent(A.tenantId));
    for (const p of [connectTelegram({ botToken: newToken() }), reregisterTelegramWebhook(), disconnectTelegram()]) {
      const e = await p.then(() => null, (err) => err);
      expect(e).toBeInstanceOf(Response);
      expect((e as Response).status).toBe(403);
    }
    expect(calls).toHaveLength(0);
    expect((await getData().channels.get(A.tenantId, "telegram")).status).toBe("disconnected");
  });

  it("no session -> auth error", async () => {
    asUser(null);
    expect(await connectTelegram({ botToken: newToken() })).toEqual({ ok: false, error: "auth" });
  });
});

describe("disconnectTelegram", () => {
  it("deleteWebhook, clears secrets, marks disconnected (webhook routing stops)", async () => {
    const calls = stubTelegram();
    asUser(A);
    const token = newToken();
    await connectTelegram({ botToken: token });
    const webhookId = (await getData().channels.get(A.tenantId, "telegram")).webhookId!;
    expect(await getData().channels.findByWebhookId("telegram", webhookId)).toEqual({ tenantId: A.tenantId, channel: "telegram" });
    expect(await disconnectTelegram()).toEqual({ ok: true });
    expect(calls.at(-1)).toMatchObject({ method: "deleteWebhook", token });
    expect(await getData().secrets.get(A.tenantId, "channel", "telegram")).toBeNull();
    expect((await getData().channels.get(A.tenantId, "telegram")).status).toBe("disconnected");
    expect(await getData().channels.findByWebhookId("telegram", webhookId)).toBeNull();
  });
});
