// ManyChat integration through the real handlers (SQLite e2e harness, network mocked):
//  - POST /api/integrations/manychat/<id>: token auth fails closed; a valid call answers synchronously (reply,
//    needs_human, Dynamic Block v2) and stores the conversation in the inbox (channel "manychat");
//  - safety escalation -> needs_human; a human-owned conversation -> empty reply, needs_human;
//  - an inbox reply goes out through ManyChat sendContent with the tenant's API key and the right content type;
//  - cross-tenant negatives: B's token cannot post into A, A's id with B's token is refused.
import "./setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("./mocks")).headersMock());

import { POST as mcPOST } from "@/app/api/integrations/manychat/[webhookId]/route";
import { POST as replyPOST } from "@/app/api/inbox/conversations/[id]/reply/route";
import { getData } from "@/lib/data";
import { saveChannelForTest } from "@/lib/data/__tests__/fixtures";
import { newManychatRequestToken, requestTokenMatches, dynamicBlock, isManychatApiKey } from "@/lib/channels/manychat";
import { asUser, jsonReq, newTenant, routeCtx, seedContext, type TestTenant } from "./helpers";

interface Biz { t: TestTenant; token: string; apiKey: string; webhookId: string }
let A: Biz, B: Biz;
let seq = 0;

async function connect(name: string): Promise<Biz> {
  const t = await newTenant(name);
  await seedContext(t.tenantId);
  const token = newManychatRequestToken();
  const apiKey = `${1000000 + (++seq)}:${"a".repeat(32)}`;
  await saveChannelForTest(t.tenantId, "manychat", { status: "connected", secrets: { apiKey, requestToken: token }, publicInfo: { displayName: name } });
  const webhookId = (await getData().channels.get(t.tenantId, "manychat")).webhookId!;
  return { t, token, apiKey, webhookId };
}
const call = (b: Biz | { webhookId: string }, body: unknown, token: string | null) =>
  mcPOST(new Request(`https://inbox.test/api/integrations/manychat/${b.webhookId}`, {
    method: "POST", headers: { "content-type": "application/json", ...(token !== null ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ webhookId: b.webhookId }) });

type Sent = { url: string; auth: string; body: Record<string, unknown> };
function stubManychat(status = 200, body: unknown = { status: "success" }) {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
    if (!String(input).startsWith("https://api.manychat.com/")) throw new Error("unexpected network call");
    sent.push({ url: String(input), auth: String((init.headers as Record<string, string>).authorization), body: JSON.parse(String(init.body ?? "{}")) });
    return new Response(JSON.stringify(body), { status });
  }));
  return sent;
}

beforeEach(async () => { A = await connect("TiendaA"); B = await connect("TiendaB"); });
afterEach(() => { vi.unstubAllGlobals(); asUser(null); });

describe("ManyChat endpoint auth (fails closed)", () => {
  it("missing, wrong or another tenant's token -> 401 and nothing stored", async () => {
    const body = { subscriber_id: "123456", text: "hola" };
    expect((await call(A, body, null)).status).toBe(401);
    expect((await call(A, body, "nope")).status).toBe(401);
    expect((await call(A, body, B.token)).status).toBe(401); // cross-tenant
    expect((await call({ webhookId: "00000000-0000-4000-8000-000000000000" }, body, A.token)).status).toBe(401);
    expect((await getData().conversations.list(A.t.tenantId)).filter((c) => c.channel === "manychat")).toEqual([]);
    expect((await getData().conversations.list(B.t.tenantId)).filter((c) => c.channel === "manychat")).toEqual([]);
  });

  it("a disconnected integration is refused", async () => {
    await getData().channels.save(A.t.tenantId, "manychat", { status: "disconnected", publicInfo: {} });
    expect((await call(A, { subscriber_id: "1", text: "hola" }, A.token)).status).toBe(401);
  });

  it("bad bodies are refused", async () => {
    expect((await call(A, { text: "hola" }, A.token)).status).toBe(400);
    expect((await call(A, { subscriber_id: "abc", text: "hola" }, A.token)).status).toBe(400);
    expect((await call(A, { subscriber_id: "1", text: "  " }, A.token)).status).toBe(400);
  });
});

describe("ManyChat endpoint answers", () => {
  it("greeting: synchronous reply as Dynamic Block + flat fields; stored in the inbox with a customer", async () => {
    const r = await call(A, { subscriber_id: "987654", name: "Ana", text: "hola", channel: "instagram" }, A.token);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.version).toBe("v2");
    expect(j.content.type).toBe("instagram");
    expect(j.content.messages[0]).toMatchObject({ type: "text" });
    expect(j.reply).toBe(j.content.messages[0].text);
    expect(j.needs_human).toBe(false);
    const conv = (await getData().conversations.list(A.t.tenantId)).find((c) => c.channel === "manychat")!;
    expect(conv).toMatchObject({ externalId: "987654", customerName: "Ana" });
    expect(conv.state.manychatChannel).toBe("instagram");
    expect(conv.customerId).toBeTruthy();
  });

  it("ManyChat 'Full Contact Data' shape is accepted too", async () => {
    const r = await call(A, { id: 555111, name: "Beto", last_input_text: "hola" }, A.token);
    expect(r.status).toBe(200);
    expect((await r.json()).content.type).toBeUndefined(); // Messenger: no content type
  });

  it("safety case -> needs_human with the safety reason; then the bot stays silent", async () => {
    const j = await (await call(A, { subscriber_id: "222", text: "mi licuadora echó humo" }, A.token)).json();
    expect(j).toMatchObject({ needs_human: true, reason: "safety", status: "needs_human" });
    expect(j.reply.length).toBeGreaterThan(10);
    const j2 = await (await call(A, { subscriber_id: "222", text: "¿hola?" }, A.token)).json();
    expect(j2).toMatchObject({ reply: "", needs_human: true });
    expect(j2.content.messages).toEqual([]);
  });
});

describe("inbox reply to a ManyChat contact", () => {
  it("goes out through ManyChat sendContent with A's key and the contact's channel type", async () => {
    await call(A, { subscriber_id: "333", text: "mi licuadora echó humo", channel: "whatsapp" }, A.token);
    const conv = (await getData().conversations.list(A.t.tenantId)).find((c) => c.channel === "manychat")!;
    const sent = stubManychat();
    asUser(A.t);
    const res = await replyPOST(jsonReq(`https://inbox.test/api/inbox/conversations/${conv.id}/reply`, { text: "Hola, soy Paola del equipo." }), routeCtx(conv.id));
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://api.manychat.com/fb/sending/sendContent");
    expect(sent[0].auth).toBe(`Bearer ${A.apiKey}`);
    expect(sent[0].body).toEqual({ subscriber_id: 333, data: { version: "v2", content: { type: "whatsapp", messages: [{ type: "text", text: "Hola, soy Paola del equipo." }] } } });
  });

  it("outside 24 h ManyChat refuses (3011): reported, nothing stored", async () => {
    await call(A, { subscriber_id: "444", text: "mi licuadora echó humo" }, A.token);
    const conv = (await getData().conversations.list(A.t.tenantId)).find((c) => c.channel === "manychat")!;
    const before = (await getData().messages.list(A.t.tenantId, conv.id)).length;
    stubManychat(400, { status: "error", code: 3011, message: "x" });
    asUser(A.t);
    const res = await replyPOST(jsonReq(`https://inbox.test/api/inbox/conversations/${conv.id}/reply`, { text: "Hola" }), routeCtx(conv.id));
    expect(res.status).not.toBe(200);
    expect((await res.json()).detail).toBe("outside_24h_window");
    expect((await getData().messages.list(A.t.tenantId, conv.id)).length).toBe(before);
  });
});

describe("manychat helpers", () => {
  it("token compare accepts 'Bearer <t>' or the bare token, never empty", () => {
    expect(requestTokenMatches("abc", "Bearer abc")).toBe(true);
    expect(requestTokenMatches("abc", "abc")).toBe(true);
    expect(requestTokenMatches("abc", "Bearer abd")).toBe(false);
    expect(requestTokenMatches("", "Bearer ")).toBe(false);
    expect(requestTokenMatches("abc", null)).toBe(false);
  });
  it("API key shape and Dynamic Block content type per channel", () => {
    expect(isManychatApiKey("1234567:" + "a1".repeat(16))).toBe(true);
    expect(isManychatApiKey("not a key")).toBe(false);
    expect(dynamicBlock(["hola"], "messenger")).toEqual({ version: "v2", content: { messages: [{ type: "text", text: "hola" }] } });
    expect(dynamicBlock(["hola"], "telegram")).toEqual({ version: "v2", content: { type: "telegram", messages: [{ type: "text", text: "hola" }] } });
  });
});
