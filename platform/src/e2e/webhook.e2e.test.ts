// Scenario 5: Meta webhook route handler (real) -> tenant routing -> engine -> sendToCustomer -> Meta Graph (fetch stub).
// OpenAI is also reached through the fetch stub here (the webhook cannot inject an LLM), exercising openAiLLM.
import "./setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("./mocks")).headersMock());
vi.mock("next/cache", async () => (await import("./mocks")).cacheMock());
vi.mock("next/server", async (orig) => (await import("./mocks")).serverMock(await orig()));

import { GET, POST } from "@/app/api/webhooks/meta/route";
import { connectChannel } from "@/app/(app)/channels/actions";
import { getChannelAccount, getOrCreateConversation, listConversations, listMessages, saveChannelAccount } from "@/lib/store";
import { flushAfter } from "./mocks";
import { FB_GRAPH } from "@/lib/channels/graph";
import { asUser, messagingPayload, metaSign, newTenant, seedContext, signedRequest, stubFetch, whatsappPayload, type TestTenant } from "./helpers";

let A: TestTenant, B: TestTenant;
let PHONE_A: string, PHONE_B: string, IG_A: string, PAGE_A: string;
let seq = 0;
const uid = () => `${Date.now()}${++seq}`;

async function post(req: Request) {
  const res = await POST(req);
  await flushAfter();
  return res;
}

beforeEach(async () => {
  A = newTenant("Chefman");
  B = newTenant("Otra marca");
  PHONE_A = `1000${uid()}`; PHONE_B = `2000${uid()}`; IG_A = `1784${uid()}`; PAGE_A = `3000${uid()}`;
  seedContext(A.tenantId);
  seedContext(B.tenantId);
  // Tenant A connects WhatsApp through the real Channels server action (same as the UI form; it tests the token on Graph)
  stubFetch();
  asUser(A);
  expect(await connectChannel("whatsapp", { externalId: PHONE_A, accessToken: "EAAG-token-A-123456", wabaId: "WABA_A", displayName: "Chefman MX" })).toEqual({ ok: true, name: "Chefman MX" });
  // Instagram through the linked Facebook Page: a Page token (EAA...). "IG..." tokens go to graph.instagram.com instead.
  expect(await connectChannel("instagram", { externalId: IG_A, accessToken: "EAAI-token-A-123456" })).toEqual({ ok: true, name: "Chefman MX" });
  expect(await connectChannel("messenger", { externalId: PAGE_A, accessToken: "EAAP-token-A-123456" })).toEqual({ ok: true, name: "Chefman MX" });
  asUser(null);
  saveChannelAccount(B.tenantId, "whatsapp", { status: "connected", secrets: { phoneNumberId: PHONE_B, accessToken: "EAAG-token-B-123456" }, publicInfo: { externalId: PHONE_B } });
  process.env.OPENAI_API_KEY = "sk-test-not-real";
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.OPENAI_API_KEY; });

describe("scenario 5: Meta webhook", () => {
  it("GET verify handshake echoes the challenge only with the right token", async () => {
    const ok = await GET(new Request("https://inbox.test/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=e2e-verify-token&hub.challenge=12345"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("12345");
    const bad = await GET(new Request("https://inbox.test/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345"));
    expect(bad.status).toBe(403);
  });

  it("channels action stores publicInfo.externalId the way webhook routing expects", () => {
    expect(getChannelAccount(A.tenantId, "whatsapp").publicInfo.externalId).toBe(PHONE_A);
  });

  it("WhatsApp: signed payload -> 200, routed to the right tenant, OpenAI + Graph called, reply sent to wa_id", async () => {
    const net = stubFetch({ openaiReply: "Todos los productos Chefman tienen garantía de 1 año contra defectos de fábrica." });
    const res = await post(signedRequest(whatsappPayload({ phoneNumberId: PHONE_A, from: "5215511110000", text: "¿Cuánto dura la garantía?", id: `wamid.${uid()}` })));
    expect(res.status).toBe(200);

    const convA = listConversations(A.tenantId, { channel: "whatsapp" });
    expect(convA).toHaveLength(1);
    expect(convA[0]).toMatchObject({ externalId: "5215511110000", customerName: "Juan Pérez" });
    expect(listConversations(B.tenantId)).toHaveLength(0);

    expect(net.openai()).toHaveLength(1);
    const oa = net.openai()[0].body as { messages: { content: string }[] };
    expect(JSON.stringify(oa)).not.toMatch(/Juan Pérez/);
    const g = net.graph();
    expect(g).toHaveLength(1);
    expect(g[0].url).toBe(`${FB_GRAPH}/${PHONE_A}/messages`);
    expect(g[0].headers.authorization).toBe("Bearer EAAG-token-A-123456");
    expect(g[0].body).toMatchObject({ to: "5215511110000", text: { body: expect.stringMatching(/1 año/) } });
  });

  it("routes by phone_number_id: tenant B's number lands in tenant B only", async () => {
    const net = stubFetch({ openaiReply: "Los envíos tardan de 3 a 5 días hábiles a todo México." });
    const res = await post(signedRequest(whatsappPayload({ phoneNumberId: PHONE_B, from: "5215522220000", text: "¿Cuánto tardan los envíos?", id: `wamid.${uid()}` })));
    expect(res.status).toBe(200);
    expect(listConversations(B.tenantId)).toHaveLength(1);
    expect(listConversations(A.tenantId)).toHaveLength(0);
    expect(net.graph()[0].headers.authorization).toBe("Bearer EAAG-token-B-123456");
  });

  it("unknown account id: 200 but nothing stored or sent", async () => {
    const net = stubFetch();
    const res = await post(signedRequest(whatsappPayload({ phoneNumberId: "999999", from: "5215533330000", text: "hola", id: `wamid.${uid()}` })));
    expect(res.status).toBe(200);
    expect(listConversations(A.tenantId)).toHaveLength(0);
    expect(net.calls).toHaveLength(0);
  });

  it("Instagram and Messenger payloads route by entry.id; IG replies via /me/messages, Messenger via /{page-id}/messages", async () => {
    const net = stubFetch();
    const ig = await post(signedRequest(messagingPayload({ object: "instagram", accountId: IG_A, sender: "IGSID-777", text: "hola", mid: `aWdfZ${uid()}` })));
    const fb = await post(signedRequest(messagingPayload({ object: "page", accountId: PAGE_A, sender: "PSID-888", text: "quiero hablar con una persona", mid: `m_${uid()}` })));
    expect([ig.status, fb.status]).toEqual([200, 200]);
    expect(listConversations(A.tenantId, { channel: "instagram" })[0].externalId).toBe("IGSID-777");
    const fbConv = listConversations(A.tenantId, { channel: "messenger" })[0];
    expect(fbConv).toMatchObject({ externalId: "PSID-888", status: "needs_human", escalationReason: "human_request" });
    const g = net.graph();
    expect(g).toHaveLength(2);
    expect(g.map((c) => c.url)).toEqual([`${FB_GRAPH}/me/messages`, `${FB_GRAPH}/${PAGE_A}/messages`]);
    expect(g[0]).toMatchObject({ headers: { authorization: "Bearer EAAI-token-A-123456" }, body: { recipient: { id: "IGSID-777" }, messaging_type: "RESPONSE" } });
    expect(g[1]).toMatchObject({ headers: { authorization: "Bearer EAAP-token-A-123456" }, body: { recipient: { id: "PSID-888" }, messaging_type: "RESPONSE" } });
  });

  it("echo of our own Instagram message is ignored", async () => {
    const net = stubFetch();
    await post(signedRequest(messagingPayload({ object: "instagram", accountId: IG_A, sender: "IGSID-777", text: "respuesta del bot", mid: `echo${uid()}`, echo: true })));
    expect(listConversations(A.tenantId)).toHaveLength(0);
    expect(net.calls).toHaveLength(0);
  });

  it("duplicate delivery of the same message id -> ONE inbound row and ONE reply (sequential and concurrent)", async () => {
    const net = stubFetch({ openaiReply: "Todos los productos Chefman tienen garantía de 1 año contra defectos de fábrica." });
    const payload = whatsappPayload({ phoneNumberId: PHONE_A, from: "5215544440000", text: "¿Cuánto dura la garantía?", id: `wamid.dup${uid()}` });
    expect((await post(signedRequest(payload))).status).toBe(200);
    expect((await post(signedRequest(payload))).status).toBe(200);
    // Meta retry storm: two deliveries processed in parallel
    const p2 = whatsappPayload({ phoneNumberId: PHONE_A, from: "5215544440000", text: "¿Cuánto tardan los envíos?", id: `wamid.dup${uid()}` });
    await Promise.all([POST(signedRequest(p2)), POST(signedRequest(p2))]);
    await flushAfter();
    const conv = getOrCreateConversation(A.tenantId, "whatsapp", "5215544440000");
    const msgs = listMessages(A.tenantId, conv.id);
    expect(msgs.filter((m) => m.direction === "in")).toHaveLength(2);
    expect(msgs.filter((m) => m.sender === "bot")).toHaveLength(2);
    expect(net.graph()).toHaveLength(2);
  });

  it("bad / missing signature -> 403 and nothing is processed", async () => {
    const net = stubFetch();
    const payload = whatsappPayload({ phoneNumberId: PHONE_A, from: "5215555550000", text: "hola", id: `wamid.${uid()}` });
    const bad = await post(signedRequest(payload, { signature: "sha256=" + "0".repeat(64) }));
    const wrongSecret = await post(signedRequest(payload, { signature: metaSign(JSON.stringify(payload), "other-secret") }));
    const missing = await post(signedRequest(payload, { signature: null }));
    expect([bad.status, wrongSecret.status, missing.status]).toEqual([403, 403, 403]);
    expect(listConversations(A.tenantId)).toHaveLength(0);
    expect(net.calls).toHaveLength(0);
  });

  it("fail closed: no META_APP_SECRET -> unsigned posts rejected, even with ALLOW_UNSIGNED_WEBHOOKS=1 behind a public URL", async () => {
    const net = stubFetch();
    const saved = process.env.META_APP_SECRET;
    delete process.env.META_APP_SECRET;
    process.env.ALLOW_UNSIGNED_WEBHOOKS = "1"; // PUBLIC_URL is https://inbox.test (not local) -> flag must be ignored
    try {
      const res = await post(signedRequest(whatsappPayload({ phoneNumberId: PHONE_A, from: "5215566660000", text: "quiero hablar con una persona", id: `wamid.${uid()}` }), { signature: null }));
      expect(res.status).toBe(403);
      expect(listConversations(A.tenantId)).toHaveLength(0);
      expect(net.calls).toHaveLength(0);
    } finally { process.env.META_APP_SECRET = saved; delete process.env.ALLOW_UNSIGNED_WEBHOOKS; }
  });

  it("malformed JSON with a valid signature -> 400", async () => {
    const raw = "{not json";
    const res = await POST(new Request("https://inbox.test/api/webhooks/meta", { method: "POST", headers: { "x-hub-signature-256": metaSign(raw) }, body: raw }));
    expect(res.status).toBe(400);
  });
});
