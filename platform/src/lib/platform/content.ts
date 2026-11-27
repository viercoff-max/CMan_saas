// Copy for the public pages (Spanish default + English). Honest copy only: no invented numbers, testimonials,
// customer logos or prices. Tokens, all driven by lib/platform/brand.ts:
//   {brand} = PLATFORM_BRAND.name, {entity} = legalEntityName, {contact} = privacyContactEmail, {address} = legalAddress.
// A legal field that is still null renders as a clearly marked owner-fillable field "[Completar: razón social]"
// (never a plausible-looking gap like "(razón social por definir)"), see fillParts / LegalDocView.
import type { Locale } from "../i18n-shared";
import { LEGAL_FIELD_LABEL, PLATFORM_BRAND, type LegalField } from "./brand";
import { availableChannels, channelChips, comingSoonChannels, listNames, type PublicChannel } from "./channels";

export interface LegalSection { h: string; p: string[] }
export interface LegalDoc { title: string; description: string; intro: string; sections: LegalSection[] }

const TOKENS: Record<string, LegalField> = { "{entity}": "legalEntityName", "{contact}": "privacyContactEmail", "{address}": "legalAddress" };
const TOKEN_RE = /(\{brand\}|\{entity\}|\{contact\}|\{address\})/;

export type LegalPart =
  | { kind: "text"; text: string }
  | { kind: "email"; email: string }
  | { kind: "missing"; field: LegalField; label: string };

/** "[Completar: razón social]" / "[Fill in: legal entity name]". */
export function missingMarker(field: LegalField, locale: Locale): string {
  return `[${locale === "en" ? "Fill in" : "Completar"}: ${LEGAL_FIELD_LABEL[field][locale]}]`;
}

/** Splits a template into renderable parts (text / mailto e-mail / missing owner-fillable field). */
export function fillParts(s: string, locale: Locale, b: { [K in LegalField]: string | null } = PLATFORM_BRAND): LegalPart[] {
  const out: LegalPart[] = [];
  for (const piece of s.split(TOKEN_RE)) {
    if (!piece) continue;
    if (piece === "{brand}") { out.push({ kind: "text", text: PLATFORM_BRAND.name }); continue; }
    const field = TOKENS[piece];
    if (!field) { out.push({ kind: "text", text: piece }); continue; }
    const v = b[field]?.trim();
    if (!v) out.push({ kind: "missing", field, label: missingMarker(field, locale) });
    else out.push(field === "privacyContactEmail" ? { kind: "email", email: v } : { kind: "text", text: v });
  }
  return out;
}

/** Plain-text version (metadata, tests). Missing fields become "[Completar: …]". */
export function fill(s: string, locale: Locale, b?: { [K in LegalField]: string | null }): string {
  return fillParts(s, locale, b).map((p) => (p.kind === "text" ? p.text : p.kind === "email" ? p.email : p.label)).join("");
}

export const completeNotice = {
  es: { title: "Completar antes de publicar", body: "Faltan datos del responsable. Complétalos en src/lib/platform/brand.ts antes de dar estas direcciones a Meta o publicarlas:" },
  en: { title: "Complete before publishing", body: "Some controller details are missing. Fill them in src/lib/platform/brand.ts before giving these URLs to Meta or publishing them:" },
} satisfies Record<Locale, { title: string; body: string }>;

export const deletionRequest = {
  es: { title: "Pedir la eliminación por correo", button: "Escribir para pedir la eliminación", subject: "Solicitud de eliminación de datos", missing: "El correo para recibir solicitudes todavía no está configurado." },
  en: { title: "Ask for deletion by e-mail", button: "Write to ask for deletion", subject: "Data deletion request", missing: "The e-mail for receiving requests is not configured yet." },
} satisfies Record<Locale, { title: string; button: string; subject: string; missing: string }>;

export const draftBanner = {
  es: { title: "Borrador: debe revisarlo un abogado antes de publicarse.", body: "Este texto es un punto de partida y todavía no es un documento legal vigente." },
  en: { title: "Draft: a lawyer must review it before it is published.", body: "This text is a starting point and is not yet a binding legal document." },
} satisfies Record<Locale, { title: string; body: string }>;

// ---------------- landing ----------------
// Proposal B (design/landing-2026/PROPUESTA-B.md): customer SUPPORT for small, mid-size and large companies.
// Channel availability always comes from lib/platform/channels.ts; the inbox and timeline examples only use channels
// that work today, so the page never shows a conversation on a channel a visitor cannot connect yet.
export type LandingState = "bot" | "team" | "done";
export interface LandingRow { name: string; ch: PublicChannel; time: string; text: string; state: LandingState; label: string; selected?: boolean }
export interface LandingPin { time: string; ch: PublicChannel; text: string; state: LandingState; label: string; at: number; high?: boolean }

const sentenceList = (chs: readonly PublicChannel[], locale: Locale) =>
  listNames(chs, locale).replace(/\bCorreo\b/, "correo").replace(/\bEmail\b/, "email");

function landingLead(locale: Locale): string {
  const live = sentenceList(availableChannels(), locale);
  const soon = comingSoonChannels();
  if (locale === "en") {
    return `${PLATFORM_BRAND.name} answers the usual questions on ${live}${soon.length ? ` (${sentenceList(soon, "en")} soon)` : ""}. Whatever needs a person reaches your team with the whole conversation, so no customer has to explain twice.`;
  }
  return `${PLATFORM_BRAND.name} resuelve las preguntas de siempre en ${live}${soon.length ? ` (y pronto en ${sentenceList(soon, "es")})` : ""}. Lo que necesita a una persona llega a tu equipo con toda la conversación, para que nadie tenga que volver a explicar.`;
}

export const landing = {
  es: {
    metaTitle: "Soporte al cliente que contesta a cualquier hora",
    metaDescription: "Conversa contesta las preguntas de siempre de tus clientes y pasa a tu equipo lo que necesita a una persona, con toda la conversación. Para empresas pequeñas, medianas y grandes.",
    nav: { how: "Cómo funciona", team: "Para tu equipo", sizes: "Empresas", trust: "Seguridad", pricing: "Precios" },
    kicker: "Soporte al cliente con IA y con tu equipo",
    titleBefore: "Tu soporte contesta, aunque sean las",
    time: "3:07 a.m.",
    lead: landingLead("es"),
    ctaPrimary: "Crear cuenta",
    ctaSales: "Hablar con ventas",
    ctaPlans: "Ver planes",
    ctaSecondary: "Entrar",
    channelsTitle: "Un solo lugar para",
    channels: channelChips("es"), // single source: lib/platform/channels.ts
    inbox: {
      label: "Ejemplo de la bandeja de soporte",
      example: "Ejemplo",
      title: "Bandeja de soporte",
      filters: ["Todas", "Para tu equipo · 2", "Resueltas"],
      rows: [
        { name: "Mariana R.", ch: "whatsapp", time: "01:14", text: "No me llega el código para entrar", state: "bot", label: "contestó el asistente" },
        { name: "Raúl C.", ch: "telegram", time: "07:02", text: "¿Me reenvían la factura del pedido 4821?", state: "bot", label: "contestó el asistente" },
        { name: "Lalo M.", ch: "whatsapp", time: "12:30", text: "Mi pedido llegó dañado", state: "team", label: "para tu equipo · Ana", selected: true },
        { name: "Jorge T.", ch: "telegram", time: "16:45", text: "¿Cómo cambio mi dirección?", state: "bot", label: "contestó el asistente" },
        { name: "Sofía L.", ch: "whatsapp", time: "22:48", text: "Quiero cancelar mi suscripción", state: "team", label: "para tu equipo" },
        { name: "Diana P.", ch: "telegram", time: "Ayer", text: "Gracias, ya quedó", state: "done", label: "resuelta" },
      ] satisfies LandingRow[],
      conv: {
        who: "Lalo M. · WhatsApp",
        since: "Cliente desde marzo · 3 conversaciones",
        assigned: "Asignada a Ana",
        assistant: "ASISTENTE",
        messages: [
          { from: "customer", text: "hola, mi pedido llegó con la tapa rota 😕", time: "12:30" },
          { from: "assistant", text: "Lamento mucho eso. ¿Me compartes tu número de pedido para revisarlo?", time: "12:30" },
          { from: "customer", text: "es el 4907", time: "12:31" },
        ],
        handoff: "↪ Pasada a tu equipo · motivo: producto dañado",
        noteLabel: "NOTA INTERNA · ANA",
        note: "Ya revisé el pedido 4907. Ofrecer reposición sin costo.",
        composer: "Escribe tu respuesta…",
        send: "Responder",
      },
    },
    day: {
      title: "Las preguntas no esperan a que abras.",
      sub: "Un día de soporte. Lo que el asistente puede resolver, lo resuelve. Lo demás espera a tu equipo, en orden y con contexto.",
      open: "tu horario de soporte · 9:00 a 19:00",
      pins: [
        { time: "01:14", ch: "whatsapp", text: "No me llega el código para entrar", state: "bot", label: "✓ contestó el asistente", at: 1.2 },
        { time: "07:02", ch: "telegram", text: "¿Me reenvían la factura del pedido 4821?", state: "bot", label: "✓ contestó el asistente", at: 7, high: true },
        { time: "12:30", ch: "whatsapp", text: "Mi pedido llegó dañado 😕", state: "team", label: "↪ lo tomó Ana", at: 12.5 },
        { time: "16:45", ch: "telegram", text: "¿Cómo cambio mi dirección de envío?", state: "bot", label: "✓ contestó el asistente", at: 16.75, high: true },
        { time: "22:48", ch: "whatsapp", text: "Quiero cancelar mi suscripción", state: "team", label: "↪ para tu equipo a las 9:00", at: 22.8 },
      ] satisfies LandingPin[],
    },
    flow: {
      title: "Del primer mensaje a resuelto, sin que el cliente repita nada.",
      steps: [
        { h: "Llega el mensaje", p: "Por cualquiera de tus canales. Todo cae en la misma bandeja." },
        { h: "El asistente contesta", p: "Con tus políticas, guías y preguntas frecuentes. Si no sabe algo, no lo inventa." },
        { h: "Pasa a tu equipo", p: "Quejas, cancelaciones, pagos o quien pida una persona. Llega con la conversación completa." },
        { h: "Tu equipo resuelve", p: "Responde desde la bandeja, deja notas internas y la marca como resuelta." },
      ],
    },
    sizes: {
      title: "Para el tamaño de tu operación.",
      sub: "Empieza con una persona contestando todo o con un equipo de soporte por turnos. Conversa crece contigo.",
      items: [
        { who: "EMPRESA PEQUEÑA", h: "Tú y el asistente", p: "El asistente contesta lo de siempre y te avisa cuando alguien te necesita.", items: ["Listo en una tarde", "Avisos en tu celular y tu computadora", "Simulador para probar antes de abrir"] },
        { who: "EMPRESA MEDIANA", h: "Un equipo, una bandeja", p: "Todo tu equipo atiende desde el mismo lugar, sin pisarse ni dejar mensajes olvidados.", items: ["Asignación de conversaciones", "Roles de administrador y agente", "Notas internas e historial del cliente"] },
        { who: "EMPRESA GRANDE", h: "Varias marcas, un control", p: "Cada marca o área con su asistente, su equipo y sus datos separados.", items: ["Cambia de marca con el mismo usuario", "Tu logo y tus colores en el panel", "Configuración asistida (con costo adicional)"] },
      ],
    },
    team: {
      title: "Hecho para el día a día de un equipo de soporte.",
      items: [
        { h: "Una bandeja para todo", p: "Todos tus canales en una sola lista, con filtros por estado." },
        { h: "Pasa a una persona a tiempo", p: "Cuando el cliente lo pide, cuando el tema es delicado o cuando el asistente no sabe la respuesta." },
        { h: "Asignación y estados", p: "Toma una conversación, asígnala, devuélvela al asistente o márcala como resuelta." },
        { h: "Notas internas", p: "Tu equipo se deja contexto entre turnos. El cliente nunca las ve." },
        { h: "Avisos al momento", p: "Cuando algo llega para tu equipo, se entera en el celular y en la computadora." },
        { h: "Métricas en tu tablero", p: "Las conversaciones del día y cuántas necesitaron a tu equipo." },
      ],
    },
    trust: {
      title: "Los datos de tus clientes, bien cuidados.",
      sub: "Lo que prometemos, por escrito.",
      items: [
        { h: "Datos separados", p: "Cada empresa ve solo sus conversaciones y sus clientes." },
        { h: "Retención", p: "Los mensajes viejos se borran solos pasado un tiempo." },
        { h: "Datos ocultos", p: "Los correos de tus clientes aparecen enmascarados en el panel." },
        { h: "Derecho de borrado", p: "Si un cliente lo pide, se eliminan sus datos." },
        { h: "Sin inventos", p: "El asistente solo usa tu información. Si no sabe algo, no lo inventa." },
      ],
    },
    finalTitle: "Dile hola a cada cliente, a la hora que escriba.",
    honest: "Estamos en una etapa temprana: todavía no publicamos precios ni cifras de clientes.",
    pricingLink: "Ver planes",
  },
  en: {
    metaTitle: "Customer support that answers at any hour",
    metaDescription: "Conversa answers your customers' usual questions and hands whatever needs a person to your team, with the whole conversation. For small, mid-size and large companies.",
    nav: { how: "How it works", team: "For your team", sizes: "Companies", trust: "Security", pricing: "Pricing" },
    kicker: "Customer support with AI and your team",
    titleBefore: "Your support answers, even at",
    time: "3:07 a.m.",
    lead: landingLead("en"),
    ctaPrimary: "Create account",
    ctaSales: "Talk to sales",
    ctaPlans: "See plans",
    ctaSecondary: "Sign in",
    channelsTitle: "One place for",
    channels: channelChips("en"),
    inbox: {
      label: "Example of the support inbox",
      example: "Example",
      title: "Support inbox",
      filters: ["All", "For your team · 2", "Resolved"],
      rows: [
        { name: "Mariana R.", ch: "whatsapp", time: "01:14", text: "My sign-in code never arrives", state: "bot", label: "answered by the assistant" },
        { name: "Raúl C.", ch: "telegram", time: "07:02", text: "Can you resend the invoice for order 4821?", state: "bot", label: "answered by the assistant" },
        { name: "Lalo M.", ch: "whatsapp", time: "12:30", text: "My order arrived damaged", state: "team", label: "for your team · Ana", selected: true },
        { name: "Jorge T.", ch: "telegram", time: "16:45", text: "How do I change my address?", state: "bot", label: "answered by the assistant" },
        { name: "Sofía L.", ch: "whatsapp", time: "22:48", text: "I want to cancel my subscription", state: "team", label: "for your team" },
        { name: "Diana P.", ch: "telegram", time: "Yesterday", text: "Thanks, all sorted", state: "done", label: "resolved" },
      ] satisfies LandingRow[],
      conv: {
        who: "Lalo M. · WhatsApp",
        since: "Customer since March · 3 conversations",
        assigned: "Assigned to Ana",
        assistant: "ASSISTANT",
        messages: [
          { from: "customer", text: "hi, my order arrived with a broken lid 😕", time: "12:30" },
          { from: "assistant", text: "I am sorry about that. Could you share your order number so I can check it?", time: "12:30" },
          { from: "customer", text: "it is 4907", time: "12:31" },
        ],
        handoff: "↪ Handed to your team · reason: damaged product",
        noteLabel: "INTERNAL NOTE · ANA",
        note: "Checked order 4907. Offer a free replacement.",
        composer: "Write your reply…",
        send: "Reply",
      },
    },
    day: {
      title: "Questions do not wait until you open.",
      sub: "A day of support. What the assistant can solve, it solves. The rest waits for your team, in order and with context.",
      open: "your support hours · 9:00 to 19:00",
      pins: [
        { time: "01:14", ch: "whatsapp", text: "My sign-in code never arrives", state: "bot", label: "✓ answered by the assistant", at: 1.2 },
        { time: "07:02", ch: "telegram", text: "Can you resend the invoice for order 4821?", state: "bot", label: "✓ answered by the assistant", at: 7, high: true },
        { time: "12:30", ch: "whatsapp", text: "My order arrived damaged 😕", state: "team", label: "↪ Ana took it", at: 12.5 },
        { time: "16:45", ch: "telegram", text: "How do I change my delivery address?", state: "bot", label: "✓ answered by the assistant", at: 16.75, high: true },
        { time: "22:48", ch: "whatsapp", text: "I want to cancel my subscription", state: "team", label: "↪ for your team at 9:00", at: 22.8 },
      ] satisfies LandingPin[],
    },
    flow: {
      title: "From the first message to resolved, without the customer repeating anything.",
      steps: [
        { h: "A message arrives", p: "On any of your channels. Everything lands in the same inbox." },
        { h: "The assistant answers", p: "From your policies, guides and FAQ. If it does not know, it does not make it up." },
        { h: "It reaches your team", p: "Complaints, cancellations, payments or anyone asking for a person. With the whole conversation." },
        { h: "Your team resolves it", p: "Reply from the inbox, leave internal notes and mark it as resolved." },
      ],
    },
    sizes: {
      title: "For the size of your operation.",
      sub: "Start with one person answering everything or with a support team working in shifts. Conversa grows with you.",
      items: [
        { who: "SMALL COMPANY", h: "You and the assistant", p: "The assistant answers the usual questions and tells you when someone needs you.", items: ["Ready in an afternoon", "Notices on your phone and computer", "A simulator to try it before going live"] },
        { who: "MID-SIZE COMPANY", h: "One team, one inbox", p: "Your whole team works from the same place, without stepping on each other or forgetting messages.", items: ["Conversation assignment", "Admin and agent roles", "Internal notes and customer history"] },
        { who: "LARGE COMPANY", h: "Several brands, one control", p: "Each brand or area with its own assistant, team and separate data.", items: ["Switch brands with the same user", "Your logo and colours in the panel", "Assisted setup (extra cost)"] },
      ],
    },
    team: {
      title: "Built for the day-to-day of a support team.",
      items: [
        { h: "One inbox for everything", p: "All your channels in one list, with filters by status." },
        { h: "A person, right on time", p: "When the customer asks, when the topic is sensitive or when the assistant does not know the answer." },
        { h: "Assignment and statuses", p: "Take a conversation, assign it, return it to the assistant or mark it as resolved." },
        { h: "Internal notes", p: "Your team leaves context between shifts. The customer never sees them." },
        { h: "Instant notices", p: "When something arrives for your team, they know on their phone and computer." },
        { h: "Metrics on your dashboard", p: "Today's conversations and how many needed your team." },
      ],
    },
    trust: {
      title: "Your customers' data, well looked after.",
      sub: "What we promise, in writing.",
      items: [
        { h: "Separate data", p: "Each company only sees its own conversations and customers." },
        { h: "Retention", p: "Old messages are deleted automatically after a while." },
        { h: "Masked data", p: "Your customers' e-mails are masked in the panel." },
        { h: "Right to erasure", p: "If a customer asks, their data is deleted." },
        { h: "No making things up", p: "The assistant only uses your information. If it does not know, it does not make it up." },
      ],
    },
    finalTitle: "Say hello to every customer, whenever they write.",
    honest: "We are at an early stage: we do not publish prices or customer figures yet.",
    pricingLink: "See plans",
  },
} satisfies Record<Locale, unknown>;

// ---------------- pricing ----------------
export const pricing = {
  es: {
    metaTitle: "Precios",
    metaDescription: "Planes Gratis, Pro y Negocio. Los precios todavía no están definidos.",
    title: "Planes",
    lead: "Los precios todavía no están definidos. No se cobra nada desde este sitio: cuando haya precios, se publicarán aquí antes de cobrar.",
    priceTbd: "Precio por definir",
    cta: "Crear cuenta",
    plans: [
      { name: "Gratis", for: "Para probar con tu negocio.", items: ["Un canal (Telegram o WhatsApp)", "Asistente con tu información", "Bandeja y simulador", "Uso de IA con un tope mensual bajo"] },
      { name: "Pro", for: "Para un negocio con equipo.", items: ["Todo lo de Gratis", "Más uso de IA al mes", "Varios miembros del equipo", "Tu marca en el panel"] },
      { name: "Negocio", for: "Para más volumen y más canales.", items: ["Todo lo de Pro", "El mayor tope de IA", "Más canales cuando estén disponibles", "Soporte prioritario"] },
    ],
    note: "Lo que incluye cada plan puede cambiar antes del lanzamiento. ¿No quieres hacer la parte técnica? Ofrecemos configuración asistida (WhatsApp, Telegram, Shopify y tu contexto) como soporte con costo adicional.",
  },
  en: {
    metaTitle: "Pricing",
    metaDescription: "Free, Pro and Business plans. Prices are not defined yet.",
    title: "Plans",
    lead: "Prices are not defined yet. Nothing is charged from this site: when there are prices, they will be published here before any charge.",
    priceTbd: "Price to be defined",
    cta: "Create account",
    plans: [
      { name: "Free", for: "To try it with your business.", items: ["One channel (Telegram or WhatsApp)", "Assistant with your information", "Inbox and simulator", "AI usage with a low monthly cap"] },
      { name: "Pro", for: "For a business with a team.", items: ["Everything in Free", "More AI usage per month", "Several team members", "Your brand in the panel"] },
      { name: "Business", for: "For more volume and more channels.", items: ["Everything in Pro", "The highest AI cap", "More channels as they become available", "Priority support"] },
    ],
    note: "What each plan includes may change before launch. Rather skip the technical part? We offer assisted setup (WhatsApp, Telegram, Shopify and your context) as support for an additional fee.",
  },
} satisfies Record<Locale, unknown>;

// ---------------- privacy notice (DRAFT) ----------------
export const privacy: Record<Locale, LegalDoc> = {
  es: {
    title: "Aviso de privacidad",
    description: "Borrador del aviso de privacidad de {brand} (México, LFPDPPP).",
    intro: "Este aviso explica qué datos personales trata {brand}, para qué, con quién se comparten y cómo ejercer tus derechos, conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP) y su normativa.",
    sections: [
      { h: "1. Responsable", p: ["{entity} es responsable de los datos de las cuentas de la plataforma (los negocios y sus equipos). Domicilio: {address}. Contacto de privacidad: {contact}."] },
      { h: "2. Dos tipos de datos y dos papeles", p: [
        "Datos de cuenta: nombre, correo, contraseña (guardada solo como hash), rol y negocio de las personas que usan el panel. Aquí {brand} es el responsable.",
        "Datos de los clientes finales de cada negocio: nombre o usuario en el canal, identificador del chat, mensajes y, si el negocio lo activa, número de pedido y correo para consultar su estado. Aquí el responsable es cada negocio y {brand} actúa como encargado: trata esos datos solo para prestar el servicio al negocio y siguiendo sus instrucciones.",
      ] },
      { h: "3. Finalidades", p: [
        "Primarias (necesarias para el servicio): crear y proteger la cuenta, contestar a los clientes del negocio con su información, pasar conversaciones a una persona, mostrar la bandeja, medir el uso de IA contra el tope del plan y cumplir obligaciones legales.",
        "Secundarias: hoy no hay. Si se agregan (por ejemplo, boletines), se pedirá tu consentimiento y podrás negarte sin perder el servicio.",
      ] },
      { h: "4. Encargados y transferencias", p: [
        "Para operar usamos proveedores que tratan datos por cuenta nuestra: Supabase (base de datos, autenticación y archivos), Vercel (alojamiento de la aplicación), Anthropic (modelo de IA que redacta respuestas; los mensajes se envían para generar la respuesta), y Telegram y Meta (WhatsApp, Instagram y Messenger) como canales por los que llegan y salen los mensajes. Si un negocio configura otro proveedor de IA (por ejemplo, OpenAI), los mensajes de ese negocio se envían a ese proveedor.",
        "Algunos de estos proveedores pueden guardar datos fuera de México (por ejemplo, en Estados Unidos). La región de cada servicio y los contratos con cada proveedor están por confirmar.",
        "No vendemos datos personales ni los usamos para publicidad.",
      ] },
      { h: "5. Conservación", p: [
        "Los mensajes y conversaciones se borran automáticamente después de 90 días (valor por defecto, configurable con un mínimo de 30). Las conversaciones escaladas por seguridad o motivos legales se conservan, pero el texto de sus mensajes se enmascara después de 365 días.",
        "Los avisos de traspaso a una persona se borran a los 30 días. Los registros de seguridad (intentos de inicio de sesión, límites) se borran a las 24 horas. Los correos de los clientes se guardan enmascarados en los mensajes.",
        "Los datos de cuenta se conservan mientras la cuenta exista y se eliminan cuando el negocio cierra su cuenta, salvo lo que la ley obligue a guardar.",
      ] },
      { h: "6. Tus derechos (ARCO) y revocación", p: [
        "Puedes pedir acceso, rectificación, cancelación u oposición al tratamiento de tus datos, revocar tu consentimiento o limitar su uso escribiendo a {contact}, con tu nombre, un medio para responderte y qué pides. Si eres cliente de un negocio, también puedes pedírselo directamente al negocio. Responderemos en los plazos que marca la ley.",
        "Para borrar los datos de una conversación, consulta la página «Eliminar mis datos».",
      ] },
      { h: "7. Cookies", p: [
        "Solo usamos cookies necesarias: la sesión iniciada, el negocio activo, el idioma y una cookie temporal para volver a la página correcta después de iniciar sesión. No usamos cookies de publicidad ni de analítica. Si eso cambia, se pedirá tu consentimiento antes.",
      ] },
      { h: "8. Seguridad", p: [
        "Las credenciales de las integraciones se guardan cifradas, las contraseñas solo como hash, el acceso está separado por negocio y los registros no guardan el texto de los mensajes ni datos de contacto.",
      ] },
      { h: "9. Cambios a este aviso", p: ["Publicaremos cualquier cambio en esta página con su fecha. Versión: borrador sin fecha de vigencia."] },
    ],
  },
  en: {
    title: "Privacy notice",
    description: "Draft privacy notice for {brand} (Mexico, LFPDPPP).",
    intro: "This notice explains which personal data {brand} processes, why, who it is shared with and how to exercise your rights, under Mexico's Federal Law on the Protection of Personal Data Held by Private Parties (LFPDPPP) and its regulations.",
    sections: [
      { h: "1. Controller", p: ["{entity} is the controller of the platform's account data (businesses and their teams). Address: {address}. Privacy contact: {contact}."] },
      { h: "2. Two kinds of data and two roles", p: [
        "Account data: name, e-mail, password (stored only as a hash), role and business of the people who use the panel. Here {brand} is the controller.",
        "Data of each business's end customers: name or username on the channel, chat identifier, messages and, if the business enables it, an order number and e-mail to look up its status. Here each business is the controller and {brand} acts as processor: it handles that data only to provide the service to the business and following its instructions.",
      ] },
      { h: "3. Purposes", p: [
        "Primary (needed for the service): create and protect the account, answer the business's customers with its information, hand conversations to a person, show the inbox, measure AI usage against the plan cap and meet legal obligations.",
        "Secondary: none today. If any are added (for example, newsletters), we will ask for your consent and you can refuse without losing the service.",
      ] },
      { h: "4. Processors and transfers", p: [
        "To operate we use providers that process data on our behalf: Supabase (database, authentication and files), Vercel (application hosting), Anthropic (AI model that drafts replies; messages are sent to generate the reply), and Telegram and Meta (WhatsApp, Instagram and Messenger) as the channels messages arrive and leave through. If a business configures another AI provider (for example, OpenAI), that business's messages are sent to that provider.",
        "Some of these providers may store data outside Mexico (for example, in the United States). Each service's region and the contracts with each provider are still to be confirmed.",
        "We do not sell personal data or use it for advertising.",
      ] },
      { h: "5. Retention", p: [
        "Messages and conversations are deleted automatically after 90 days (default, configurable with a minimum of 30). Conversations escalated for safety or legal reasons are kept, but their message text is masked after 365 days.",
        "Handoff notices are deleted after 30 days. Security records (sign-in attempts, limits) are deleted after 24 hours. Customer e-mails are stored masked in messages.",
        "Account data is kept while the account exists and deleted when the business closes its account, except what the law requires us to keep.",
      ] },
      { h: "6. Your rights (ARCO) and withdrawal", p: [
        "You can ask for access, rectification, cancellation or objection to the processing of your data, withdraw your consent or limit its use by writing to {contact} with your name, a way to reply to you and what you are asking for. If you are a customer of a business, you can also ask the business directly. We will reply within the legal deadlines.",
        "To delete the data of a conversation, see the “Delete my data” page.",
      ] },
      { h: "7. Cookies", p: [
        "We only use necessary cookies: the signed-in session, the active business, the language and a temporary cookie to return to the right page after signing in. We do not use advertising or analytics cookies. If that changes, we will ask for your consent first.",
      ] },
      { h: "8. Security", p: [
        "Integration credentials are stored encrypted, passwords only as a hash, access is separated per business and logs do not store message text or contact details.",
      ] },
      { h: "9. Changes to this notice", p: ["We will publish any change on this page with its date. Version: draft with no effective date."] },
    ],
  },
};

// ---------------- terms (DRAFT) ----------------
export const terms: Record<Locale, LegalDoc> = {
  es: {
    title: "Términos y condiciones",
    description: "Borrador de los términos de uso de {brand}.",
    intro: "Estos términos regulan el uso de {brand} por los negocios que crean una cuenta y por sus equipos. Al crear una cuenta los aceptas.",
    sections: [
      { h: "1. El servicio", p: ["{brand}, operado por {entity}, es un asistente que contesta a los clientes de un negocio en canales de mensajería (hoy Telegram y WhatsApp; Instagram y Messenger más adelante) usando la información que el negocio le da, y un panel para que el equipo atienda las conversaciones."] },
      { h: "2. Cuentas", p: ["Debes dar datos verdaderos, cuidar tu contraseña y avisarnos de cualquier acceso no autorizado. El dueño del negocio decide quién entra a su equipo y con qué rol."] },
      { h: "3. Responsabilidades del negocio", p: [
        "Eres responsable de la información que cargas, de lo que tu equipo responde y de cumplir las leyes que te aplican (protección de datos, consumidor, publicidad) frente a tus clientes, incluido darles tu propio aviso de privacidad.",
        "También debes cumplir las políticas de cada canal (por ejemplo, las de Telegram y Meta).",
      ] },
      { h: "4. Uso aceptable", p: ["No se permite usar el servicio para spam, fraude, contenido ilegal, suplantar a otros, ni para intentar acceder a datos de otros negocios o alterar la plataforma."] },
      { h: "5. Límites de la IA", p: ["El asistente puede equivocarse. Está diseñado para contestar solo con tu información y pasar a una persona cuando no sabe o cuando el tema es delicado, pero debes revisar su configuración y atender las conversaciones que se te pasan."] },
      { h: "6. Planes y precios", p: ["Los precios están por definir. No se cobra nada hoy. Antes de cobrar se publicarán los precios y se pedirá tu aceptación. Cada plan tiene un tope mensual de uso de IA; al llegar al tope, el asistente puede dejar de contestar hasta el siguiente mes."] },
      { h: "7. Disponibilidad", p: ["El servicio está en una etapa temprana y puede tener interrupciones o cambios. Por ahora no ofrecemos un nivel de servicio garantizado."] },
      { h: "8. Datos y fin del servicio", p: ["Tratamos los datos según el aviso de privacidad. Si cierras tu cuenta, eliminaremos los datos de tu negocio en un plazo razonable, salvo lo que la ley obligue a conservar."] },
      { h: "9. Responsabilidad", p: ["Los límites de responsabilidad, la ley aplicable y los tribunales competentes están por definir con asesoría legal."] },
      { h: "10. Cambios", p: ["Avisaremos los cambios importantes con anticipación. Versión: borrador sin fecha de vigencia. Contacto: {contact}."] },
    ],
  },
  en: {
    title: "Terms and conditions",
    description: "Draft terms of use for {brand}.",
    intro: "These terms govern the use of {brand} by the businesses that create an account and by their teams. By creating an account you accept them.",
    sections: [
      { h: "1. The service", p: ["{brand}, operated by {entity}, is an assistant that answers a business's customers on messaging channels (Telegram and WhatsApp today; Instagram and Messenger later) using the information the business gives it, plus a panel for the team to handle conversations."] },
      { h: "2. Accounts", p: ["You must give true information, keep your password safe and tell us about any unauthorised access. The business owner decides who joins the team and with which role."] },
      { h: "3. The business's responsibilities", p: [
        "You are responsible for the information you upload, for what your team replies and for complying with the laws that apply to you (data protection, consumer, advertising) towards your customers, including giving them your own privacy notice.",
        "You must also follow each channel's policies (for example, Telegram's and Meta's).",
      ] },
      { h: "4. Acceptable use", p: ["You may not use the service for spam, fraud, illegal content, impersonation, or to try to access other businesses' data or tamper with the platform."] },
      { h: "5. AI limits", p: ["The assistant can be wrong. It is designed to answer only from your information and to hand over to a person when it does not know or the topic is sensitive, but you must review its setup and handle the conversations handed to you."] },
      { h: "6. Plans and prices", p: ["Prices are to be defined. Nothing is charged today. Before charging, prices will be published and your acceptance requested. Each plan has a monthly AI usage cap; at the cap the assistant may stop answering until the next month."] },
      { h: "7. Availability", p: ["The service is at an early stage and may have interruptions or changes. For now we do not offer a guaranteed service level."] },
      { h: "8. Data and end of service", p: ["We process data according to the privacy notice. If you close your account, we will delete your business's data within a reasonable time, except what the law requires us to keep."] },
      { h: "9. Liability", p: ["Liability limits, governing law and competent courts are to be defined with legal advice."] },
      { h: "10. Changes", p: ["We will announce important changes in advance. Version: draft with no effective date. Contact: {contact}."] },
    ],
  },
};

// ---------------- data deletion ----------------
export const deletion: Record<Locale, LegalDoc> = {
  es: {
    title: "Eliminar mis datos",
    description: "Cómo pedir que se borren los datos de tus conversaciones con un negocio que usa {brand}.",
    intro: "Si escribiste a un negocio que usa {brand} (por Telegram, WhatsApp, Instagram o Messenger), puedes pedir que se borren tus conversaciones y los datos ligados a ellas.",
    sections: [
      { h: "1. Escríbenos directamente", p: ["Puedes pedirnos el borrado sin pasar por el negocio: escribe a {contact} (abajo hay un botón que prepara el correo). También puedes pedírselo al negocio con el que hablaste, que es el responsable de tus datos; su equipo nos pide el borrado y nosotros lo hacemos."] },
      { h: "2. Qué incluir en tu correo", p: ["Escribe a {contact} con: el nombre del negocio, el canal (Telegram, WhatsApp, Instagram o Messenger) y tu usuario o número en ese canal. No mandes contraseñas ni datos de pago. Podemos pedirte confirmar que la cuenta es tuya antes de borrar."] },
      { h: "3. Desde Facebook o Instagram", p: [
        "Si quitas el acceso de la app en la configuración de tu cuenta de Facebook (Apps y sitios web), Meta nos envía una solicitud de eliminación firmada. La verificamos, borramos las conversaciones que podamos ligar a esa cuenta y Meta te muestra un código de confirmación.",
        "Con ese código puedes consultar el estado en /api/webhooks/meta/data-deletion?code=TU_CODIGO. Si no podemos ligar la solicitud a tus conversaciones (Meta usa identificadores distintos según el producto), la revisa una persona.",
      ] },
      { h: "4. Qué se borra", p: [
        "Tus conversaciones y mensajes con ese negocio y los avisos de traspaso ligados a ellas. Queda un registro, sin tu información de contacto, de que la solicitud se recibió y se atendió.",
        "Excepción: una conversación escalada por seguridad o por un tema legal puede conservarse mientras sea necesario (su texto se enmascara con el tiempo). Si es tu caso, te lo diremos.",
      ] },
      { h: "5. Aunque no lo pidas", p: ["Los mensajes se borran solos después de 90 días (valor por defecto). Más detalles en el aviso de privacidad."] },
    ],
  },
  en: {
    title: "Delete my data",
    description: "How to ask for the data of your conversations with a business that uses {brand} to be deleted.",
    intro: "If you wrote to a business that uses {brand} (on Telegram, WhatsApp, Instagram or Messenger), you can ask for your conversations and the data linked to them to be deleted.",
    sections: [
      { h: "1. Write to us directly", p: ["You can ask us for the deletion without going through the business: write to {contact} (the button below prepares the e-mail). You can also ask the business you talked to, which is the controller of your data; its team asks us and we delete it."] },
      { h: "2. What to include in your e-mail", p: ["Write to {contact} with: the business name, the channel (Telegram, WhatsApp, Instagram or Messenger) and your username or number on that channel. Do not send passwords or payment details. We may ask you to confirm the account is yours before deleting."] },
      { h: "3. From Facebook or Instagram", p: [
        "If you remove the app's access in your Facebook account settings (Apps and websites), Meta sends us a signed deletion request. We verify it, delete the conversations we can link to that account, and Meta shows you a confirmation code.",
        "With that code you can check the status at /api/webhooks/meta/data-deletion?code=YOUR_CODE. If we cannot link the request to your conversations (Meta uses different identifiers per product), a person reviews it.",
      ] },
      { h: "4. What is deleted", p: [
        "Your conversations and messages with that business and the handoff notices linked to them. A record without your contact details is kept showing the request was received and handled.",
        "Exception: a conversation escalated for safety or a legal matter may be kept while needed (its text is masked over time). If that is your case, we will tell you.",
      ] },
      { h: "5. Even if you do not ask", p: ["Messages are deleted automatically after 90 days (default). More details in the privacy notice."] },
    ],
  },
};
