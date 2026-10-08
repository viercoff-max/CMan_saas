// Scenario 4: human takeover through the real inbox route handlers (status + reply) and sendToCustomer -> Meta Graph (fetch stub).
import "./setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("./mocks")).headersMock());

import { handleInbound } from "@/lib/engine";
import { getConversation, getOrCreateConversation, listMessages, saveChannelAccount } from "@/lib/store";
import { POST as statusPOST } from "@/app/api/inbox/conversations/[id]/status/route";
import { POST as replyPOST } from "@/app/api/inbox/conversations/[id]/reply/route";
import { FB_GRAPH } from "@/lib/channels/graph";
import { asUser, faithfulLLM, jsonReq, newTenant, routeCtx, seedContext, stubFetch, type TestTenant } from "./helpers";

let PHONE_ID = "";
const WA_ID = "5215512345678";
let t: TestTenant;
let n = 0;
const ev = (text: string) => ({ tenantId: t.tenantId, channel: "whatsapp" as const, externalId: WA_ID, customerName: "Juan", text, providerMessageId: `wamid.tk${++n}` });
const conv = () => getOrCreateConversation(t.tenantId, "whatsapp", WA_ID);
const status = (id: string, action: string) => statusPOST(jsonReq(`https://inbox.test/api/inbox/conversations/${id}/status`, { action }), routeCtx(id));
const reply = (id: string, text: string) => replyPOST(jsonReq(`https://inbox.test/api/inbox/conversations/${id}/reply`, { text }), routeCtx(id));

beforeEach(() => {
  t = newTenant();
  PHONE_ID = `1098${Date.now()}${++n}`; // channel external ids are unique across tenants (uq_channel_external)
  seedContext(t.tenantId);
  saveChannelAccount(t.tenantId, "whatsapp", {
    status: "connected", secrets: { phoneNumberId: PHONE_ID, accessToken: "EAAG-test-token-123", wabaId: "WABA1" },
    publicInfo: { externalId: PHONE_ID, displayName: "Chefman MX" },
  });
  asUser(t);
});
afterEach(() => { vi.unstubAllGlobals(); asUser(null); });

describe("scenario 4: human takeover", () => {
  it("take -> bot silent -> agent reply goes to Meta -> return to bot -> bot answers again", async () => {
    const net = stubFetch();
    const { llm, calls } = faithfulLLM();
    const r0 = await handleInbound(ev("¿Cuánto dura la garantía?"), { llm });
    expect(r0.text).toMatch(/1 año/);
    const id = conv().id;

    // Agent takes the conversation from the inbox
    const s1 = await status(id, "take");
    expect(s1.status).toBe(200);
    expect(getConversation(t.tenantId, id)!.status).toBe("human");

    // Customer writes: stored, no bot reply, LLM untouched
    const before = calls.length;
    const r1 = await handleInbound(ev("¿Y cubre la canasta?"), { llm });
    expect(r1).toEqual({ text: "", escalated: false });
    expect(calls.length).toBe(before);
    const last = listMessages(t.tenantId, id).at(-1)!;
    expect([last.sender, last.body]).toEqual(["customer", "¿Y cubre la canasta?"]);

    // Agent replies through the inbox reply route -> Meta Graph WhatsApp send
    const rr = await reply(id, "Hola Juan, soy Ana del equipo. Sí, la canasta está cubierta.");
    expect(rr.status).toBe(200);
    const g = net.graph();
    expect(g).toHaveLength(1);
    expect(g[0].url).toBe(`${FB_GRAPH}/${PHONE_ID}/messages`);
    expect(g[0].headers.authorization).toBe("Bearer EAAG-test-token-123");
    expect(g[0].body).toMatchObject({ messaging_product: "whatsapp", to: WA_ID, type: "text", text: { body: "Hola Juan, soy Ana del equipo. Sí, la canasta está cubierta." } });
    const agentMsg = listMessages(t.tenantId, id).at(-1)!;
    expect([agentMsg.sender, agentMsg.direction]).toEqual(["agent", "out"]);
    expect(agentMsg.meta.agentUserId).toBe(t.userId);

    // Still human: bot silent
    expect((await handleInbound(ev("gracias"), { llm })).text).toBe("");

    // Return to bot
    const s2 = await status(id, "return");
    expect(s2.status).toBe(200);
    expect(getConversation(t.tenantId, id)!.status).toBe("bot");
    const r2 = await handleInbound(ev("¿Cuántos días tardan los envíos?"), { llm });
    expect(r2.escalated).toBe(false);
    expect(r2.text).toMatch(/3 a 5 días hábiles/);
  });

  it("agent reply on a needs_human conversation moves it to human", async () => {
    stubFetch();
    await handleInbound(ev("quiero hablar con un asesor"));
    const id = conv().id;
    expect(getConversation(t.tenantId, id)!.status).toBe("needs_human");
    expect((await reply(id, "Hola, aquí Ana.")).status).toBe(200);
    expect(getConversation(t.tenantId, id)!.status).toBe("human");
  });

  it("Meta send failure -> 502 and the agent message is NOT stored as sent", async () => {
    stubFetch({ graphStatus: 400 });
    await handleInbound(ev("hola"));
    const id = conv().id;
    const count = listMessages(t.tenantId, id).length;
    const res = await reply(id, "Hola, ¿sigues ahí?");
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "send_failed" });
    expect(listMessages(t.tenantId, id)).toHaveLength(count);
  });

  it("tenant isolation: another tenant's session cannot read/act on the conversation; no session -> 401", async () => {
    stubFetch();
    await handleInbound(ev("hola"));
    const id = conv().id;
    const other = newTenant("Otra marca");
    asUser(other);
    expect((await reply(id, "hola")).status).toBe(404);
    expect((await status(id, "take")).status).toBe(404);
    asUser(null);
    expect((await reply(id, "hola")).status).toBe(401);
    expect(getConversation(t.tenantId, id)!.status).toBe("bot");
  });

  it("cross-site POST to the reply route is rejected (CSRF) and nothing is sent", async () => {
    const net = stubFetch();
    await handleInbound(ev("hola"));
    const id = conv().id;
    const res = await replyPOST(jsonReq(`https://inbox.test/api/inbox/conversations/${id}/reply`, { text: "hola" }, "https://evil.example"), routeCtx(id));
    expect(res.status).toBe(403);
    expect(net.graph()).toHaveLength(0);
  });

  it("FINDING-B (fixed): 'return to bot' clears the stale escalation_reason", async () => {
    await handleInbound(ev("mi freidora sacó humo"));
    const id = conv().id;
    await status(id, "return");
    const c = getConversation(t.tenantId, id)!;
    expect(c.status).toBe("bot");
    expect(c.escalationReason ?? null).toBeNull();
  });

  it("FINDING-C (fixed): after a no_answer handoff and 'return to bot', the next unknown question gets a clarify turn first", async () => {
    const { llm } = faithfulLLM();
    await handleInbound(ev("¿Venden boletos para el concierto?"), { llm });
    await handleInbound(ev("¿Tienen estacionamiento para bicicletas?"), { llm });
    const id = conv().id;
    await status(id, "return");
    const r = await handleInbound(ev("¿Tienen sucursal en Monterrey?"), { llm });
    expect(r.escalated).toBe(false);
    expect(r.text).toMatch(/no encontré información/i);
    const r2 = await handleInbound(ev("¿Venden boletos de avión?"), { llm });
    expect(r2).toMatchObject({ escalated: true, reason: "no_answer" });
  });
});
