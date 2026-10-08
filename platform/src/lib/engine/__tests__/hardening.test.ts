// Security + UX hardening: order oracle, cross-conversation limiter, inbound throttle, media, PII, action requests,
// safety negations and urgent out-of-hours wording.
import "./env"; // must be first: temp SQLite dir
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../connectors/registry", () => ({ getOrdersConnector: () => null }));
vi.mock("../../channels/handoff", () => ({ notifyHandoff: async () => {} }));

import { handleInbound, type EngineDeps, type EngineInboundEvent } from "../index";
import type { LLMRequest } from "../llm";
import { detectActionRequest, detectEscalation } from "../escalate";
import { isLookupBlocked, MAX_FAILS_PER_ORDER, MAX_FAILS_PER_TENANT, MAX_INBOUND_PER_WINDOW, recordLookupFailure } from "../limiter";
import { maskEmailsInText, redactForLLM } from "../text";
import { parseMediaText } from "../media";
import { resolveOrder } from "../../shopify/connector";
import type { ShopifyOrderNode } from "../../shopify/mapping";
import { getConversation, getOrCreateConversation, listMessages, replaceChunks, saveAgentSettings } from "../../store";
import type { AgentSettings, OrdersConnector } from "../../types";

const MONDAY_OPEN = new Date("2026-10-05T17:00:00Z");
const SUNDAY = new Date("2026-10-04T17:00:00Z");
const HOURS = JSON.stringify({ timezone: "America/Mexico_City", days: { mon: "09:00-18:00", tue: "09:00-18:00", wed: "09:00-18:00", thu: "09:00-18:00", fri: "09:00-18:00" } });

function setupTenant(patch: Partial<Omit<AgentSettings, "tenantId">> = {}) {
  const t = `t-${randomUUID()}`;
  saveAgentSettings(t, { agentName: "Chefi", toneLevel: 3, crossSellLevel: 0, greeting: "", fallbackMessage: "", businessHours: HOURS, ...patch });
  replaceChunks(t, { sectionKey: "warranty" }, [{ title: "Garantía", text: "Todos los productos Chefman tienen garantía de 1 año contra defectos de fábrica." }]);
  replaceChunks(t, { sectionKey: "shipping_returns" }, [{ title: "Reembolsos", text: "La política de reembolsos permite devolver productos sin uso en 30 días." }]);
  return t;
}

/** Shopify-like connector built on the real resolveOrder (one order #1234 for juan.perez@gmail.com). */
const ORDER: ShopifyOrderNode = { name: "#1234", email: "juan.perez@gmail.com", displayFulfillmentStatus: "FULFILLED",
  fulfillments: [{ displayStatus: "IN_TRANSIT", trackingInfo: [{ company: "Estafeta", number: "EST999888", url: "https://rastreo.example/EST999888" }] }] };
function shopify(hasAllOrders: boolean, nodes: ShopifyOrderNode[] = [ORDER]) {
  const calls: { n: string; e: string }[] = [];
  const c: OrdersConnector = {
    key: "shopify", isConnected: () => true,
    lookupOrderStatus: async (_t, n, e) => {
      calls.push({ n, e });
      return resolveOrder(nodes.filter((x) => (x.name ?? "").replace("#", "") === n), n, e, hasAllOrders);
    },
  };
  return { c, calls };
}

function makeDeps(over: Partial<EngineDeps> = {}) {
  const llmCalls: LLMRequest[] = [];
  const notify = vi.fn(async () => {});
  const deps: EngineDeps = {
    llm: async (req) => { llmCalls.push(req); return "La garantía es de 1 año contra defectos de fábrica."; },
    now: () => MONDAY_OPEN, getOrdersConnector: () => null, notifyHandoff: notify, ...over,
  };
  return { deps, llmCalls, notify };
}

let tenantId: string;
let n = 0;
const ev = (text: string, extra: Partial<EngineInboundEvent> = {}): EngineInboundEvent =>
  ({ tenantId, channel: "whatsapp", externalId: `c-${tenantId}`, customerName: "Juan", text, providerMessageId: `h-${++n}`, ...extra });
const conv = (ext = `c-${tenantId}`) => getOrCreateConversation(tenantId, "whatsapp", ext);

beforeEach(() => { tenantId = setupTenant(); });

// ---------------------------------------------------------------- order oracle (M1)
describe("order lookup: no existence oracle", () => {
  for (const hasAll of [true, false]) {
    it(`not found, email mismatch and missing email give IDENTICAL text (read_all_orders=${hasAll})`, async () => {
      const { c } = shopify(hasAll, [ORDER, { name: "#5678" /* no email: protected data not approved */ }]);
      const { deps } = makeDeps({ getOrdersConnector: () => c });
      const notFound = await handleInbound(ev("pedido 9999 correo juan.perez@gmail.com", { externalId: "a" }), deps);
      const mismatch = await handleInbound(ev("pedido 1234 correo otra@gmail.com", { externalId: "b" }), deps);
      const missingEmail = await handleInbound(ev("pedido 5678 correo juan.perez@gmail.com", { externalId: "c" }), deps);
      // strip the one-time hello so the comparison is on the answer itself
      const body = (t: string) => t.replace(/^[\s\S]*?(No encontramos)/, "$1");
      expect(body(mismatch.text)).toBe(body(notFound.text));
      expect(body(missingEmail.text)).toBe(body(notFound.text));
      expect(notFound.text).toMatch(/No encontramos un pedido con esos datos/);
      expect(notFound.escalated).toBe(false);
      if (hasAll) expect(notFound.text).not.toMatch(/60 días/);
      else expect(notFound.text).toMatch(/Si tu pedido tiene más de 60 días/);
      // every one counted as a failure
      for (const ext of ["a", "b", "c"]) expect((conv(ext).state as { order?: { failures?: number } }).order?.failures).toBe(1);
    });
  }

  it("the third failure escalates as attempts even when the 60-day offer is shown", async () => {
    const { c } = shopify(false);
    const { deps } = makeDeps({ getOrdersConnector: () => c });
    await handleInbound(ev("pedido 1111 correo a@gmail.com"), deps);
    await handleInbound(ev("pedido 2222 correo b@gmail.com"), deps);
    const r = await handleInbound(ev("pedido 3333 correo c@gmail.com"), deps);
    expect(r).toMatchObject({ escalated: true, reason: "attempts" });
  });

  it("declining the 60-day offer keeps the bot in charge", async () => {
    const { c } = shopify(false);
    const { deps } = makeDeps({ getOrdersConnector: () => c });
    await handleInbound(ev("pedido 1111 correo a@gmail.com"), deps);
    const r = await handleInbound(ev("no"), deps);
    expect(r.escalated).toBe(false);
    expect(conv().status).toBe("bot");
  });
});

// ---------------------------------------------------------------- cross-conversation limiter (H1)
describe("cross-conversation lookup limiter", () => {
  it(`blocks an order number after ${MAX_FAILS_PER_ORDER} failures across conversations, without calling the connector`, async () => {
    const { c, calls } = shopify(true);
    const { deps, llmCalls } = makeDeps({ getOrdersConnector: () => c });
    for (let i = 0; i < MAX_FAILS_PER_ORDER; i++) {
      await handleInbound(ev(`pedido 1234 correo intruso${i}@gmail.com`, { externalId: `att-${i}` }), deps);
    }
    expect(calls).toHaveLength(MAX_FAILS_PER_ORDER);
    // a brand new identity, even with the RIGHT email, does not reach the connector
    const r = await handleInbound(ev("pedido 1234 correo juan.perez@gmail.com", { externalId: "fresh" }), deps);
    expect(calls).toHaveLength(MAX_FAILS_PER_ORDER);
    expect(r.escalated).toBe(false);
    expect(r.text).toMatch(/No encontramos un pedido con esos datos/);
    expect(r.text).toMatch(/una persona de nuestro equipo/);
    expect(r.text).not.toMatch(/Estafeta|EST999888/);
    expect(llmCalls).toHaveLength(0);
    const last = listMessages(tenantId, conv("fresh").id).at(-1)!;
    expect(last.meta.lookupLimited).toBe(true);
    // accepting the offer goes to a person
    const r2 = await handleInbound(ev("sí, por favor", { externalId: "fresh" }), deps);
    expect(r2).toMatchObject({ escalated: true, reason: "human_request" });
  });

  it("blocks an email after repeated failures with different order numbers", async () => {
    const { c, calls } = shopify(true);
    const { deps } = makeDeps({ getOrdersConnector: () => c });
    for (let i = 0; i < 5; i++) await handleInbound(ev(`pedido ${7000 + i} correo victima@gmail.com`, { externalId: `e-${i}` }), deps);
    expect(calls).toHaveLength(5);
    await handleInbound(ev("pedido 7999 correo victima@gmail.com", { externalId: "e-x" }), deps);
    expect(calls).toHaveLength(5);
  });

  it(`per-tenant circuit breaker after ${MAX_FAILS_PER_TENANT} failures/hour`, async () => {
    const { c, calls } = shopify(true);
    const { deps } = makeDeps({ getOrdersConnector: () => c });
    // Pre-load MAX-1 failures straight into the limiter (distinct orders/emails, so only the tenant counter can trip);
    // running 60 full engine turns here was slow enough to hit the 5 s timeout under a loaded parallel run.
    const t0 = MONDAY_OPEN.getTime();
    for (let i = 0; i < MAX_FAILS_PER_TENANT - 1; i++) recordLookupFailure(tenantId, `${10000 + i}`, `u${i}@gmail.com`, t0);
    expect(isLookupBlocked(tenantId, "1234", "juan.perez@gmail.com", t0)).toBe(false);
    // the 60th failure goes through the real engine path, which must record it
    await handleInbound(ev("pedido 99999 correo last@gmail.com", { externalId: "tb-last" }), deps);
    expect(calls).toHaveLength(1);
    expect(isLookupBlocked(tenantId, "1234", "juan.perez@gmail.com", t0)).toBe(true);
    await handleInbound(ev("pedido 1234 correo juan.perez@gmail.com", { externalId: "tb-real" }), deps);
    expect(calls).toHaveLength(1);
    // other tenants are not affected
    tenantId = setupTenant();
    const r = await handleInbound(ev("pedido 1234 correo juan.perez@gmail.com"), deps);
    expect(r.text).toMatch(/Estafeta/);
  });

  it("limits expire after the window", async () => {
    const { c, calls } = shopify(true);
    let now = MONDAY_OPEN;
    const { deps } = makeDeps({ getOrdersConnector: () => c, now: () => now });
    for (let i = 0; i < MAX_FAILS_PER_ORDER; i++) await handleInbound(ev(`pedido 1234 correo z${i}@gmail.com`, { externalId: `w-${i}` }), deps);
    now = new Date(MONDAY_OPEN.getTime() + 61 * 60 * 1000);
    const r = await handleInbound(ev("pedido 1234 correo juan.perez@gmail.com", { externalId: "w-late" }), deps);
    expect(calls).toHaveLength(MAX_FAILS_PER_ORDER + 1);
    expect(r.text).toMatch(/Estafeta/);
  });
});

// ---------------------------------------------------------------- inbound throttle (M6)
describe("per-conversation inbound throttle", () => {
  it(`after ${MAX_INBOUND_PER_WINDOW} messages in 10 minutes: one calm message, then silence; resumes later`, async () => {
    let now = MONDAY_OPEN;
    const { deps, llmCalls } = makeDeps({ now: () => now });
    for (let i = 0; i < MAX_INBOUND_PER_WINDOW; i++) {
      const r = await handleInbound(ev("hola"), deps);
      expect(r.text).not.toBe("");
    }
    const t1 = await handleInbound(ev("¿Cuánto dura la garantía?"), deps);
    expect(t1.text).toMatch(/Te atenderemos en unos minutos/);
    const t2 = await handleInbound(ev("¿Cuánto dura la garantía?"), deps);
    expect(t2.text).toBe("");
    expect(llmCalls).toHaveLength(0);
    // inbound is still stored for staff
    expect(listMessages(tenantId, conv().id).at(-1)!.sender).toBe("customer");
    now = new Date(MONDAY_OPEN.getTime() + 11 * 60 * 1000);
    const r = await handleInbound(ev("¿Cuánto dura la garantía?"), deps);
    expect(r.text).toMatch(/1 año/);
  });
});

// ---------------------------------------------------------------- media (UX P0-1)
describe("non-text messages", () => {
  it("a photo is stored, never sent to the LLM, and handed to a person with an acknowledgement", async () => {
    const { deps, llmCalls, notify } = makeDeps();
    const r = await handleInbound(ev("[Foto]", { media: "image" }), deps);
    expect(r).toMatchObject({ escalated: true, reason: "human_request" });
    expect(r.text).toMatch(/Recibimos tu foto, gracias\. Una persona lo va a revisar\./);
    expect(llmCalls).toHaveLength(0);
    const c = getConversation(tenantId, conv().id)!;
    expect(c.status).toBe("needs_human");
    expect(c.escalationReason).toBe("human_request");
    expect(notify).toHaveBeenCalledWith(tenantId, c.id, "human_request");
    const msgs = listMessages(tenantId, c.id);
    expect(msgs[0]).toMatchObject({ sender: "customer", body: "[Foto]" });
    expect(msgs[0].meta.media).toBe("image");
    expect(msgs.at(-1)!.meta.intent).toBe("attachment");
  });

  it("works from the placeholder text alone (simulator) and is tone-aware", async () => {
    tenantId = setupTenant({ toneLevel: 1 });
    const { deps, llmCalls } = makeDeps();
    const r = await handleInbound(ev("[Nota de voz]"), deps);
    expect(r.text).toMatch(/^Recibimos su nota de voz, gracias\./);
    expect(llmCalls).toHaveLength(0);
    tenantId = setupTenant();
    expect((await handleInbound(ev("[Sticker]"), deps)).text).toMatch(/Recibimos tu mensaje/);
    tenantId = setupTenant();
    expect((await handleInbound(ev("[Ubicación]"), deps)).text).toMatch(/Recibimos tu ubicación/);
  });

  it("a caption with a safety signal escalates as safety", async () => {
    const { deps } = makeDeps();
    const r = await handleInbound(ev("[Foto] así quedó, echó humo y chispas", { media: "image" }), deps);
    expect(r.reason).toBe("safety");
    expect(r.text).toMatch(/911/);
  });

  it("English conversation gets the English acknowledgement", async () => {
    const { deps } = makeDeps();
    await handleInbound(ev("Hi, how long is the warranty?"), deps);
    const r = await handleInbound(ev("[Archivo]", { media: "document" }), deps);
    expect(r.text).toMatch(/^We received your file, thanks\./);
  });

  it("parseMediaText recognizes only known placeholders", () => {
    expect(parseMediaText("[Foto] hola")).toEqual({ kind: "image", caption: "hola" });
    expect(parseMediaText("[algo raro]")).toBeNull();
    expect(parseMediaText("hola [Foto]")).toBeNull();
  });
});

// ---------------------------------------------------------------- PII (M4/M5)
describe("PII", () => {
  it("stored customer bodies have emails masked, but the order flow still uses the real email", async () => {
    const { c, calls } = shopify(true);
    const { deps } = makeDeps({ getOrdersConnector: () => c });
    const r = await handleInbound(ev("pedido 1234 correo Juan.Perez@gmail.com"), deps);
    expect(calls).toEqual([{ n: "1234", e: "juan.perez@gmail.com" }]);
    expect(r.text).toMatch(/Estafeta/);
    const all = JSON.stringify(listMessages(tenantId, conv().id));
    expect(all).not.toMatch(/juan\.perez@gmail\.com/i);
    expect(all).toMatch(/J\*\*\*@gmail\.com/);
    expect(JSON.stringify(conv().state)).not.toMatch(/gmail/);
  });

  it("history sent to the LLM has no emails, order numbers, tracking or order-status replies", async () => {
    const { c } = shopify(true);
    const { deps, llmCalls } = makeDeps({ getOrdersConnector: () => c });
    await handleInbound(ev("pedido 1234 correo juan.perez@gmail.com"), deps);
    await handleInbound(ev("gracias, mi tel es 55 1234 5678"), deps).catch(() => undefined);
    await handleInbound(ev("¿Cuánto dura la garantía?"), deps);
    const req = llmCalls.at(-1)!;
    expect(req.user).not.toMatch(/gmail|1234|EST999888|Estafeta|rastreo|55 1234 5678/);
  });

  it("redaction helpers", () => {
    expect(maskEmailsInText("escribe a ana.lopez@hotmail.com o a b@x.mx")).toBe("escribe a a***@hotmail.com o a b***@x.mx");
    expect(maskEmailsInText(maskEmailsInText("ana@x.com"))).toBe("a***@x.com");
    expect(redactForLLM("pedido #MX-1234 de a***@x.com, guía EST999888, tel +52 55 1234 5678, 5 litros"))
      .toBe("pedido [number] de [email], guía [number], tel [phone], 5 litros");
  });
});

// ---------------------------------------------------------------- action requests (UX P1-6)
describe("refund / cancel / address change", () => {
  it.each([
    "quiero un reembolso", "Quiero que me devuelvan mi dinero", "necesito cancelar mi pedido 1234", "quiero cambiar la dirección de envío",
    "I want a refund", "please cancel my order",
  ])("hands off to a person: %s", async (text) => {
    tenantId = setupTenant();
    const { deps, llmCalls } = makeDeps();
    const r = await handleInbound(ev(text), deps);
    expect(r).toMatchObject({ escalated: true, reason: "human_request" });
    expect(r.text).toMatch(/reembolsos, cancelaciones y cambios de dirección|Refunds, cancellations and address changes/);
    expect(llmCalls).toHaveLength(0);
  });

  it("a policy question still gets a knowledge answer", async () => {
    expect(detectActionRequest("¿Cuál es su política de reembolsos?")).toBe(false);
    expect(detectActionRequest("cancela, ya no")).toBe(false);
    // the fake LLM answers from the refund source (the validator rejects numeric facts that are not in the retrieved sources)
    const { deps, llmCalls } = makeDeps();
    const inner = deps.llm!;
    deps.llm = async (req) => { await inner(req); return "Puedes devolver productos sin uso en 30 días."; };
    const r = await handleInbound(ev("¿Cuál es su política de reembolsos?"), deps);
    expect(r.escalated).toBe(false);
    expect(llmCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- safety negations (UX P1-5)
describe("safety keyword precision", () => {
  it.each(["mi freidora no echa humo", "¿la freidora no suelta humo?", "cocina sin humo", "se me quemó el pollo", "quemé la comida",
    "se me quemaron las papas", "I burnt the toast", "it does not smoke at all"])("not safety: %s", (t) => expect(detectEscalation(t)).not.toBe("safety"));
  it.each(["se quemó la licuadora", "se quemó mi mano", "se me quemó la mano", "echó humo", "la freidora echó humo",
    "no sé por qué echó humo", "no funciona y echa humo", "no funciona, echa humo", "me quemé con la freidora", "I burned my hand"])(
    "safety: %s", (t) => expect(detectEscalation(t)).toBe("safety"));
});

// ---------------------------------------------------------------- urgent out-of-hours (UX P1-1)
describe("urgent wording for safety/legal", () => {
  it("safety outside hours says the case was flagged urgent (ES)", async () => {
    const { deps } = makeDeps({ now: () => SUNDAY });
    const r = await handleInbound(ev("mi freidora echó humo"), deps);
    expect(r.reason).toBe("safety");
    expect(r.text).toMatch(/fuera de nuestro horario de atención/);
    expect(r.text).toMatch(/marcamos tu caso como urgente/);
    expect(r.text).not.toMatch(/te responderá por este medio en cuanto abramos\./);
  });

  it("legal outside hours too (EN), and in hours", async () => {
    const { deps } = makeDeps({ now: () => SUNDAY });
    const r = await handleInbound(ev("I will contact my lawyer"), deps);
    expect(r.text).toMatch(/flagged your case as urgent/);
    tenantId = setupTenant();
    const r2 = await handleInbound(ev("Voy a ir a la Profeco"), makeDeps().deps);
    expect(r2.text).toMatch(/Marcamos tu caso como urgente/);
  });

  it("a normal human request is not called urgent", async () => {
    const { deps } = makeDeps({ now: () => SUNDAY });
    const r = await handleInbound(ev("quiero hablar con una persona"), deps);
    expect(r.text).not.toMatch(/urgente/);
  });
});
