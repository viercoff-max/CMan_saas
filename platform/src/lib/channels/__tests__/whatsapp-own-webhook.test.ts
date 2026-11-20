// WhatsApp with the business's OWN Meta app: /api/webhooks/whatsapp/<webhookId> (real handler) -> handshake with the
// tenant's verify token, HMAC with the tenant's App Secret -> engine -> sendToCustomer -> Graph /messages (fetch mocked).
import "@/e2e/setup";
import { createHmac, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("@/e2e/mocks")).headersMock());
vi.mock("next/cache", async () => (await import("@/e2e/mocks")).cacheMock());
vi.mock("next/server", async (orig) => (await import("@/e2e/mocks")).serverMock(await orig()));

import { GET, POST } from "@/app/api/webhooks/whatsapp/[webhookId]/route";
import { flushAfter } from "@/e2e/mocks";
import { newTenant, seedContext, type TestTenant } from "@/e2e/helpers";
import { saveChannelForTest } from "@/lib/data/__tests__/fixtures";
import { getData } from "@/lib/data";
import { newWhatsAppVerifyToken, tokenMatches, whatsappWebhookUrl } from "@/lib/channels/whatsapp-own";

interface Biz { tenant: TestTenant; phoneId: string; appSecret: string; verifyToken: string; webhookId: string }
let A: Biz, B: Biz;
let seq = 0;

async function connect(name: string, own = true): Promise<Biz> {
  const tenant = await newTenant(name);
  await seedContext(tenant.tenantId);
  const phoneId = `10${Date.now() % 1_000_000}${++seq}`;
  const appSecret = randomBytes(16).toString("hex");
  const verifyToken = newWhatsAppVerifyToken();
  await saveChannelForTest(tenant.tenantId, "whatsapp", {
    status: "connected",
    secrets: own ? { phoneNumberId: phoneId, accessToken: `EAA${name}token`, wabaId: "200300", appSecret, verifyToken } : { phoneNumberId: phoneId, accessToken: `EAA${name}token`, wabaId: "200300" },
    publicInfo: { externalId: phoneId, displayName: name, mode: own ? "own_app" : "platform", webhook: "pending" },
  });
  const webhookId = (await getData().channels.get(tenant.tenantId, "whatsapp")).webhookId!;
  return { tenant, phoneId, appSecret, verifyToken, webhookId };
}

type Sent = { url: string; auth: string; body: Record<string, unknown> };
function stubGraph() {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
    if (!/^https:\/\/graph\.facebook\.com\/v\d+\.0\/[^/]+\/messages$/.test(String(input))) throw new Error("unexpected network call in test");
    sent.push({ url: String(input), auth: String((init.headers as Record<string, string>).authorization ?? ""), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }), { status: 200 });
  }));
  return sent;
}

let mid = 0;
const payload = (phoneId: string, text = "cuanto dura la garantia", from = "5215512345678") => ({
  object: "whatsapp_business_account",
  entry: [{ id: "200300", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp", metadata: { display_phone_number: "5215500000000", phone_number_id: phoneId },
    contacts: [{ wa_id: from, profile: { name: "Ana" } }],
    messages: [{ from, id: `wamid.in.${++mid}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
  } }] }],
});
const sign = (raw: string, secret: string) => `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`;
async function post(webhookId: string, body: unknown, signature: string | null, raw = JSON.stringify(body)) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["x-hub-signature-256"] = signature;
  const res = await POST(new Request(`https://inbox.test/api/webhooks/whatsapp/${webhookId}`, { method: "POST", headers, body: raw }), { params: Promise.resolve({ webhookId }) });
  await flushAfter();
  return res;
}
async function handshake(webhookId: string, token: string, challenge = "1158201444") {
  const u = `https://inbox.test/api/webhooks/whatsapp/${webhookId}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=${challenge}`;
  return GET(new Request(u), { params: Promise.resolve({ webhookId }) });
}
const waConvs = async (t: TestTenant) => (await getData().conversations.list(t.tenantId)).filter((c) => c.channel === "whatsapp");

beforeEach(async () => { A = await connect("TiendaA"); B = await connect("TiendaB"); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("WhatsApp own-app webhook: handshake", () => {
  it("echoes the challenge only with the tenant's verify token, and marks the webhook verified", async () => {
    expect((await handshake(A.webhookId, "wrong-token")).status).toBe(403);
    expect((await getData().channels.get(A.tenant.tenantId, "whatsapp")).publicInfo.webhook).toBe("pending");
    const ok = await handshake(A.webhookId, A.verifyToken);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("1158201444");
    expect((await getData().channels.get(A.tenant.tenantId, "whatsapp")).publicInfo.webhook).toBe("ok");
  });

  it("cross-tenant: B's verify token does not open A's webhook", async () => {
    expect((await handshake(A.webhookId, B.verifyToken)).status).toBe(403);
  });

  it("unknown id, malformed id and platform-mode connections are refused", async () => {
    expect((await handshake("00000000-0000-4000-8000-000000000000", A.verifyToken)).status).toBe(403);
    expect((await handshake("../etc", A.verifyToken)).status).toBe(403);
    const P = await connect("Plataforma", false);
    expect((await handshake(P.webhookId, "anything")).status).toBe(403);
  });
});

describe("WhatsApp own-app webhook: messages", () => {
  it("a message signed with the tenant's App Secret is answered on WhatsApp with the tenant's token", async () => {
    const sent = stubGraph();
    const body = payload(A.phoneId);
    const raw = JSON.stringify(body);
    expect((await post(A.webhookId, body, sign(raw, A.appSecret), raw)).status).toBe(200);
    const convs = await waConvs(A.tenant);
    expect(convs).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toContain(`/${A.phoneId}/messages`);
    expect(sent[0].auth).toBe("Bearer EAATiendaAtoken");
    expect(sent[0].body).toMatchObject({ messaging_product: "whatsapp", to: "5215512345678", type: "text" });
  });

  it("missing or wrong signature: 403 and nothing stored", async () => {
    const sent = stubGraph();
    const body = payload(A.phoneId);
    expect((await post(A.webhookId, body, null)).status).toBe(403);
    expect((await post(A.webhookId, body, sign(JSON.stringify(body), "0".repeat(32)))).status).toBe(403);
    expect((await post(A.webhookId, body, sign(JSON.stringify(body) + " ", A.appSecret))).status).toBe(403); // not the raw body
    expect(await waConvs(A.tenant)).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("cross-tenant: B's App Secret cannot post into A, and A's signed payload for B's number is ignored", async () => {
    const sent = stubGraph();
    const forA = payload(A.phoneId);
    const rawA = JSON.stringify(forA);
    expect((await post(A.webhookId, forA, sign(rawA, B.appSecret), rawA)).status).toBe(403);
    const forB = payload(B.phoneId);
    const rawB = JSON.stringify(forB);
    expect((await post(A.webhookId, forB, sign(rawB, A.appSecret), rawB)).status).toBe(200); // valid signature...
    expect(await waConvs(A.tenant)).toHaveLength(0); // ...but not A's number: ignored
    expect(await waConvs(B.tenant)).toHaveLength(0); // and never routed to B
    expect(sent).toHaveLength(0);
  });

  it("a disconnected channel is refused", async () => {
    await getData().channels.save(A.tenant.tenantId, "whatsapp", { status: "disconnected", publicInfo: {} });
    const body = payload(A.phoneId);
    const raw = JSON.stringify(body);
    expect((await post(A.webhookId, body, sign(raw, A.appSecret), raw)).status).toBe(403);
  });
});

describe("whatsapp-own helpers", () => {
  it("token compare is exact and rejects empty values", () => {
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abc", "abd")).toBe(false);
    expect(tokenMatches("", "")).toBe(false);
    expect(tokenMatches("abc", null)).toBe(false);
  });
  it("webhook URL is built from PUBLIC_URL and the routing id", () => {
    expect(whatsappWebhookUrl("https://app.example/", "abc-123")).toBe("https://app.example/api/webhooks/whatsapp/abc-123");
    expect(whatsappWebhookUrl("https://app.example", null)).toBe("");
  });
});
