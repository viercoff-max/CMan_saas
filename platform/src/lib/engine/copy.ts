// Extra approved, tone-aware texts (templates.ts is shared/frozen; new wording lives here).
// Same register rules as templates.ts: 1-2 formal "usted", 3-4 "tú", emoji only at 5; never emoji for safety/legal.
import type { Lang } from "./lang";
import type { Tone } from "./templates";

type Reg = 0 | 1 | 2;
const reg = (t: Tone): Reg => (t <= 2 ? 0 : t === 3 ? 1 : 2);
const r3 = (t: Tone, v: [string, string, string]) => v[reg(t)];

/** Safety/legal: the case is flagged urgent, also (especially) outside business hours. Never "cuando abramos" alone. */
export function urgentWhen(lang: Lang, t: Tone, open: boolean | null, hoursText: string | null): string {
  const f = reg(t) === 0;
  if (lang === "es") {
    if (open === false) {
      const h = hoursText ? ` (${hoursText})` : "";
      return f
        ? `En este momento estamos fuera de nuestro horario de atención${h}, pero marcamos su caso como urgente y una persona de nuestro equipo lo revisará lo antes posible, a más tardar en cuanto abramos.`
        : `En este momento estamos fuera de nuestro horario de atención${h}, pero marcamos tu caso como urgente y una persona de nuestro equipo lo revisará lo antes posible, a más tardar en cuanto abramos.`;
    }
    if (open === true) return f
      ? "Marcamos su caso como urgente; una persona de nuestro equipo le contactará por este medio en breve."
      : "Marcamos tu caso como urgente; una persona de nuestro equipo te contactará por este medio en breve.";
    return (f
      ? "Marcamos su caso como urgente; una persona de nuestro equipo le contactará por este medio lo antes posible."
      : "Marcamos tu caso como urgente; una persona de nuestro equipo te contactará por este medio lo antes posible.")
      + (hoursText ? ` Horario de atención: ${hoursText}.` : "");
  }
  if (open === false) return `We are currently outside our business hours${hoursText ? ` (${hoursText})` : ""}, but we have flagged your case as urgent and someone from our team will review it as soon as possible, at the latest when we open.`;
  if (open === true) return "We have flagged your case as urgent; someone from our team will contact you here shortly.";
  return "We have flagged your case as urgent; someone from our team will contact you here as soon as possible." + (hoursText ? ` Business hours: ${hoursText}.` : "");
}

/** Refund / cancellation / address change: the assistant is read-only, a person does it. */
export const actionRequestIntro = (lang: Lang, t: Tone) => lang === "es"
  ? r3(t, [
    "Las devoluciones de dinero, cancelaciones y cambios de dirección los gestiona directamente una persona de nuestro equipo, así que le comunico con ella.",
    "Los reembolsos, cancelaciones y cambios de dirección los gestiona una persona de nuestro equipo, así que te comunico con ella.",
    "Los reembolsos, cancelaciones y cambios de dirección los ve una persona de nuestro equipo, así que te paso con ella.",
  ])
  : r3(t, [
    "Refunds, cancellations and address changes are handled directly by a member of our team, so I will connect you with them.",
    "Refunds, cancellations and address changes are handled by someone on our team, so I'll connect you with them.",
    "Refunds, cancellations and address changes are handled by someone on our team, so I'll connect you with them.",
  ]);

/** Appended to the generic not-found text when the shop cannot see orders older than 60 days. */
export const olderOrderOffer = (lang: Lang, t: Tone) => lang === "es"
  ? r3(t, [
    "Si su pedido tiene más de 60 días, ¿desea que le comunique con una persona de nuestro equipo?",
    "Si tu pedido tiene más de 60 días, ¿quieres que te comunique con una persona de nuestro equipo?",
    "Si tu pedido tiene más de 60 días, ¿te paso con una persona de nuestro equipo?",
  ])
  : r3(t, [
    "If your order is more than 60 days old, would you like me to connect you with a member of our team?",
    "If your order is more than 60 days old, would you like me to connect you with someone from our team?",
    "If your order is more than 60 days old, want me to connect you with someone from our team?",
  ]);

/** Sent ONCE when a conversation sends too many messages in a short time; then the bot stays silent for a while. */
export const throttled = (lang: Lang, t: Tone) => lang === "es"
  ? r3(t, [
    "Gracias por sus mensajes. Le atenderemos en unos minutos.",
    "Gracias por tus mensajes. Te atenderemos en unos minutos.",
    "¡Gracias por tus mensajes! Te atenderemos en unos minutos.",
  ])
  : r3(t, [
    "Thank you for your messages. We will assist you in a few minutes.",
    "Thanks for your messages. We'll help you in a few minutes.",
    "Thanks for your messages! We'll help you in a few minutes.",
  ]);
