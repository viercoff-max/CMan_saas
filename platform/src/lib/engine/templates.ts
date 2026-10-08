// Approved, tone-aware reply templates (es/en). Order/handoff/safety replies are ALWAYS built from these,
// never from LLM text. Five genuinely distinct registers:
//   1 very formal ("usted", courteous, no emoji)   2 formal ("usted", brief)   3 neutral ("tú")
//   4 warm ("tú", casual, exclamations)            5 very warm ("tú", colloquial, emoji)
// Tone never changes guardrails: the safety template never gets emoji or jokes.
import type { Lang } from "./lang";
import type { EscalationReason } from "./escalate";

export type Tone = 1 | 2 | 3 | 4 | 5;
type Five = readonly [string, string, string, string, string];
/** pick the string for tone 1..5 */
const p5 = (t: Tone, v: Five) => v[t - 1];
/** formal ("usted") register: tones 1-2 */
const formal = (t: Tone) => t <= 2;

export function clampTone(n: unknown): Tone {
  const x = Math.round(Number(n));
  return (Number.isFinite(x) ? Math.min(5, Math.max(1, x)) : 3) as Tone;
}

export function greeting(lang: Lang, tone: Tone, agentName: string): string {
  const n = agentName.trim() || (lang === "es" ? "tu asistente" : "your assistant");
  const es: Five = [
    `Buen día. Le atiende ${n}, asistente virtual. ¿En qué puedo ayudarle?`,
    `Hola, buen día. Soy ${n}, asistente virtual. ¿En qué le puedo ayudar?`,
    `Hola, soy ${n}, el asistente virtual. ¿En qué te puedo ayudar?`,
    `¡Hola! Soy ${n}. ¿En qué te puedo ayudar hoy?`,
    `¡Hola! 👋 Soy ${n}, ¡qué gusto saludarte! ¿En qué te ayudo?`,
  ];
  const en: Five = [
    `Good day. This is ${n}, the virtual assistant. How may I assist you?`,
    `Hello. I am ${n}, the virtual assistant. How may I help you?`,
    `Hi, I'm ${n}, the virtual assistant. How can I help you?`,
    `Hi there! I'm ${n}. How can I help you today?`,
    `Hey there! 👋 I'm ${n}, so glad you reached out! How can I help?`,
  ];
  return p5(tone, lang === "es" ? es : en);
}

/** Short opener to prefix the first answer when the customer did not just say hi. */
export function shortHello(lang: Lang, tone: Tone, agentName: string): string {
  const n = agentName.trim();
  if (lang === "es") {
    const withName: Five = [`Buen día, le atiende ${n}.`, `Buen día, soy ${n}.`, `Hola, soy ${n}.`, `¡Hola! Soy ${n}.`, `¡Hola! 👋 Soy ${n}.`];
    const noName: Five = ["Buen día.", "Buen día.", "Hola.", "¡Hola!", "¡Hola! 👋"];
    return p5(tone, n ? withName : noName);
  }
  const withName: Five = [`Good day, this is ${n}.`, `Hello, I am ${n}.`, `Hi, I'm ${n}.`, `Hi there! I'm ${n}.`, `Hey! 👋 I'm ${n}.`];
  const noName: Five = ["Good day.", "Hello.", "Hi.", "Hi there!", "Hey! 👋"];
  return p5(tone, n ? withName : noName);
}

const pick = (lang: Lang, t: Tone, es: Five, en: Five) => p5(t, lang === "es" ? es : en);

// ---------------- orders ----------------
export const askOrderNumber = (lang: Lang, t: Tone) => pick(lang, t,
  ["Con gusto le ayudo a consultar el estatus de su pedido. ¿Me podría compartir su número de pedido? (por ejemplo, #1234)",
   "Con gusto le ayudo. ¿Me indica su número de pedido, por favor? (por ejemplo, #1234)",
   "Con gusto te ayudo a revisar el estatus de tu pedido. ¿Me compartes tu número de pedido? (por ejemplo, #1234)",
   "¡Claro! Te ayudo a revisar tu pedido. ¿Me pasas tu número de pedido? (por ejemplo, #1234)",
   "¡Claro que sí! 📦 Vamos a ver dónde anda tu pedido. ¿Me pasas tu número de pedido? (por ejemplo, #1234)"],
  ["I would be glad to help you check your order status. Could you please share your order number? (for example, #1234)",
   "Happy to help. May I have your order number, please? (for example, #1234)",
   "Happy to help you check your order status. What's your order number? (for example, #1234)",
   "Sure thing! What's your order number? (for example, #1234)",
   "You got it! 📦 Let's see where your order is. What's your order number? (for example, #1234)"]);

export const askEmail = (lang: Lang, t: Tone) => pick(lang, t,
  ["Gracias. Para verificar, ¿me podría indicar el correo electrónico con el que realizó la compra?",
   "Gracias. ¿Con qué correo electrónico realizó la compra, por favor?",
   "Gracias. Para verificar, ¿me compartes el correo electrónico con el que hiciste la compra?",
   "¡Perfecto! Para verificar, ¿me pasas el correo con el que hiciste tu compra?",
   "¡Súper! 🙌 Para verificar, ¿con qué correo hiciste tu compra?"],
  ["Thank you. To verify, could you please provide the email address used for the purchase?",
   "Thank you. Which email address did you use for the purchase, please?",
   "Thanks. To verify, what's the email address you used for the purchase?",
   "Great! To verify, what email did you use for your purchase?",
   "Awesome! 🙌 To verify, which email did you use for your purchase?"]);

export const askNumberHaveEmail = (lang: Lang, t: Tone) => pick(lang, t,
  ["Gracias. ¿Me podría indicar también su número de pedido? (por ejemplo, #1234)",
   "Gracias. ¿Cuál es su número de pedido, por favor? (por ejemplo, #1234)",
   "Gracias. ¿Me compartes también tu número de pedido? (por ejemplo, #1234)",
   "¡Gracias! ¿Me pasas también tu número de pedido? (por ejemplo, #1234)",
   "¡Gracias! 🙌 Ahora, ¿cuál es tu número de pedido? (por ejemplo, #1234)"],
  ["Thank you. Could you also provide your order number? (for example, #1234)",
   "Thank you. What is your order number, please? (for example, #1234)",
   "Thanks. What's your order number? (for example, #1234)",
   "Thanks! And what's your order number? (for example, #1234)",
   "Thanks! 🙌 And what's your order number? (for example, #1234)"]);

export interface OrderStatusView { orderNumber: string; statusText?: string; carrier?: string; trackingNumber?: string; trackingUrl?: string; estimatedDelivery?: string }

/** STATUS ONLY: status, carrier, tracking, ETA. Never address, items, phone, payment or the email. */
export function orderFound(lang: Lang, t: Tone, o: OrderStatusView): string {
  const num = o.orderNumber.startsWith("#") ? o.orderNumber : `#${o.orderNumber}`;
  const status = o.statusText?.trim() || (lang === "es" ? "en proceso" : "processing");
  const lines: string[] = [];
  if (lang === "es") {
    lines.push(p5(t, [
      `Le informamos que el estatus de su pedido ${num} es: ${status}.`,
      `El estatus de su pedido ${num} es: ${status}.`,
      `El estatus de tu pedido ${num} es: ${status}.`,
      `¡Listo! Tu pedido ${num} está: ${status}.`,
      `¡Buenas noticias! 🚚 Tu pedido ${num} está: ${status}.`,
    ]));
    if (o.carrier) lines.push(`Paquetería: ${o.carrier}.`);
    if (o.trackingNumber) lines.push(`Número de guía: ${o.trackingNumber}.`);
    if (o.trackingUrl) lines.push(`Rastreo: ${o.trackingUrl}`);
    if (o.estimatedDelivery) lines.push(`Entrega estimada: ${o.estimatedDelivery}.`);
    if (t >= 4) lines.push(t === 5 ? "¿Te ayudo con algo más? 😊" : "¿Te ayudo con algo más?");
  } else {
    lines.push(p5(t, [
      `We are pleased to inform you that the status of your order ${num} is: ${status}.`,
      `The status of your order ${num} is: ${status}.`,
      `Your order ${num} status is: ${status}.`,
      `All set! Your order ${num} is: ${status}.`,
      `Good news! 🚚 Your order ${num} is: ${status}.`,
    ]));
    if (o.carrier) lines.push(`Carrier: ${o.carrier}.`);
    if (o.trackingNumber) lines.push(`Tracking number: ${o.trackingNumber}.`);
    if (o.trackingUrl) lines.push(`Track it here: ${o.trackingUrl}`);
    if (o.estimatedDelivery) lines.push(`Estimated delivery: ${o.estimatedDelivery}.`);
    if (t >= 4) lines.push(t === 5 ? "Can I help with anything else? 😊" : "Can I help with anything else?");
  }
  return lines.join("\n");
}

/** ONE generic message: never reveals whether the order exists or the email is wrong. */
export const orderNotFound = (lang: Lang, t: Tone) => lang === "es"
  ? "No encontramos un pedido con esos datos. " + p5(t, [
    "Le solicitamos verificar el número de pedido y el correo electrónico, e intentarlo nuevamente.",
    "Por favor verifique el número de pedido y el correo e inténtelo de nuevo.",
    "Por favor revisa el número de pedido y el correo e inténtalo de nuevo.",
    "¿Puedes revisar el número de pedido y el correo e intentarlo de nuevo?",
    "¿Me haces el favor de checar el número de pedido y el correo e intentamos otra vez? 🙏",
  ])
  : "We couldn't find an order with those details. " + p5(t, [
    "We kindly ask that you verify the order number and email address, and try again.",
    "Please verify the order number and email and try again.",
    "Please check the order number and email and try again.",
    "Can you double-check the order number and email and try again?",
    "Mind double-checking the order number and email so we can try again? 🙏",
  ]);

export const noConnector = (lang: Lang, t: Tone) => pick(lang, t,
  ["Lamentablemente, por este medio no me es posible consultar el estatus de pedidos. ¿Desea que le comunique con una persona de nuestro equipo?",
   "Por este medio no puedo consultar pedidos. ¿Desea que lo comunique con una persona de nuestro equipo?",
   "Por este medio no puedo consultar el estatus de pedidos. ¿Quieres que te comunique con una persona de nuestro equipo?",
   "Por aquí no puedo revisar pedidos. ¿Quieres que te pase con una persona de nuestro equipo?",
   "¡Ay! Por aquí no puedo ver pedidos 😅 ¿Te paso con alguien del equipo que sí pueda?"],
  ["Regrettably, I am unable to check order status through this channel. Would you like me to connect you with a member of our team?",
   "I cannot check orders through this channel. Would you like me to connect you with a member of our team?",
   "I can't check order status here. Would you like me to connect you with someone from our team?",
   "I can't check orders from here. Want me to connect you with someone from our team?",
   "Oh no, I can't see orders from here 😅 Want me to connect you with someone on the team who can?"]);

export const orderLookupError = (lang: Lang, t: Tone) => pick(lang, t,
  ["Lamentamos informarle que en este momento no me fue posible consultar su pedido. ¿Desea que le comunique con una persona de nuestro equipo?",
   "No me fue posible consultar su pedido en este momento. ¿Desea que lo comunique con una persona de nuestro equipo?",
   "En este momento no pude consultar tu pedido. ¿Quieres que te comunique con una persona de nuestro equipo?",
   "Ahorita no pude revisar tu pedido. ¿Quieres que te pase con una persona de nuestro equipo?",
   "¡Uy! Ahorita no pude revisar tu pedido 😕 ¿Te paso con alguien del equipo?"],
  ["We regret that I was unable to check your order at this moment. Would you like me to connect you with a member of our team?",
   "I could not check your order at this time. Would you like me to connect you with a member of our team?",
   "I couldn't check your order right now. Would you like me to connect you with someone from our team?",
   "I couldn't check your order right now. Want me to connect you with someone from our team?",
   "Oops! I couldn't check your order right now 😕 Want me to connect you with someone on the team?"]);

// ---------------- knowledge ----------------
export const clarify = (lang: Lang, t: Tone) => pick(lang, t,
  ["Le ofrezco una disculpa, no encontré información sobre ese tema. ¿Podría proporcionarme más detalles (por ejemplo, el modelo del producto o su duda específica)?",
   "Disculpe, no encontré información al respecto. ¿Podría darme más detalles, por favor?",
   "Perdón, no encontré información sobre eso. ¿Me das más detalles (por ejemplo, el modelo del producto o tu duda específica)?",
   "Mmm, no encontré info sobre eso. ¿Me cuentas un poco más (por ejemplo, el modelo del producto)?",
   "¡Ups! 🤔 No encontré info sobre eso. ¿Me cuentas más (por ejemplo, el modelo de tu producto)?"],
  ["I apologize, I could not find information on that topic. Could you please provide more details (for example, the product model or your specific question)?",
   "I apologize, I could not find information on that. Could you share more details, please?",
   "Sorry, I couldn't find information about that. Could you share more details (for example, the product model or your specific question)?",
   "Hmm, I couldn't find info on that. Can you tell me a bit more (for example, the product model)?",
   "Oops! 🤔 I couldn't find info on that. Can you tell me more (for example, your product's model)?"]);

export const capOffer = (lang: Lang, t: Tone) => pick(lang, t,
  ["Si lo prefiere, con gusto puedo comunicarle con una persona de nuestro equipo. ¿Desea que lo haga?",
   "Puedo comunicarle con una persona de nuestro equipo. ¿Desea que lo haga?",
   "Si prefieres, puedo comunicarte con una persona de nuestro equipo. ¿Quieres que lo haga?",
   "Si quieres, te paso con una persona de nuestro equipo. ¿Va?",
   "¡Si quieres te paso con alguien del equipo! 😊 ¿Te late?"],
  ["If you prefer, I would be happy to connect you with a member of our team. Would you like me to do so?",
   "I can connect you with a member of our team. Would you like me to?",
   "If you prefer, I can connect you with someone from our team. Would you like that?",
   "If you'd like, I can connect you with someone from our team. Sound good?",
   "I can connect you with someone on the team! 😊 Want me to?"]);

export const offerDeclined = (lang: Lang, t: Tone) => pick(lang, t,
  ["Entendido. Quedo a sus órdenes; ¿hay algo más en lo que pueda ayudarle?",
   "De acuerdo. ¿Puedo ayudarle en algo más?",
   "Listo. ¿Hay algo más en lo que te pueda ayudar?",
   "¡Va! ¿Te ayudo con algo más?",
   "¡Sin problema! 😊 ¿Te echo la mano con algo más?"],
  ["Understood. I remain at your service; is there anything else I can help you with?",
   "Very well. May I help you with anything else?",
   "Okay. Is there anything else I can help you with?",
   "No problem! Anything else I can help with?",
   "No worries at all! 😊 Anything else I can help with?"]);

export function crossSell(lang: Lang, t: Tone, level: 1 | 2 | 3, item: string): string {
  const f = formal(t);
  if (lang === "es") {
    if (level === 1) return f ? `¿Le interesaría conocer también ${item}?` : `¿Te interesaría conocer también ${item}?`;
    if (level === 2) return f ? `También le puede interesar: ${item}.` : `También te puede interesar: ${item}.`;
    return f ? `Le recomendamos también ${item}. ¿Desea más información?` : `Te recomendamos también ${item}. ¿Quieres que te cuente más?`;
  }
  if (level === 1) return `Would you like to learn about ${item} as well?`;
  if (level === 2) return `You might also be interested in: ${item}.`;
  return `We also recommend ${item}. Would you like more information?`;
}

// ---------------- handoff / escalation ----------------
export type HandoffKind = EscalationReason | "too_old" | "blocked";

/** Calm, approved safety text. Two wording families (usted / tú); never emoji or jokes at any tone. */
export function safetyIntro(lang: Lang, t: Tone): string {
  if (lang === "es") return formal(t)
    ? "Lamentamos mucho lo ocurrido; su seguridad es lo más importante. Si es seguro hacerlo, deje de usar el aparato y desconéctelo de la corriente. No intente abrirlo ni repararlo. Si hay una emergencia o alguien está lesionado, llame al 911."
    : "Lamentamos mucho lo ocurrido; tu seguridad es lo más importante. Si es seguro hacerlo, deja de usar el aparato y desconéctalo de la corriente. No intentes abrirlo ni repararlo. Si hay una emergencia o alguien está lesionado, llama al 911.";
  return "We are very sorry this happened; your safety comes first. If it is safe to do so, stop using the appliance and unplug it. Do not try to open or repair it. If there is an emergency or anyone is injured, call 911.";
}

type Kind = Exclude<HandoffKind, "safety">;
const ES_HANDOFF: Record<Kind, Five> = {
  legal: ["Comprendemos su inquietud y le agradecemos habérnosla comunicado. Una persona de nuestro equipo revisará su caso de manera personal.",
    "Entendemos su inquietud. Una persona de nuestro equipo revisará su caso personalmente.",
    "Entendemos tu inquietud. Una persona de nuestro equipo revisará tu caso personalmente.",
    "Entiendo tu preocupación. Una persona de nuestro equipo va a ver tu caso personalmente.",
    "Gracias por avisarnos, sabemos que es importante. Una persona de nuestro equipo va a ver tu caso personalmente."],
  human_request: ["Por supuesto. Con gusto le comunico con una persona de nuestro equipo.",
    "Por supuesto, le comunico con una persona de nuestro equipo.",
    "Claro, te comunico con una persona de nuestro equipo.",
    "¡Claro! Te paso con una persona de nuestro equipo.",
    "¡Claro que sí! 😊 Te paso ahorita con una persona de nuestro equipo."],
  no_answer: ["Lamentablemente no cuento con información suficiente para responderle con certeza, por lo que le comunicaré con una persona de nuestro equipo.",
    "No cuento con información suficiente para responderle con certeza, así que le comunicaré con una persona de nuestro equipo.",
    "No tengo información suficiente para responderte con certeza, así que te comunico con una persona de nuestro equipo.",
    "No tengo la info para responderte con certeza, así que te paso con una persona de nuestro equipo.",
    "¡Uy! Eso no lo sé con seguridad 😅 Mejor te paso con una persona de nuestro equipo que sí te pueda ayudar."],
  blocked: ["Con el fin de brindarle una respuesta precisa, le comunicaré con una persona de nuestro equipo.",
    "Para darle una respuesta precisa, le comunicaré con una persona de nuestro equipo.",
    "Para darte una respuesta precisa, te comunico con una persona de nuestro equipo.",
    "Para darte una respuesta bien precisa, te paso con una persona de nuestro equipo.",
    "¡Para darte la respuesta correcta te paso con alguien del equipo! 😊"],
  attempts: ["Por motivos de seguridad no podemos realizar más consultas de pedido en esta conversación. Le comunicaré con una persona de nuestro equipo.",
    "Para proteger su información no podemos hacer más consultas de pedido aquí. Le comunicaré con una persona de nuestro equipo.",
    "Para cuidar tu información no puedo hacer más consultas de pedido en esta conversación. Te comunico con una persona de nuestro equipo.",
    "Para cuidar tu información ya no puedo hacer más consultas de pedido aquí. Te paso con una persona de nuestro equipo.",
    "Para cuidar tus datos ya no puedo hacer más consultas de pedido aquí 🔒 Te paso con una persona de nuestro equipo que te ayudará."],
  too_old: ["Su pedido es anterior al periodo que podemos consultar automáticamente, por lo que una persona de nuestro equipo lo revisará.",
    "Su pedido es anterior al periodo de consulta automática; una persona de nuestro equipo lo revisará.",
    "Tu pedido es anterior al periodo que podemos consultar automáticamente, así que una persona de nuestro equipo lo revisará.",
    "Tu pedido es de hace tiempo y no lo puedo consultar automáticamente, así que una persona de nuestro equipo lo revisará.",
    "¡Tu pedido ya tiene su tiempo! 😅 No lo puedo consultar yo solito, así que una persona de nuestro equipo lo va a revisar."],
  bot_disabled: ["Con gusto le comunico con una persona de nuestro equipo.",
    "Le comunico con una persona de nuestro equipo.",
    "Te comunico con una persona de nuestro equipo.",
    "Te paso con una persona de nuestro equipo.",
    "¡Te paso con una persona de nuestro equipo! 😊"],
};
const EN_HANDOFF: Record<Kind, Five> = {
  legal: ["We understand your concern and thank you for bringing it to our attention. A member of our team will review your case personally.",
    "We understand your concern. A member of our team will review your case personally.",
    "We understand your concern. Someone from our team will review your case personally.",
    "I hear you. Someone from our team will look at your case personally.",
    "Thanks for letting us know, we know this matters. Someone from our team will look at your case personally."],
  human_request: ["Certainly. I would be glad to connect you with a member of our team.",
    "Certainly, I will connect you with a member of our team.",
    "Sure, I'll connect you with someone from our team.",
    "Of course! I'll connect you with someone from our team.",
    "Absolutely! 😊 Connecting you with someone from our team right now."],
  no_answer: ["Regrettably, I do not have enough information to answer that with certainty, so I will connect you with a member of our team.",
    "I do not have enough information to answer that with certainty, so I will connect you with a member of our team.",
    "I don't have enough information to answer that with certainty, so I'll connect you with someone from our team.",
    "I don't have the info to answer that for sure, so I'll connect you with someone from our team.",
    "Oops, I'm not sure about that one 😅 Let me connect you with someone on our team who can help."],
  blocked: ["In order to provide you with an accurate answer, I will connect you with a member of our team.",
    "To give you an accurate answer, I will connect you with a member of our team.",
    "To give you an accurate answer, I'll connect you with someone from our team.",
    "To give you a really accurate answer, I'll connect you with someone from our team.",
    "To get you the right answer, I'm connecting you with someone on the team! 😊"],
  attempts: ["For security reasons we cannot perform more order lookups in this conversation. I will connect you with a member of our team.",
    "To protect your information we cannot do more order lookups here. I will connect you with a member of our team.",
    "To protect your information I can't do more order lookups in this conversation. I'll connect you with someone from our team.",
    "To protect your info I can't do more order lookups here. I'll connect you with someone from our team.",
    "To keep your data safe I can't do more order lookups here 🔒 I'll connect you with someone who can help."],
  too_old: ["Your order is older than the period we can check automatically, so a member of our team will review it.",
    "Your order predates our automatic lookup period; a member of our team will review it.",
    "Your order is older than the period we can check automatically, so someone from our team will review it.",
    "Your order is from a while back and I can't check it automatically, so someone from our team will review it.",
    "Your order is from a while back 😅 I can't check it on my own, so someone from our team will review it."],
  bot_disabled: ["I would be glad to connect you with a member of our team.",
    "I will connect you with a member of our team.",
    "I'll connect you with someone from our team.",
    "Let me connect you with someone from our team.",
    "I'll connect you with someone from our team! 😊"],
};

export function handoffIntro(kind: HandoffKind, lang: Lang, t: Tone, fallbackMessage?: string): string {
  if (kind === "safety") return safetyIntro(lang, t);
  if ((kind === "no_answer" || kind === "blocked") && fallbackMessage?.trim()) return fallbackMessage.trim();
  return p5(t, (lang === "es" ? ES_HANDOFF : EN_HANDOFF)[kind]);
}

/** The "I don't know" text used when no custom fallback is stored (what the Tone screen previews). */
export const defaultFallbackText = (lang: Lang, t: Tone) => handoffIntro("no_answer", lang, t);

/** Business-hours aware "a person will contact you" line. open=null means hours unknown. */
export function handoffWhen(lang: Lang, t: Tone, open: boolean | null, hoursText: string | null): string {
  const f = formal(t);
  if (lang === "es") {
    if (open === false) {
      const h = hoursText ? ` (${hoursText})` : "";
      return p5(t, [
        `En este momento nos encontramos fuera de nuestro horario de atención${h}. Una persona le responderá por este medio en cuanto reanudemos nuestras labores.`,
        `Estamos fuera de nuestro horario de atención${h}. Una persona le responderá por este medio en cuanto abramos.`,
        `En este momento estamos fuera de nuestro horario de atención${h}. Una persona te responderá por este medio en cuanto abramos.`,
        `Ahorita estamos fuera de horario${h}. Apenas abramos, una persona te responde por aquí.`,
        `¡Ahorita estamos fuera de horario${h}! 🌙 En cuanto abramos, una persona te escribe por aquí.`,
      ]);
    }
    if (open === true) return f ? "Una persona le contactará por este medio en breve." : "Una persona te contactará por este medio en breve.";
    return (f ? "Una persona le contactará por este medio lo antes posible." : "Una persona te contactará por este medio lo antes posible.")
      + (hoursText ? ` Horario de atención: ${hoursText}.` : "");
  }
  if (open === false) return `We are currently outside our business hours${hoursText ? ` (${hoursText})` : ""}. Someone will reply here as soon as we open.`;
  if (open === true) return "Someone will contact you here shortly.";
  return "Someone will contact you here as soon as possible." + (hoursText ? ` Business hours: ${hoursText}.` : "");
}
