// Wave 4: simulator rate limits that survive "Empezar de nuevo" (M3), and bot copy fixes from REVIEW-qa-2
// (single opener, order status grammar per status, human-readable delivery dates, media pronoun agreement).
import "./env"; // must be first: temp SQLite dir
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../connectors/registry", () => ({ getOrdersConnector: () => null }));
vi.mock("../../channels/handoff", () => ({ notifyHandoff: async () => {} }));

import { handleInbound, type EngineDeps } from "../index";
import { SIM_MAX_PER_TENANT, SIM_MAX_PER_USER } from "../limiter";
import * as T from "../templates";
import { attachmentReceived } from "../media";
import { fakeMeter } from "./fake-meter";
import { getData } from "../../data";
import type { OrdersConnector } from "../../types";

const NOW = new Date("2026-10-05T17:00:00Z");
const TONES = [1, 2, 3, 4, 5] as const;

async function setupTenant(tone: T.Tone = 4) {
  const t = `t-${randomUUID()}`;
  await getData().settings.save(t, { agentName: "Chef", toneLevel: tone, crossSellLevel: 0, greeting: "", fallbackMessage: "", businessHours: "" });
  await getData().chunks.replace(t, { sectionKey: "warranty" }, [{ title: "Garantía", text: "Todos los productos tienen garantía de 1 año contra defectos de fábrica." }]);
  return t;
}
let n = 0;
const sim = (tenantId: string, userId: string, text: string) =>
  ({ tenantId, channel: "simulator" as const, externalId: `sim-${userId}`, customerName: "Simulador", text, providerMessageId: `w4-${++n}` });
const restart = async (tenantId: string, userId: string) => {
  const id = await getData().conversations.findIdByExternal(tenantId, "simulator", `sim-${userId}`);
  if (id) await getData().conversations.delete(tenantId, id); // what DELETE /api/inbox/simulate does
};

describe("simulator limits (per tenant + user, not per conversation)", () => {
  let tenantId: string;
  let now: Date;
  const llm = vi.fn(async () => "La garantía es de 1 año contra defectos de fábrica.");
  const deps = (): EngineDeps => ({ llm, now: () => now, getOrdersConnector: () => null, notifyHandoff: async () => {}, usage: fakeMeter() });
  beforeEach(async () => { tenantId = await setupTenant(); now = new Date(NOW.getTime() + Math.floor(Math.random() * 1e9)); llm.mockClear(); });

  it(`a user gets ${SIM_MAX_PER_USER} messages per 10 min even when restarting the chat; then one calm message and silence`, async () => {
    for (let i = 0; i < SIM_MAX_PER_USER; i++) {
      if (i % 10 === 9) await restart(tenantId, "u1"); // "Empezar de nuevo" every 10 messages
      const r = await handleInbound(sim(tenantId, "u1", "¿Cuánto dura la garantía?"), deps());
      expect(r.reason).not.toBe("throttled");
    }
    await restart(tenantId, "u1");
    const t1 = await handleInbound(sim(tenantId, "u1", "¿Cuánto dura la garantía?"), deps());
    expect(t1.reason).toBe("throttled");
    expect(t1.text).toMatch(/en unos minutos/);
    const t2 = await handleInbound(sim(tenantId, "u1", "¿Cuánto dura la garantía?"), deps());
    expect(t2).toMatchObject({ text: "", reason: "throttled" });
    expect(llm).toHaveBeenCalledTimes(SIM_MAX_PER_USER);
    // After the window the user can test again.
    now = new Date(now.getTime() + 11 * 60 * 1000);
    expect((await handleInbound(sim(tenantId, "u1", "¿Cuánto dura la garantía?"), deps())).text).toMatch(/1 año/);
  });

  it(`the tenant as a whole is capped at ${SIM_MAX_PER_TENANT} (many users), and another tenant is not affected`, async () => {
    let i = 0;
    for (const u of ["a", "b", "c"]) for (let k = 0; k < SIM_MAX_PER_TENANT / 3; k++, i++) {
      expect((await handleInbound(sim(tenantId, u, "¿Cuánto dura la garantía?"), deps())).reason).not.toBe("throttled");
    }
    expect((await handleInbound(sim(tenantId, "d", "¿Cuánto dura la garantía?"), deps())).reason).toBe("throttled");
    const other = await setupTenant();
    expect((await handleInbound(sim(other, "d", "¿Cuánto dura la garantía?"), deps())).reason).not.toBe("throttled");
  }, 30_000); // 60+ simulated messages; slow on a loaded machine

  it("real channels are not affected by the simulator limits", async () => {
    for (let i = 0; i < SIM_MAX_PER_TENANT + 5; i++) {
      const r = await handleInbound({ tenantId, channel: "whatsapp", externalId: `wa-${i}`, text: "¿Cuánto dura la garantía?", providerMessageId: `w4wa-${++n}` }, deps());
      expect(r.reason).not.toBe("throttled");
    }
  });
});

describe("bot copy (REVIEW-qa-2)", () => {
  it("first reply has ONE opener: '¡Hola! Soy Chef. Para revisar tu pedido #1001, ¿me pasas el correo…?'", async () => {
    const t = await setupTenant(4);
    const c: OrdersConnector = { key: "shopify", isConnected: () => true, lookupOrderStatus: async () => ({ found: false }) };
    const r = await handleInbound(sim(t, "o1", "¿Dónde está mi pedido #1001?"), { llm: async () => "x", now: () => NOW, getOrdersConnector: () => c, notifyHandoff: async () => {}, usage: fakeMeter() });
    expect(r.text).toBe("¡Hola! Soy Chef. Para revisar tu pedido #1001, ¿me pasas el correo con el que hiciste tu compra?");
  });

  it("stripOpener drops a leading interjection at every tone and language, and leaves other text alone", () => {
    for (const lang of ["es", "en"] as const) for (const t of TONES) {
      const s = T.stripOpener(T.askEmail(lang, t, "1001"));
      expect(s, `${lang} ${t}`).toMatch(/^(Para|To) /);
    }
    expect(T.stripOpener("¡Buenas noticias! 🚚 Tu pedido")).toBe("¡Buenas noticias! 🚚 Tu pedido");
    expect(T.stripOpener("Claro, te comunico")).toBe("Claro, te comunico");
    expect(T.stripOpener("¡Perfecto!")).toBe("¡Perfecto!"); // nothing after it: keep
  });

  it("order status reads naturally per status, in both languages and all tones", () => {
    const cases: [string, RegExp, RegExp][] = [
      ["Enviado", /pedido #1001 ya va en camino\./, /order #1001 is on its way\./],
      ["Entregado", /pedido #1001 ya fue entregado\./, /order #1001 has been delivered\./],
      ["En preparación", /pedido #1001 está en preparación\./, /order #1001 is being prepared\./],
      ["Cancelado", /pedido #1001 fue cancelado\./, /order #1001 has been cancelled\./],
      ["Pago pendiente", /pedido #1001 tiene el pago pendiente\./, /order #1001 is waiting for payment\./],
      ["Enviado parcialmente", /pedido #1001 ya va en camino, en parte/, /order #1001 is partly on its way/],
    ];
    for (const [status, es, en] of cases) for (const t of TONES) {
      const a = T.orderFound("es", t, { orderNumber: "1001", statusText: status });
      const b = T.orderFound("en", t, { orderNumber: "1001", statusText: status });
      expect(a, `${status} es ${t}`).toMatch(es);
      expect(b, `${status} en ${t}`).toMatch(en);
      expect(a).not.toMatch(/está: |es: /);
      expect(b).not.toMatch(/is: /);
    }
    expect(T.orderFound("es", 5, { orderNumber: "1", statusText: "Cancelado" })).not.toMatch(/Buenas noticias/);
    expect(T.orderFound("es", 3, { orderNumber: "1", statusText: "Retenido en aduana" })).toBe("El estatus de tu pedido #1 es «Retenido en aduana».");
    expect(T.orderFound("es", 1, { orderNumber: "1" })).toBe("Le informamos que su pedido #1 está en proceso.");
  });

  it("delivery dates are written out in the customer's language", () => {
    const o = { orderNumber: "1001", statusText: "Enviado", estimatedDelivery: "2026-10-12" };
    expect(T.orderFound("es", 4, o, NOW)).toMatch(/Entrega estimada: 12 de octubre\./);
    expect(T.orderFound("en", 4, o, NOW)).toMatch(/Estimated delivery: October 12\./);
    expect(T.formatDeliveryDate("es", "2027-01-03", NOW)).toBe("3 de enero de 2027");
    expect(T.formatDeliveryDate("es", "next week", NOW)).toBe("next week");
  });

  it("media acknowledgement: pronoun agrees with the noun, and no 'una persona … una persona' repetition", () => {
    expect(attachmentReceived("es", 3, "image")).toBe("Recibimos tu foto, gracias. Alguien de nuestro equipo la va a revisar.");
    expect(attachmentReceived("es", 1, "audio")).toMatch(/su nota de voz, gracias\. Alguien de nuestro equipo la va a revisar/);
    expect(attachmentReceived("es", 4, "video")).toMatch(/tu video, gracias\. Alguien de nuestro equipo lo va a revisar/);
    expect(attachmentReceived("es", 5, "location")).toMatch(/la va a revisar/);
    expect(attachmentReceived("es", 5, "document")).toMatch(/lo va a revisar/);
    for (const t of TONES) expect(attachmentReceived("es", t, "image")).not.toMatch(/[Uu]na persona/);
  });
});
