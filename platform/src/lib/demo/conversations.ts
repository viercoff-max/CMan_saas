// Hand-written demo transcripts. They reuse the engine's approved templates (pure functions, no LLM, no I/O) so the
// wording matches what the real engine produces at tone 4. Customers and emails are fake.
import * as T from "../engine/templates";
import { urgentWhen } from "../engine/copy";
import { attachmentReceived } from "../engine/media";
import { formatBusinessHours, isOpenNow, parseBusinessHours } from "../engine/escalate";
import { mockLookup, MOCK_EMAIL } from "../shopify/mock";
import { serializeBusinessHours } from "../context/settings";
import { DEMO_HOURS, DEMO_SETTINGS, type DemoConv } from "./content";

const L = "es" as const;
const TONE = DEMO_SETTINGS.toneLevel;
const NAME = DEMO_SETTINGS.agentName;
const hello = T.shortHello(L, TONE, NAME);
const HOURS_JSON = serializeBusinessHours(DEMO_HOURS);

function order(num: string): string {
  const r = mockLookup(num, MOCK_EMAIL);
  return T.orderFound(L, TONE, {
    orderNumber: num, statusText: r.statusText, carrier: r.carrier, trackingNumber: r.trackingNumber,
    trackingUrl: r.trackingUrl, estimatedDelivery: r.estimatedDelivery,
  });
}

/** Handoff text exactly as engine.escalate composes it (intro + when) for the given moment. */
function handoff(kind: "human_request" | "no_answer", at: Date, intro?: string): string {
  const bh = parseBusinessHours(HOURS_JSON);
  const open = isOpenNow(bh, at);
  return `${intro ?? T.handoffIntro(kind, L, TONE)} ${T.handoffWhen(L, TONE, open, formatBusinessHours(bh, L))}`;
}
function safety(at: Date): string {
  const bh = parseBusinessHours(HOURS_JSON);
  return `${T.safetyIntro(L, TONE)} ${urgentWhen(L, TONE, isOpenNow(bh, at), formatBusinessHours(bh, L))}`;
}

export function buildConversations(now: Date): DemoConv[] {
  const at = (minsAgo: number) => new Date(now.getTime() - minsAgo * 60_000);
  const D = 24 * 60;
  return [
    {
      key: "orden-1001", channel: "whatsapp", name: "Valeria Ortiz", status: "resolved", startAgo: 2 * D + 180, unread: 0,
      msgs: [
        { from: "c", text: "Hola, ¿dónde está mi pedido?" },
        { from: "b", text: `${hello} ${T.askOrderNumber(L, TONE)}`, meta: { intent: "order_ask_number" } },
        { from: "c", text: "#1001", mins: 1 },
        { from: "b", text: T.askEmail(L, TONE), meta: { intent: "order_ask_email" } },
        { from: "c", text: MOCK_EMAIL, mins: 1 },
        { from: "b", text: order("#1001"), meta: { intent: "order_status" } },
        { from: "c", text: "Perfecto, muchas gracias", mins: 2 },
        { from: "b", text: T.offerDeclined(L, TONE), meta: { intent: "smalltalk" } },
      ],
    },
    {
      key: "orden-1003", channel: "instagram", name: "Diego Ramírez", status: "resolved", startAgo: 2 * D + 20, unread: 0,
      msgs: [
        { from: "c", text: "Buenas, quiero saber el estatus de mi pedido #1003" },
        { from: "b", text: `${hello} ${T.askEmail(L, TONE)}`, meta: { intent: "order_ask_email" } },
        { from: "c", text: MOCK_EMAIL, mins: 2 },
        { from: "b", text: order("#1003"), meta: { intent: "order_status" } },
        { from: "c", text: "Ya me llegó, gracias", mins: 3 },
        { from: "b", text: T.offerDeclined(L, TONE), meta: { intent: "smalltalk" } },
      ],
    },
    {
      key: "garantia", channel: "messenger", name: "Karla Mendoza", status: "resolved", startAgo: 28 * 60, unread: 0,
      msgs: [
        { from: "c", text: "¿Cuánto dura la garantía de la licuadora?" },
        {
          from: "b", meta: { intent: "knowledge", sourceHint: "warranty" },
          text: `${hello} Todos los productos Chefman, incluida la licuadora, tienen 1 año de garantía contra defectos de fabricación, a partir de la fecha de compra. Para hacerla válida necesitamos tu número de pedido y una descripción o foto del problema. ¿Te ayudo con algo más?`,
        },
        { from: "c", text: "¿Y cubre si se me cae el vaso?", mins: 2 },
        {
          from: "b", meta: { intent: "knowledge", sourceHint: "warranty" },
          text: "La garantía no cubre golpes, caídas ni mal uso; solo defectos de fabricación. ¿Te ayudo con algo más?",
        },
        { from: "c", text: "Entendido, gracias", mins: 1 },
      ],
    },
    {
      key: "receta-papas", channel: "whatsapp", name: "Luis Hernández", status: "resolved", startAgo: 20 * 60, unread: 0,
      msgs: [
        { from: "c", text: "Oye, ¿cómo hago papas crujientes en la freidora de aire?" },
        {
          from: "b", meta: { intent: "product_question", crossSell: true, sourceHint: "products" },
          text: `${hello} Precalienta la freidora 3 minutos, no sobrecargues la canasta y agita a la mitad de la cocción para que queden doradas parejo. En la AirCook 5L, las papas a la francesa quedan bien a 200 °C. ¿Te ayudo con algo más?\n\n¿Te interesaría conocer también la Freidora de aire Dual 8L?`,
        },
        { from: "c", text: "Genial, lo pruebo hoy", mins: 4 },
      ],
    },
    {
      key: "orden-1002", channel: "whatsapp", name: "Sofía Lara", status: "resolved", startAgo: 10 * 60, unread: 0,
      msgs: [
        { from: "c", text: "Hola, ¿ya salió mi pedido #1002?" },
        { from: "b", text: `${hello} ${T.askEmail(L, TONE)}`, meta: { intent: "order_ask_email" } },
        { from: "c", text: MOCK_EMAIL, mins: 1 },
        { from: "b", text: order("#1002"), meta: { intent: "order_status" } },
      ],
    },
    {
      key: "humano-hervidor", channel: "messenger", name: "Roberto Navarro", status: "human", reason: "human_request", startAgo: 3 * 60 + 40, unread: 0,
      msgs: [
        { from: "c", text: "Me llegó el hervidor con la tapa rota, quiero que me lo cambien" },
        { from: "b", text: handoff("human_request", at(3 * 60 + 39), "Los reembolsos, cancelaciones y cambios de dirección los ve una persona de nuestro equipo, así que te paso con ella."), meta: { intent: "action_request", escalated: true, escalationReason: "human_request" } },
        { from: "a", text: "Hola Roberto, soy Paola del equipo de Chefman. Lamento lo de la tapa. ¿Me compartes una foto del daño y tu número de pedido para gestionar el cambio por garantía?", mins: 25, meta: { agent: "Paola (demo)" } },
        { from: "c", text: "Claro, ahorita te la mando", mins: 6 },
      ],
    },
    {
      key: "sin-respuesta", channel: "whatsapp", name: "Fernanda Ibarra", status: "needs_human", reason: "no_answer", startAgo: 5 * 60, unread: 1,
      msgs: [
        { from: "c", text: "¿La arrocera se puede usar con un convertidor de voltaje para 220V?" },
        { from: "b", text: `${hello} ${T.clarify(L, TONE)}`, meta: { intent: "clarify" } },
        { from: "c", text: "Sí, la RiceMaster, la quiero llevar de viaje a Europa", mins: 2 },
        { from: "b", text: handoff("no_answer", at(5 * 60 - 3)), meta: { intent: "no_answer", escalated: true, escalationReason: "no_answer" } },
        { from: "c", text: "Ok, espero", mins: 4 },
      ],
    },
    {
      key: "foto", channel: "instagram", name: "Pablo Aguilar", status: "needs_human", reason: "human_request", startAgo: 95, unread: 1,
      msgs: [
        { from: "c", text: "[Foto]", meta: { media: "image" } },
        { from: "b", text: handoff("human_request", at(94), attachmentReceived(L, TONE, "image")), meta: { intent: "attachment", media: "image", escalated: true, escalationReason: "human_request" } },
        { from: "c", text: "[Foto] así quedó la canasta después de usarla", mins: 3, meta: { media: "image" } },
      ],
    },
    {
      key: "persona", channel: "instagram", name: "Mariana Cruz", status: "needs_human", reason: "human_request", startAgo: 48, unread: 1,
      msgs: [
        { from: "c", text: "quiero hablar con una persona" },
        { from: "b", text: handoff("human_request", at(47)), meta: { intent: "escalation_human_request", escalated: true, escalationReason: "human_request" } },
      ],
    },
    {
      key: "seguridad", channel: "whatsapp", name: "Andrea Soto", status: "needs_human", reason: "safety", startAgo: 22, unread: 2,
      msgs: [
        { from: "c", text: "mi licuadora echó humo" },
        { from: "b", text: safety(at(21)), meta: { intent: "escalation_safety", escalated: true, escalationReason: "safety" } },
        { from: "c", text: "ya la desconecté, ¿alguien me puede ayudar por favor?", mins: 5 },
      ],
    },
  ];
}
