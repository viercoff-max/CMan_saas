import "./env-secrets"; // temp SQLite + DATA_DIR + test APP_SECRET
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../db";
import { addMessage, getOrCreateConversation, saveChannelAccount } from "../../store";
import { sendToCustomer } from "../send";
import { routeTenant } from "../routing";
import { FB_GRAPH, IG_GRAPH } from "../graph";

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
function stub(status = 200, payload: unknown = { message_id: "m" }) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, headers: Object.fromEntries(new Headers(init.headers).entries()), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(payload), { status });
  }));
  return calls;
}
afterEach(() => { vi.unstubAllGlobals(); delete process.env.META_HUMAN_AGENT; });

const uid = () => randomUUID().replace(/-/g, "").slice(0, 12);
function setup(channel: "whatsapp" | "messenger" | "instagram", secrets: Record<string, string>, externalId: string, inboundHoursAgo = 1) {
  const t = `t-${uid()}`;
  saveChannelAccount(t, channel, { status: "connected", secrets, publicInfo: { externalId } });
  const conv = getOrCreateConversation(t, channel, `cust-${uid()}`, "Ana");
  const m = addMessage(t, conv.id, { direction: "in", sender: "customer", body: "hola" });
  getDb().prepare("UPDATE messages SET created_at=? WHERE id=?").run(new Date(Date.now() - inboundHoursAgo * 3600_000).toISOString(), m.id);
  return { t, conv };
}

describe("sendToCustomer endpoints (Meta docs 2026-10)", () => {
  it("Messenger: POST /{page-id}/messages with a Bearer Page token and messaging_type RESPONSE", async () => {
    const page = `P${uid()}`;
    const { t, conv } = setup("messenger", { pageId: page, accessToken: "EAAPtoken" }, page);
    const calls = stub();
    expect(await sendToCustomer(t, conv, "Hola")).toEqual({ ok: true });
    expect(calls[0].url).toBe(`${FB_GRAPH}/${page}/messages`);
    expect(calls[0].url).not.toContain("access_token");
    expect(calls[0].headers.authorization).toBe("Bearer EAAPtoken");
    expect(calls[0].body).toEqual({ recipient: { id: conv.externalId }, messaging_type: "RESPONSE", message: { text: "Hola" } });
  });
  it("Instagram with a Page token: graph.facebook.com/me/messages; with an Instagram Login token: graph.instagram.com/{ig-id}/messages", async () => {
    const ig = `IG${uid()}`;
    const a = setup("instagram", { igId: ig, accessToken: "EAAItoken" }, ig);
    let calls = stub();
    await sendToCustomer(a.t, a.conv, "Hola");
    expect(calls[0].url).toBe(`${FB_GRAPH}/me/messages`);
    const ig2 = `IG${uid()}`;
    const b = setup("instagram", { igId: ig2, accessToken: "IGAAtoken", igLogin: "1" }, ig2);
    calls = stub();
    await sendToCustomer(b.t, b.conv, "Hola");
    expect(calls[0].url).toBe(`${IG_GRAPH}/${ig2}/messages`);
    expect(calls[0].headers.authorization).toBe("Bearer IGAAtoken");
  });
  it("Instagram long replies are split under 1000 UTF-8 bytes per message", async () => {
    const ig = `IG${uid()}`;
    const { t, conv } = setup("instagram", { igId: ig, accessToken: "EAAItoken" }, ig);
    const calls = stub();
    const text = Array.from({ length: 120 }, () => "Información útil sobre envíos.").join(" ");
    expect(await sendToCustomer(t, conv, text)).toEqual({ ok: true });
    expect(calls.length).toBeGreaterThan(1);
    for (const c of calls) expect(Buffer.byteLength(String((c.body.message as { text: string }).text), "utf8")).toBeLessThanOrEqual(1000);
  });
  it("WhatsApp outside the 24 h window: refused without calling Meta (template needed)", async () => {
    const pn = `PN${uid()}`;
    const { t, conv } = setup("whatsapp", { phoneNumberId: pn, accessToken: "EAAGtoken" }, pn, 30);
    const calls = stub();
    expect(await sendToCustomer(t, conv, "Hola")).toEqual({ ok: false, error: "outside_24h_window_template_required" });
    expect(calls).toHaveLength(0);
  });
  it("Messenger after 24 h: HUMAN_AGENT tag only when META_HUMAN_AGENT=1", async () => {
    const page = `P${uid()}`;
    const { t, conv } = setup("messenger", { pageId: page, accessToken: "EAAPtoken" }, page, 50);
    let calls = stub();
    expect((await sendToCustomer(t, conv, "Hola")).error).toBe("outside_24h_window");
    expect(calls).toHaveLength(0);
    process.env.META_HUMAN_AGENT = "1";
    calls = stub();
    expect(await sendToCustomer(t, conv, "Hola")).toEqual({ ok: true });
    expect(calls[0].body).toMatchObject({ messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" });
  });
  it("Graph errors come back named (131047, 190) without the token", async () => {
    const pn = `PN${uid()}`;
    const { t, conv } = setup("whatsapp", { phoneNumberId: pn, accessToken: "EAAGsecret" }, pn);
    stub(400, { error: { code: 190, message: "Error validating access token" } });
    const r = await sendToCustomer(t, conv, "Hola");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^token_expired_or_invalid/);
    expect(r.error).not.toContain("EAAGsecret");
  });
});

describe("routeTenant", () => {
  it("routes Instagram by entry.id, or by recipient.id when entry.id is the Page id", () => {
    const ig = `IG${uid()}`;
    const t = `t-${uid()}`;
    saveChannelAccount(t, "instagram", { status: "connected", secrets: { igId: ig, accessToken: "EAAItoken" }, publicInfo: { externalId: ig } });
    expect(routeTenant({ channel: "instagram", accountId: ig })).toBe(t);
    expect(routeTenant({ channel: "instagram", accountId: "SOME_PAGE", altAccountIds: [ig] })).toBe(t);
    expect(routeTenant({ channel: "instagram", accountId: "SOME_PAGE", altAccountIds: ["nope"] })).toBeNull();
  });
});
