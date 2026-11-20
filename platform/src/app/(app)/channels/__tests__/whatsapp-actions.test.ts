// WhatsApp connect (server action, REAL auth + SQLite e2e harness, Graph mocked): manual own-app mode needs a valid App
// Secret while the platform Meta app is not configured; the verify token is generated once and kept on reconnect.
import "@/e2e/setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("@/e2e/mocks")).headersMock());
vi.mock("next/cache", async () => (await import("@/e2e/mocks")).cacheMock());

import { getData } from "@/lib/data";
import { asUser, newTenant, type TestTenant } from "@/e2e/helpers";
import { connectChannel } from "../actions";
import type { WhatsAppChannelSecrets } from "@/lib/channels/whatsapp-own";

let seq = 0;
function stubGraph() {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://graph.facebook.com/")) throw new Error("unexpected network call");
    calls.push(`${init.method ?? "GET"} ${url.replace(/\?.*$/, "")}`);
    if (url.includes("subscribed_apps")) return new Response(JSON.stringify({ success: true }), { status: 200 });
    if (url.includes("verified_name")) return new Response(JSON.stringify({ verified_name: "Tienda Prueba", display_phone_number: "+52 55 0000 0000" }), { status: 200 });
    return new Response(JSON.stringify({ name: "Cuenta WA" }), { status: 200 });
  }));
  return calls;
}
const SECRET = "0123456789abcdef0123456789abcdef";
const input = (o: Partial<{ externalId: string; wabaId: string; accessToken: string; appSecret: string }> = {}) =>
  ({ externalId: `1065${++seq}0001`, wabaId: "2003004005", accessToken: "EAAtesttoken123456", appSecret: SECRET, ...o });

let A: TestTenant;
const env = { s: process.env.META_APP_SECRET, v: process.env.META_VERIFY_TOKEN };
beforeEach(async () => { A = await newTenant("TiendaWA"); delete process.env.META_APP_SECRET; delete process.env.META_VERIFY_TOKEN; });
afterEach(() => {
  asUser(null); vi.unstubAllGlobals();
  if (env.s === undefined) delete process.env.META_APP_SECRET; else process.env.META_APP_SECRET = env.s;
  if (env.v === undefined) delete process.env.META_VERIFY_TOKEN; else process.env.META_VERIFY_TOKEN = env.v;
});

describe("connectChannel('whatsapp') own-app mode", () => {
  it("tests the number + account, subscribes the app, stores secrets encrypted and a generated verify token", async () => {
    const calls = stubGraph();
    asUser(A);
    const i = input();
    const r = await connectChannel("whatsapp", i);
    expect(r).toEqual({ ok: true, name: "Tienda Prueba" });
    expect(calls.some((c) => c.startsWith("POST") && c.endsWith("/2003004005/subscribed_apps"))).toBe(true);
    const acc = await getData().channels.get(A.tenantId, "whatsapp");
    expect(acc.publicInfo).toMatchObject({ mode: "own_app", webhook: "pending", externalId: i.externalId });
    expect(JSON.stringify(acc.publicInfo)).not.toContain(SECRET);
    expect(JSON.stringify(acc.publicInfo)).not.toContain(i.accessToken);
    const sec = await getData().secrets.get<WhatsAppChannelSecrets>(A.tenantId, "channel", "whatsapp");
    expect(sec).toMatchObject({ phoneNumberId: i.externalId, accessToken: i.accessToken, wabaId: "2003004005", appSecret: SECRET });
    expect(sec?.verifyToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("reconnecting keeps the verify token already pasted in Meta", async () => {
    stubGraph();
    asUser(A);
    await connectChannel("whatsapp", input());
    const first = (await getData().secrets.get<WhatsAppChannelSecrets>(A.tenantId, "channel", "whatsapp"))?.verifyToken;
    await connectChannel("whatsapp", input({ accessToken: "EAAnewtoken987654" }));
    const sec = await getData().secrets.get<WhatsAppChannelSecrets>(A.tenantId, "channel", "whatsapp");
    expect(sec?.verifyToken).toBe(first);
    expect(sec?.accessToken).toBe("EAAnewtoken987654");
  });

  it("without the platform Meta app, the App Secret is required and must look like one (no Graph call)", async () => {
    const calls = stubGraph();
    asUser(A);
    expect(await connectChannel("whatsapp", input({ appSecret: "" }))).toEqual({ ok: false, error: "app_secret" });
    expect(await connectChannel("whatsapp", input({ appSecret: "not-a-secret!" }))).toEqual({ ok: false, error: "app_secret" });
    expect(calls).toHaveLength(0);
    expect((await getData().channels.get(A.tenantId, "whatsapp")).status).not.toBe("connected");
  });

  it("with the platform Meta app configured, an empty App Secret means platform mode", async () => {
    process.env.META_APP_SECRET = "platformsecret";
    process.env.META_VERIFY_TOKEN = "platformverify";
    stubGraph();
    asUser(A);
    expect((await connectChannel("whatsapp", input({ appSecret: "" }))).ok).toBe(true);
    expect((await getData().channels.get(A.tenantId, "whatsapp")).publicInfo).toMatchObject({ mode: "platform" });
    const sec = await getData().secrets.get<WhatsAppChannelSecrets>(A.tenantId, "channel", "whatsapp");
    expect(sec?.appSecret).toBeUndefined();
    expect(sec?.verifyToken).toBeUndefined();
  });
});
