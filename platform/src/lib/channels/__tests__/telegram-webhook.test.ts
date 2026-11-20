// Telegram webhook route (real handler) -> secret auth -> engine -> sendToCustomer -> Telegram sendMessage (fetch mocked).
import "@/e2e/setup";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("@/e2e/mocks")).headersMock());
vi.mock("next/cache", async () => (await import("@/e2e/mocks")).cacheMock());
vi.mock("next/server", async (orig) => (await import("@/e2e/mocks")).serverMock(await orig()));

import { POST } from "@/app/api/webhooks/telegram/[webhookId]/route";
import { flushAfter } from "@/e2e/mocks";
import { newTenant, seedContext, type TestTenant } from "@/e2e/helpers";
import { saveChannelForTest } from "@/lib/data/__tests__/fixtures";
import { getData } from "@/lib/data";
import { TELEGRAM_API } from "@/lib/channels/telegram";
import { newTelegramWebhookSecret } from "@/lib/channels/telegram-secret";

interface Bot { tenant: TestTenant; token: string; secret: string; webhookId: string }
let A: Bot, B: Bot;
let seq = 0;

async function connectBot(name: string): Promise<Bot> {
  const tenant = await newTenant(name);
  await seedContext(tenant.tenantId);
  const id = `${800000000 + Math.floor(Math.random() * 99_000_000) + (++seq)}`;
  const token = `${id}:AAH${randomUUID().replace(/-/g, "")}`;
  const secret = newTelegramWebhookSecret();
  await saveChannelForTest(tenant.tenantId, "telegram", { status: "connected", secrets: { botToken: token, webhookSecret: secret }, publicInfo: { externalId: id, displayName: `@${name}bot` } });
  const webhookId = (await getData().channels.get(tenant.tenantId, "telegram")).webhookId!;
  return { tenant, token, secret, webhookId };
}

type Sent = { token: string; body: Record<string, unknown> };
function stubTelegram() {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
    const m = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/sendMessage$/.exec(String(input));
    if (!m) throw new Error("unexpected network call in test");
    sent.push({ token: m[1], body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), { status: 200 });
  }));
  return sent;
}

let mid = 1000;
const update = (o: { chatId?: number; text?: string; chatType?: string; isBot?: boolean; extra?: Record<string, unknown>; messageId?: number } = {}) => ({
  update_id: ++mid,
  message: {
    message_id: o.messageId ?? mid, date: Math.floor(Date.now() / 1000),
    chat: { id: o.chatId ?? 4242, type: o.chatType ?? "private", first_name: "Ana" },
    from: { id: o.chatId ?? 4242, is_bot: o.isBot ?? false, first_name: "Ana", last_name: "López" },
    ...(o.text !== undefined ? { text: o.text } : {}), ...(o.extra ?? {}),
  },
});
function req(webhookId: string, body: unknown, secret: string | null, raw?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-telegram-bot-api-secret-token"] = secret;
  return new Request(`https://inbox.test/api/webhooks/telegram/${webhookId}`, { method: "POST", headers, body: raw ?? JSON.stringify(body) });
}
async function post(webhookId: string, body: unknown, secret: string | null, raw?: string) {
  const res = await POST(req(webhookId, body, secret, raw), { params: Promise.resolve({ webhookId }) });
  await flushAfter();
  return res;
}
const telegramConvs = async (t: TestTenant) => (await getData().conversations.list(t.tenantId)).filter((c) => c.channel === "telegram");

beforeEach(async () => { A = await connectBot("Chefman"); B = await connectBot("Otra"); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Telegram webhook auth (fails closed)", () => {
  it("missing or wrong secret -> 401, nothing stored or sent", async () => {
    const sent = stubTelegram();
    expect((await post(A.webhookId, update({ text: "hola" }), null)).status).toBe(401);
    expect((await post(A.webhookId, update({ text: "hola" }), "wrong-secret")).status).toBe(401);
    expect((await post(A.webhookId, update({ text: "hola" }), "")).status).toBe(401);
    expect((await post(A.webhookId, update({ text: "hola" }), `${A.secret}x`)).status).toBe(401);
    expect(sent).toHaveLength(0);
    expect(await telegramConvs(A.tenant)).toHaveLength(0);
  });
  it("unknown / malformed webhookId -> 401", async () => {
    stubTelegram();
    expect((await post(randomUUID(), update({ text: "hola" }), A.secret)).status).toBe(401);
    expect((await post("../../etc", update({ text: "hola" }), A.secret)).status).toBe(401);
    expect((await post("x", update({ text: "hola" }), A.secret)).status).toBe(401);
  });
  it("cross-tenant: tenant A's valid secret on tenant B's webhookId never delivers into B (or A)", async () => {
    const sent = stubTelegram();
    expect((await post(B.webhookId, update({ text: "hola" }), A.secret)).status).toBe(401);
    expect((await post(A.webhookId, update({ text: "hola" }), B.secret)).status).toBe(401);
    expect(await telegramConvs(A.tenant)).toHaveLength(0);
    expect(await telegramConvs(B.tenant)).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });
  it("a disconnected bot stops matching", async () => {
    stubTelegram();
    await getData().channels.save(A.tenant.tenantId, "telegram", { status: "disconnected", publicInfo: {} });
    expect((await post(A.webhookId, update({ text: "hola" }), A.secret)).status).toBe(401);
  });
  it("body over 1 MB -> 413; invalid JSON -> 400", async () => {
    stubTelegram();
    expect((await post(A.webhookId, null, A.secret, "x".repeat(1_000_001))).status).toBe(413);
    expect((await post(A.webhookId, null, A.secret, "{not json")).status).toBe(400);
  });
});

describe("Telegram webhook processing", () => {
  it("/start greets through the engine and replies with tenant A's bot to the chat", async () => {
    const sent = stubTelegram();
    const res = await post(A.webhookId, update({ text: "/start", chatId: 5151 }), A.secret);
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].token).toBe(A.token);
    expect(sent[0].body.chat_id).toBe("5151");
    expect(sent[0].body).not.toHaveProperty("parse_mode");
    expect(String(sent[0].body.text).length).toBeGreaterThan(0);
    const convs = await telegramConvs(A.tenant);
    expect(convs).toHaveLength(1);
    expect(convs[0]).toMatchObject({ externalId: "5151", customerName: "Ana López" });
    expect(await telegramConvs(B.tenant)).toHaveLength(0);
  });
  it("photo -> media placeholder, the engine hands off to a person with an acknowledgement", async () => {
    const sent = stubTelegram();
    await post(A.webhookId, update({ chatId: 6161, extra: { photo: [{ file_id: "f1", width: 1, height: 1 }], caption: "llegó roto" } }), A.secret);
    const [conv] = await telegramConvs(A.tenant);
    const msgs = await getData().messages.list(A.tenant.tenantId, conv.id);
    expect(msgs[0].body).toBe("[Foto] llegó roto");
    expect((await getData().conversations.get(A.tenant.tenantId, conv.id))?.status).toBe("needs_human");
    expect(sent).toHaveLength(1);
  });
  it("dedupes Telegram retries of the same message (chat.id:message_id)", async () => {
    const sent = stubTelegram();
    const u = update({ text: "hola", chatId: 7171, messageId: 9 });
    await post(A.webhookId, u, A.secret);
    await post(A.webhookId, u, A.secret);
    const [conv] = await telegramConvs(A.tenant);
    expect((await getData().messages.list(A.tenant.tenantId, conv.id)).filter((m) => m.direction === "in")).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });
  it("ignores group chats, bots, channel posts and edits (200, nothing stored)", async () => {
    const sent = stubTelegram();
    expect((await post(A.webhookId, update({ text: "hola", chatType: "group", chatId: -100 }), A.secret)).status).toBe(200);
    expect((await post(A.webhookId, update({ text: "hola", isBot: true, chatId: 8181 }), A.secret)).status).toBe(200);
    expect((await post(A.webhookId, { update_id: 1, channel_post: { message_id: 1, chat: { id: -5, type: "channel" }, text: "x" } }, A.secret)).status).toBe(200);
    expect((await post(A.webhookId, { update_id: 2, edited_message: update({ text: "editado" }).message }, A.secret)).status).toBe(200);
    expect(await telegramConvs(A.tenant)).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });
  it("uses the Telegram API host only", () => { expect(TELEGRAM_API).toBe("https://api.telegram.org"); });
});
