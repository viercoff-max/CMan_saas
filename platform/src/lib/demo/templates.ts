// Demo business templates ("Crear negocio demo"): fake, editable sample businesses any signed-in user can create to
// show the product. Pure data + pure template functions (no DB, no network, no LLM). Customers, emails and orders are
// fake (the Shopify demo store). The kitchen template reuses the local demo content with the brand name replaced.
import * as T from "../engine/templates";
import { formatBusinessHours, isOpenNow, parseBusinessHours } from "../engine/escalate";
import { mockLookup, MOCK_EMAIL } from "../shopify/mock";
import { serializeBusinessHours } from "../context/settings";
import type { ContextSectionKey } from "../types";
import { DEMO_SECTIONS, type DemoConv } from "./content";
import { buildConversations } from "./conversations";

export const DEMO_TEMPLATE_KEYS = ["cocina", "moda", "cafe"] as const;
export type DemoTemplateKey = (typeof DEMO_TEMPLATE_KEYS)[number];
export const isDemoTemplate = (k: unknown): k is DemoTemplateKey => typeof k === "string" && (DEMO_TEMPLATE_KEYS as readonly string[]).includes(k);

export interface DemoTemplate {
  key: DemoTemplateKey;
  /** Default business name shown in the form (the user may change it). */
  defaultName: string;
  agentName: string;
  toneLevel: 1 | 2 | 3 | 4 | 5;
  crossSellLevel: 0 | 1 | 2 | 3;
  hours: { fromDay: number; toDay: number; open: string; close: string; timezone: string };
  brand: { primaryColor: string; accentColor: string; menuBgColor: string };
  /** Connect the Shopify demo store (orders #1001-#1004 with test@example.com). */
  shopify: boolean;
  sections: (name: string) => Record<ContextSectionKey, string>;
  conversations: (now: Date, name: string) => DemoConv[];
}

const L = "es" as const;
const D = 24 * 60;
const MX = "America/Mexico_City";

function helpers(agentName: string, tone: 1 | 2 | 3 | 4 | 5, hours: DemoTemplate["hours"], now: Date) {
  const bh = parseBusinessHours(serializeBusinessHours(hours));
  const at = (minsAgo: number) => new Date(now.getTime() - minsAgo * 60_000);
  return {
    hello: T.shortHello(L, tone, agentName),
    at,
    order: (num: string) => {
      const r = mockLookup(num, MOCK_EMAIL);
      return T.orderFound(L, tone, {
        orderNumber: num, statusText: r.statusText, carrier: r.carrier, trackingNumber: r.trackingNumber,
        trackingUrl: r.trackingUrl, estimatedDelivery: r.estimatedDelivery,
      });
    },
    handoff: (kind: "human_request" | "no_answer", when: Date, intro?: string) =>
      `${intro ?? T.handoffIntro(kind, L, tone)} ${T.handoffWhen(L, tone, isOpenNow(bh, when), formatBusinessHours(bh, L))}`,
  };
}

/** Whole-word brand swap in the kitchen demo ("Chefman" is the local demo brand, not shown to other businesses). */
const swapBrand = (s: string, name: string) => s.replace(/Chefman/g, name);

const cocina: DemoTemplate = {
  key: "cocina", defaultName: "Cocina Feliz (demo)", agentName: "Chef", toneLevel: 4, crossSellLevel: 1,
  hours: { fromDay: 1, toDay: 5, open: "09:00", close: "18:00", timezone: MX },
  brand: { primaryColor: "#C2410C", accentColor: "#1C1917", menuBgColor: "#FFF7ED" },
  shopify: true,
  sections: (name) => Object.fromEntries(Object.entries(DEMO_SECTIONS).map(([k, v]) => [k, swapBrand(v, name)])) as Record<ContextSectionKey, string>,
  conversations: (now, name) => buildConversations(now).map((c) => ({ ...c, msgs: c.msgs.map((m) => ({ ...m, text: swapBrand(m.text, name) })) })),
};

const moda: DemoTemplate = {
  key: "moda", defaultName: "Moda Norte (demo)", agentName: "Sofi", toneLevel: 4, crossSellLevel: 2,
  hours: { fromDay: 1, toDay: 6, open: "10:00", close: "19:00", timezone: MX },
  brand: { primaryColor: "#7C3AED", accentColor: "#1E1B4B", menuBgColor: "#F5F3FF" },
  shopify: true,
  sections: (name) => ({
    business: `# Sobre ${name}\n${name} es una tienda en línea de ropa casual para mujer y hombre: playeras, jeans, vestidos y chamarras. Vendemos en México y enviamos a todo el país.\n\n# Atención\nAtendemos de lunes a sábado de 10:00 a 19:00 (hora del centro de México).`,
    products: `# Jeans Recto Clásico\nMezclilla 98% algodón y 2% elastano. Tallas 26 a 38. Colores: azul medio y negro. Precio: $749 MXN.\n\n# Playera Básica Algodón\n100% algodón peinado. Tallas CH, M, G y EG. Seis colores. Precio: $299 MXN.\n\n# Vestido Midi Lino\nLino y viscosa, con bolsas laterales. Tallas CH a G. Precio: $1,190 MXN.\n\n# Chamarra de Mezclilla\nCorte oversize. Tallas CH a EG. Precio: $1,290 MXN.`,
    shipping_returns: `# Envíos\nEnvío gratis en compras desde $999 MXN; si no, cuesta $99 MXN. Entrega de 2 a 5 días hábiles con número de guía.\n\n# Cambios y devoluciones\nCambios de talla gratis dentro de 30 días, con etiquetas y sin uso. Los reembolsos los gestiona una persona del equipo.`,
    warranty: `# Calidad\nSi una prenda llega con un defecto de fabricación (costura abierta, cierre roto), la cambiamos sin costo dentro de 30 días. Se necesita el número de pedido y una foto.`,
    faq: `# Guía de tallas\nJeans: mide tu cintura; talla 28 = 71 cm, 30 = 76 cm, 32 = 81 cm, 34 = 86 cm.\nPlayeras: CH = pecho 88 cm, M = 96 cm, G = 104 cm, EG = 112 cm.\n¿Las prendas encogen? El algodón puede encoger hasta 3% si se seca en secadora; recomendamos secar al aire.`,
    escalation: `# Pasar con una persona\nPasa con una persona cuando el cliente pida reembolsos, cancelaciones o cambios de dirección, cuando pida hablar con una persona, cuando envíe fotos o cuando no haya información suficiente para responder con certeza.`,
    dos_donts: `# Sí\nResponder con calidez y en español de México, usando solo esta información.\n\n# No\nNo inventar descuentos, precios ni existencias. No prometer fechas exactas de entrega. No pedir datos personales salvo número de pedido y correo.`,
    extra: `# Cuidado de prendas\nLava con agua fría, al revés y con colores similares. No uses cloro.`,
  }),
  conversations: (now) => {
    const h = helpers("Sofi", 4, moda.hours, now);
    return [
      {
        key: "orden-1001", channel: "whatsapp", name: "Lucía Peña", status: "resolved", startAgo: D + 200, unread: 0,
        msgs: [
          { from: "c", text: "Hola, ¿ya viene mi pedido #1001?" },
          { from: "b", text: `${h.hello} ${T.askEmail(L, 4)}`, meta: { intent: "order_ask_email" } },
          { from: "c", text: MOCK_EMAIL, mins: 1 },
          { from: "b", text: h.order("#1001"), meta: { intent: "order_status" } },
          { from: "c", text: "Gracias!", mins: 2 },
        ],
      },
      {
        key: "talla", channel: "instagram", name: "Andrés Gil", status: "resolved", startAgo: 6 * 60, unread: 0,
        msgs: [
          { from: "c", text: "¿Qué talla de jeans soy si mi cintura mide 81 cm?" },
          { from: "b", meta: { intent: "knowledge", sourceHint: "faq" }, text: `${h.hello} Con 81 cm de cintura te corresponde la talla 32 en el Jeans Recto Clásico. Si quedara grande o chico, el cambio de talla es gratis dentro de 30 días. ¿Te ayudo con algo más?` },
          { from: "c", text: "Perfecto, lo pido en negro", mins: 3 },
        ],
      },
      {
        key: "reembolso", channel: "messenger", name: "Paty Rosas", status: "needs_human", reason: "human_request", startAgo: 70, unread: 1,
        msgs: [
          { from: "c", text: "Quiero que me devuelvan mi dinero del vestido" },
          { from: "b", text: h.handoff("human_request", h.at(69), "Los reembolsos los ve una persona de nuestro equipo, así que te paso con ella."), meta: { intent: "action_request", escalated: true, escalationReason: "human_request" } },
        ],
      },
      {
        key: "persona", channel: "whatsapp", name: "Jorge Vega", status: "needs_human", reason: "human_request", startAgo: 15, unread: 1,
        msgs: [
          { from: "c", text: "¿Me pueden atender por favor? quiero hablar con alguien" },
          { from: "b", text: h.handoff("human_request", h.at(14)), meta: { intent: "escalation_human_request", escalated: true, escalationReason: "human_request" } },
        ],
      },
    ];
  },
};

const cafe: DemoTemplate = {
  key: "cafe", defaultName: "Café Aurora (demo)", agentName: "Aurora", toneLevel: 5, crossSellLevel: 1,
  hours: { fromDay: 1, toDay: 7, open: "08:00", close: "21:00", timezone: MX },
  brand: { primaryColor: "#92400E", accentColor: "#292524", menuBgColor: "#FAF5EF" },
  shopify: false,
  sections: (name) => ({
    business: `# Sobre ${name}\n${name} es una cafetería de especialidad con panadería propia. Abrimos todos los días de 8:00 a 21:00. Estamos en Av. Ejemplo 123, colonia Centro (dirección ficticia de demostración).`,
    products: `# Bebidas\nAmericano $45, Latte $60, Capuchino $60, Chai latte $65, Frappé de moka $75 MXN. Leche de almendra o avena +$10.\n\n# Panadería\nConcha $25, Croissant $40, Rol de canela $45, Pan de plátano $50 MXN.\n\n# Desayunos (8:00 a 12:00)\nChilaquiles $120, Molletes $95, Avena con fruta $85 MXN.`,
    shipping_returns: `# Pedidos a domicilio\nEntregamos a menos de 3 km a través de apps de reparto. Pedidos para recoger: se preparan en 15 minutos.\n\n# Pedidos grandes\nPara eventos y pedidos de más de 20 piezas se necesita 48 horas de anticipación; los confirma una persona del equipo.`,
    warranty: `# Satisfacción\nSi tu bebida no quedó como la pediste, avísanos en la barra y la preparamos de nuevo sin costo.`,
    faq: `¿Tienen opciones veganas? Sí: leche de avena o almendra y el pan de plátano es vegano.\n¿Tienen wifi? Sí, gratis para clientes.\n¿Aceptan mascotas? Sí, en la terraza.\n¿Hacen reservaciones? Solo para grupos de 8 personas o más; las confirma una persona del equipo.`,
    escalation: `# Pasar con una persona\nPasa con una persona para reservaciones de grupos, pedidos para eventos, quejas, alergias o reacciones alérgicas, y cuando el cliente pida hablar con alguien.`,
    dos_donts: `# Sí\nResponder con mucha calidez y brevedad. Mencionar el horario cuando ayude.\n\n# No\nNo inventar promociones ni precios. No confirmar reservaciones: solo una persona del equipo puede hacerlo. No dar consejos médicos sobre alergias.`,
    extra: `# Alergias\nNuestra cocina maneja gluten, lácteos, huevo y nueces. No podemos garantizar ausencia de trazas.`,
  }),
  conversations: (now) => {
    const h = helpers("Aurora", 5, cafe.hours, now);
    return [
      {
        key: "horario", channel: "instagram", name: "Camila Ruiz", status: "resolved", startAgo: D + 30, unread: 0,
        msgs: [
          { from: "c", text: "¿A qué hora abren el domingo?" },
          { from: "b", meta: { intent: "knowledge", sourceHint: "business" }, text: `${h.hello} ¡Abrimos todos los días de 8:00 a 21:00, domingo incluido! Los desayunos se sirven de 8:00 a 12:00. ¿Te ayudo con algo más?` },
          { from: "c", text: "Súper, ahí nos vemos", mins: 2 },
        ],
      },
      {
        key: "vegano", channel: "whatsapp", name: "Iván Cortés", status: "resolved", startAgo: 4 * 60, unread: 0,
        msgs: [
          { from: "c", text: "¿Tienen algo vegano?" },
          { from: "b", meta: { intent: "knowledge", sourceHint: "faq" }, text: `${h.hello} ¡Sí! Puedes pedir cualquier bebida con leche de avena o almendra (+$10) y nuestro pan de plátano es vegano. ¿Te ayudo con algo más?` },
        ],
      },
      {
        key: "reservacion", channel: "messenger", name: "Elena Treviño", status: "needs_human", reason: "human_request", startAgo: 40, unread: 1,
        msgs: [
          { from: "c", text: "Quiero reservar para 12 personas el sábado a las 10" },
          { from: "b", text: h.handoff("human_request", h.at(39), "Las reservaciones de grupos las confirma una persona de nuestro equipo, así que te paso con ella."), meta: { intent: "action_request", escalated: true, escalationReason: "human_request" } },
        ],
      },
    ];
  },
};

export const DEMO_TEMPLATES: Readonly<Record<DemoTemplateKey, DemoTemplate>> = { cocina, moda, cafe };
