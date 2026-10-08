// Pure helpers for agent settings: business hours JSON shape, default messages.
export interface BusinessHours {
  /** 1 = Monday ... 7 = Sunday */
  fromDay: number; toDay: number;
  open: string; close: string; // "HH:MM"
  timezone: string;
}
export const DEFAULT_HOURS: BusinessHours = { fromDay: 1, toDay: 5, open: "09:00", close: "18:00", timezone: "America/Mexico_City" };

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseBusinessHours(raw: string | null | undefined): BusinessHours {
  try {
    const o = JSON.parse(raw || "{}") as Partial<BusinessHours>;
    const day = (n: unknown, d: number) => (Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 7 ? (n as number) : d);
    return {
      fromDay: day(o.fromDay, DEFAULT_HOURS.fromDay),
      toDay: day(o.toDay, DEFAULT_HOURS.toDay),
      open: typeof o.open === "string" && hhmm.test(o.open) ? o.open : DEFAULT_HOURS.open,
      close: typeof o.close === "string" && hhmm.test(o.close) ? o.close : DEFAULT_HOURS.close,
      timezone: typeof o.timezone === "string" && o.timezone.length < 64 ? o.timezone : DEFAULT_HOURS.timezone,
    };
  } catch { return { ...DEFAULT_HOURS }; }
}
/**
 * True once the owner has saved hours (the Tone screen writes fromDay/days). A fresh tenant has "{}": the engine then
 * treats hours as unknown, so the Tone screen must show the default range as a proposal that is NOT saved yet.
 */
export function hoursAreSaved(raw: string | null | undefined): boolean {
  try {
    const o = JSON.parse(raw || "{}") as Record<string, unknown>;
    return !!o && typeof o === "object" && (o.days != null || o.fromDay != null);
  } catch { return false; }
}
/** close <= open means the business closes after midnight (20:00-02:00, 09:00-00:00); equal times are invalid. */
export const isOvernight = (h: Pick<BusinessHours, "open" | "close">) => h.close <= h.open;

/**
 * Saved JSON keeps the simple range the Tone screen edits (fromDay..toDay, open, close, timezone) AND the per-day map
 * the engine reads (days.mon..sun = "HH:MM-HH:MM" | null). See docs/REQUESTS.md [engine] business_hours.
 */
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const serializeBusinessHours = (h: BusinessHours) => {
  const days: Record<string, string | null> = {};
  DAY_KEYS.forEach((k, i) => {
    const d = i + 1;
    const inRange = h.fromDay <= h.toDay ? d >= h.fromDay && d <= h.toDay : d >= h.fromDay || d <= h.toDay;
    days[k] = inRange ? `${h.open}-${h.close}` : null;
  });
  return JSON.stringify({ ...h, days });
};

export const defaultGreeting = (lang: "es" | "en") =>
  lang === "en" ? "Hi! I'm the virtual assistant. How can I help you today?" : "¡Hola! Soy el asistente virtual. ¿En qué te puedo ayudar hoy?";
export const defaultFallback = (lang: "es" | "en") =>
  lang === "en"
    ? "I don't have that information right now. I'll pass your question to our team so a person can help you."
    : "No tengo esa información por ahora. Voy a pasar tu pregunta a nuestro equipo para que una persona te ayude.";

/** True when the text is one of the legacy default strings that older saves wrote into the DB. */
export const isLegacyDefault = (text: string, kind: "greeting" | "fallback") => {
  const t = text.trim();
  if (!t) return false;
  const f = kind === "greeting" ? defaultGreeting : defaultFallback;
  return t === f("es") || t === f("en");
};
/** Only a user-written text is stored; "" means "use the tone-aware template". */
export const storableCustomText = (text: string, kind: "greeting" | "fallback") => (isLegacyDefault(text, kind) ? "" : text.trim());
