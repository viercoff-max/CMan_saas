// Scenario 2: Shopify DEMO add-on (real store + registry + shopifyConnector + mock store) driven by the engine's order flow.
import "./setup";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleInbound } from "@/lib/engine";
import { getOrdersConnector } from "@/lib/connectors/registry";
import { shopifyConnector } from "@/lib/shopify/connector";
import { MOCK_EMAIL } from "@/lib/shopify/mock";
import { getAddon, getConversation, getOrCreateConversation, listMessages, saveAddon } from "@/lib/store";
import { bodies, faithfulLLM, newTenant, readOutbox, seedContext } from "./helpers";

let tenantId: string;
let n = 0;
const ev = (ext: string, text: string) => ({ tenantId, channel: "whatsapp" as const, externalId: ext, customerName: "Cliente Demo", text, providerMessageId: `or-${++n}` });
const convOf = (ext: string) => getOrCreateConversation(tenantId, "whatsapp", ext);
const { llm } = faithfulLLM();

/** Exactly what POST /api/shopify/demo stores (src/app/api/shopify/demo/route.ts). */
function connectDemo(t: string) {
  saveAddon(t, "shopify", { status: "connected", secrets: { mock: true }, publicInfo: { shop: "demo.myshopify.com", name: "Tienda de demostración", mock: true, mode: "demo" } });
}

const LEAK = /direcci[oó]n|address|calle|colonia|c\.p\.|tel[eé]fono|phone|\+52|art[ií]culos?|items?\b|producto|total|\$\s?\d|pagad|paid|payment|tarjeta|card/i;

beforeEach(() => {
  tenantId = newTenant().tenantId;
  seedContext(tenantId);
  connectDemo(tenantId);
});

describe("scenario 2: order status through the Shopify demo add-on", () => {
  it("demo connect makes the registry return the Shopify connector", () => {
    expect(getAddon(tenantId, "shopify")).toMatchObject({ status: "connected", publicInfo: { mock: true } });
    expect(getOrdersConnector(tenantId)).toBe(shopifyConnector);
    expect(getOrdersConnector(newTenant().tenantId)).toBeNull();
  });

  it("#1001 + test@example.com: status-only reply, email not kept in state or bot messages", async () => {
    const ext = "5215500001001";
    const lookup = vi.spyOn(shopifyConnector, "lookupOrderStatus");
    const r1 = await handleInbound(ev(ext, "Hola, ¿dónde está mi pedido?"), { llm });
    expect(r1.text).toMatch(/número de pedido/);
    const r2 = await handleInbound(ev(ext, "#1001"), { llm });
    expect(r2.text).toMatch(/correo/);
    expect(JSON.stringify(convOf(ext).state)).not.toContain("@");
    const r3 = await handleInbound(ev(ext, MOCK_EMAIL), { llm });
    expect(lookup).toHaveBeenCalledWith(tenantId, "1001", MOCK_EMAIL);
    lookup.mockRestore();

    expect(r3.escalated).toBe(false);
    expect(r3.text).toMatch(/#1001/);
    expect(r3.text).toMatch(/Enviado/);
    expect(r3.text).toMatch(/Paquetería: Estafeta/);
    expect(r3.text).toMatch(/EST123456789/);
    expect(r3.text).toMatch(/Entrega estimada: 2026-10-12/);
    expect(r3.text).not.toMatch(LEAK);
    expect(r3.text).not.toContain(MOCK_EMAIL);

    const c = convOf(ext);
    expect(JSON.stringify(c.state)).not.toContain(MOCK_EMAIL);
    expect(JSON.stringify(c.state)).not.toContain("@");
    const msgs = listMessages(tenantId, c.id);
    for (const m of msgs.filter((m) => m.sender === "bot")) {
      expect(m.body).not.toContain(MOCK_EMAIL);
      expect(JSON.stringify(m.meta)).not.toContain(MOCK_EMAIL);
    }
  });

  it("BUG-2 (fixed): customer email is not stored in plain text in message bodies", async () => {
    const ext = "5215500001002";
    await handleInbound(ev(ext, "pedido #1001 correo test@example.com"), { llm });
    expect(bodies(tenantId, convOf(ext).id).join("\n")).not.toContain(MOCK_EMAIL);
  });

  it("wrong email and unknown order get the same generic message", async () => {
    const a = await handleInbound(ev("5215500001003", "pedido #1001 correo otra.persona@example.com"), { llm });
    const b = await handleInbound(ev("5215500001004", "pedido #9999 correo test@example.com"), { llm });
    expect(a.text).toMatch(/No encontramos un pedido con esos datos/);
    expect(b.text).toBe(a.text);
    expect(a.text).not.toMatch(/Enviado|Estafeta|EST1/);
  });

  it("3 failures -> lockout, escalation 'attempts', outbox notified, then silent; correct data no longer checked", async () => {
    const ext = "5215500001005";
    const lookup = vi.spyOn(shopifyConnector, "lookupOrderStatus");
    for (const mail of ["a@example.com", "b@example.com"]) {
      const r = await handleInbound(ev(ext, `pedido #1001 correo ${mail}`), { llm });
      expect(r.text).toMatch(/No encontramos/);
    }
    const r3 = await handleInbound(ev(ext, "pedido #1001 correo c@example.com"), { llm });
    expect(r3).toMatchObject({ escalated: true, reason: "attempts" });
    const c = getConversation(tenantId, convOf(ext).id)!;
    expect([c.status, c.escalationReason]).toEqual(["needs_human", "attempts"]);
    expect((c.state as { order?: { locked?: boolean } }).order?.locked).toBe(true);
    expect(readOutbox(c.id)).toMatch(/Motivo: attempts/);
    const r4 = await handleInbound(ev(ext, "pedido #1001 correo test@example.com"), { llm });
    expect(r4.text).toBe("");
    expect(lookup).toHaveBeenCalledTimes(3);
    lookup.mockRestore();
  });

  it("BUG-2b (fixed): the handoff outbox file masks the customer's emails", async () => {
    const ext = "5215500001006";
    for (const mail of ["a@example.com", "b@example.com", "c@example.com"]) await handleInbound(ev(ext, `pedido #1001 correo ${mail}`), { llm });
    const mail = readOutbox(convOf(ext).id);
    expect(mail).toMatch(/Motivo: attempts/);
    for (const m of ["a@example.com", "b@example.com", "c@example.com"]) expect(mail).not.toContain(m);
  });

  it("FINDING-A: attempt limit is per conversation -> a NEW conversation/identity gets fresh attempts on the same order", async () => {
    const lookup = vi.spyOn(shopifyConnector, "lookupOrderStatus");
    const attacker1 = "5215500009991";
    for (const mail of ["x1@example.com", "x2@example.com", "x3@example.com"]) await handleInbound(ev(attacker1, `pedido #1001 correo ${mail}`), { llm });
    expect(getConversation(tenantId, convOf(attacker1).id)!.escalationReason).toBe("attempts");

    // Same order, new WhatsApp number (new conversation): not locked.
    const attacker2 = "5215500009992";
    const r1 = await handleInbound(ev(attacker2, "pedido #1001 correo x4@example.com"), { llm });
    expect(r1.escalated).toBe(false);
    expect(r1.text).toMatch(/No encontramos/);
    const r2 = await handleInbound(ev(attacker2, "pedido #1001 correo test@example.com"), { llm });
    expect(r2.text).toMatch(/Enviado/); // order status disclosed after 4 failed guesses on the same order
    expect(lookup).toHaveBeenCalledTimes(5);
    lookup.mockRestore();
  });

  it("disconnecting the add-on puts the bot back to 'cannot check orders' + offer", async () => {
    saveAddon(tenantId, "shopify", { status: "disconnected", publicInfo: {} });
    const r = await handleInbound(ev("5215500001007", "¿dónde está mi pedido #1001?"), { llm });
    expect(r.text).toMatch(/no puedo consultar el estatus de pedidos/);
  });
});
