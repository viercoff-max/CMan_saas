// Copy for the public pages (Spanish default + English). Honest copy only: no invented numbers, testimonials,
// customer logos or prices. "{brand}" is replaced with PLATFORM_BRAND.name, "{contact}" with the privacy contact
// (or "por definir"), "{entity}" with the legal entity (or "por definir").
import type { Locale } from "../i18n-shared";
import { PLATFORM_BRAND } from "./brand";

export interface LegalSection { h: string; p: string[] }
export interface LegalDoc { title: string; description: string; intro: string; sections: LegalSection[] }

const TBD = { es: "por definir", en: "to be defined" } satisfies Record<Locale, string>;

export function fill(s: string, locale: Locale): string {
  return s
    .replaceAll("{brand}", PLATFORM_BRAND.name)
    .replaceAll("{contact}", PLATFORM_BRAND.privacyContactEmail ?? `(${locale === "en" ? "contact e-mail" : "correo de contacto"} ${TBD[locale]})`)
    .replaceAll("{entity}", PLATFORM_BRAND.legalEntityName ?? `(${locale === "en" ? "legal entity" : "razón social"} ${TBD[locale]})`);
}

export const draftBanner = {
  es: { title: "Borrador: debe revisarlo un abogado antes de publicarse.", body: "Este texto es un punto de partida y todavía no es un documento legal vigente." },
  en: { title: "Draft: a lawyer must review it before it is published.", body: "This text is a starting point and is not yet a binding legal document." },
} satisfies Record<Locale, { title: string; body: string }>;

// ---------------- landing ----------------
export const landing = {
  es: {
    metaTitle: "Un asistente que contesta a tus clientes",
    metaDescription: "Responde a tus clientes en Telegram hoy (WhatsApp, Instagram y Messenger pronto), solo con la información de tu negocio, y pasa la conversación a una persona cuando hace falta.",
    eyebrow: "Para cualquier negocio",
    title: "Un asistente que contesta a tus clientes y te avisa cuando alguien necesita a una persona.",
    lead: "Conecta tu bot de Telegram, cuéntale sobre tu negocio y deja que conteste las preguntas de siempre. Tú y tu equipo atienden lo demás desde un solo panel.",
    ctaPrimary: "Crear cuenta",
    ctaSecondary: "Entrar",
    channelsTitle: "Canales",
    channels: [
      { name: "Telegram", state: "Disponible" },
      { name: "WhatsApp", state: "Próximamente" },
      { name: "Instagram", state: "Próximamente" },
      { name: "Messenger", state: "Próximamente" },
    ],
    featuresTitle: "Qué hace",
    features: [
      { h: "Contesta solo con tu información", p: "Responde a partir de lo que tú escribes o subes (productos, envíos, garantía, preguntas frecuentes). Si no lo sabe, no lo inventa: lo pasa a tu equipo." },
      { h: "Pasa la conversación a una persona", p: "Cuando un cliente pide hablar con alguien, menciona un problema de seguridad o algo que el asistente no debe resolver, la conversación queda marcada para tu equipo." },
      { h: "Tu equipo en un solo panel", p: "Todas las conversaciones en una bandeja: tomar, responder, devolver al asistente y marcar como resuelta. Con roles de administrador y agente." },
      { h: "Con tu marca", p: "Tu equipo ve tu logo y tus colores, no los nuestros. Tus clientes hablan con el bot de tu negocio." },
      { h: "Pruébalo antes de abrirlo", p: "Un simulador para chatear con tu asistente como si fueras un cliente, sin enviar nada a nadie." },
      { h: "Cuidamos los datos", p: "Los mensajes se borran pasado un tiempo, los correos de los clientes se enmascaran y puedes pedir que se eliminen los datos de una persona." },
    ],
    stepsTitle: "Cómo empezar",
    steps: [
      "Crea tu cuenta y el perfil de tu negocio.",
      "Escribe o sube la información que el asistente debe usar.",
      "Conecta tu bot de Telegram y pruébalo en el simulador.",
    ],
    honest: "Estamos en una etapa temprana: todavía no publicamos precios ni cifras de clientes.",
    pricingLink: "Ver planes",
  },
  en: {
    metaTitle: "An assistant that answers your customers",
    metaDescription: "Answer your customers on Telegram today (WhatsApp, Instagram and Messenger soon), only from your business information, and hand the conversation to a person when needed.",
    eyebrow: "For any business",
    title: "An assistant that answers your customers and tells you when someone needs a person.",
    lead: "Connect your Telegram bot, tell it about your business and let it answer the usual questions. You and your team handle the rest from one panel.",
    ctaPrimary: "Create account",
    ctaSecondary: "Sign in",
    channelsTitle: "Channels",
    channels: [
      { name: "Telegram", state: "Available" },
      { name: "WhatsApp", state: "Coming soon" },
      { name: "Instagram", state: "Coming soon" },
      { name: "Messenger", state: "Coming soon" },
    ],
    featuresTitle: "What it does",
    features: [
      { h: "Answers only from your information", p: "It answers from what you write or upload (products, shipping, warranty, FAQ). If it does not know, it does not make it up: it passes the chat to your team." },
      { h: "Hands the conversation to a person", p: "When a customer asks for someone, mentions a safety problem or something the assistant should not handle, the conversation is flagged for your team." },
      { h: "Your team in one panel", p: "Every conversation in one inbox: take, reply, return to the assistant and mark as resolved. With admin and agent roles." },
      { h: "With your brand", p: "Your team sees your logo and colours, not ours. Your customers talk to your business's bot." },
      { h: "Try it before going live", p: "A simulator to chat with your assistant as if you were a customer, without sending anything to anyone." },
      { h: "Careful with data", p: "Messages are deleted after a while, customer e-mails are masked and you can ask for a person's data to be deleted." },
    ],
    stepsTitle: "How to start",
    steps: [
      "Create your account and your business profile.",
      "Write or upload the information the assistant should use.",
      "Connect your Telegram bot and try it in the simulator.",
    ],
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
      { name: "Gratis", for: "Para probar con tu negocio.", items: ["Un canal (Telegram)", "Asistente con tu información", "Bandeja y simulador", "Uso de IA con un tope mensual bajo"] },
      { name: "Pro", for: "Para un negocio con equipo.", items: ["Todo lo de Gratis", "Más uso de IA al mes", "Varios miembros del equipo", "Tu marca en el panel"] },
      { name: "Negocio", for: "Para más volumen y más canales.", items: ["Todo lo de Pro", "El mayor tope de IA", "Más canales cuando estén disponibles", "Soporte prioritario"] },
    ],
    note: "Lo que incluye cada plan puede cambiar antes del lanzamiento.",
  },
  en: {
    metaTitle: "Pricing",
    metaDescription: "Free, Pro and Business plans. Prices are not defined yet.",
    title: "Plans",
    lead: "Prices are not defined yet. Nothing is charged from this site: when there are prices, they will be published here before any charge.",
    priceTbd: "Price to be defined",
    cta: "Create account",
    plans: [
      { name: "Free", for: "To try it with your business.", items: ["One channel (Telegram)", "Assistant with your information", "Inbox and simulator", "AI usage with a low monthly cap"] },
      { name: "Pro", for: "For a business with a team.", items: ["Everything in Free", "More AI usage per month", "Several team members", "Your brand in the panel"] },
      { name: "Business", for: "For more volume and more channels.", items: ["Everything in Pro", "The highest AI cap", "More channels as they become available", "Priority support"] },
    ],
    note: "What each plan includes may change before launch.",
  },
} satisfies Record<Locale, unknown>;

// ---------------- privacy notice (DRAFT) ----------------
export const privacy: Record<Locale, LegalDoc> = {
  es: {
    title: "Aviso de privacidad",
    description: "Borrador del aviso de privacidad de {brand} (México, LFPDPPP).",
    intro: "Este aviso explica qué datos personales trata {brand}, para qué, con quién se comparten y cómo ejercer tus derechos, conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP) y su normativa.",
    sections: [
      { h: "1. Responsable", p: ["{entity} es responsable de los datos de las cuentas de la plataforma (los negocios y sus equipos). Contacto de privacidad: {contact}."] },
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
      { h: "1. Controller", p: ["{entity} is the controller of the platform's account data (businesses and their teams). Privacy contact: {contact}."] },
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
      { h: "1. El servicio", p: ["{brand} es un asistente que contesta a los clientes de un negocio en canales de mensajería (hoy Telegram; WhatsApp, Instagram y Messenger más adelante) usando la información que el negocio le da, y un panel para que el equipo atienda las conversaciones."] },
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
      { h: "1. The service", p: ["{brand} is an assistant that answers a business's customers on messaging channels (Telegram today; WhatsApp, Instagram and Messenger later) using the information the business gives it, plus a panel for the team to handle conversations."] },
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
      { h: "1. Pídelo al negocio", p: ["El negocio con el que hablaste es el responsable de tus datos. Escríbele por el mismo chat o por su contacto y pide que eliminen tus datos. Su equipo puede pedirnos el borrado y nosotros lo hacemos."] },
      { h: "2. O escríbenos", p: ["Escribe a {contact} con: el nombre del negocio, el canal (Telegram, WhatsApp, Instagram o Messenger) y tu usuario o número en ese canal. No mandes contraseñas ni datos de pago. Podemos pedirte confirmar que la cuenta es tuya antes de borrar."] },
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
      { h: "1. Ask the business", p: ["The business you talked to is the controller of your data. Write to it in the same chat or through its contact details and ask for your data to be deleted. Its team can ask us to delete it and we do."] },
      { h: "2. Or write to us", p: ["Write to {contact} with: the business name, the channel (Telegram, WhatsApp, Instagram or Messenger) and your username or number on that channel. Do not send passwords or payment details. We may ask you to confirm the account is yours before deleting."] },
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
