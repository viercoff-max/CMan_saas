// Channel availability: ONE source of truth for the public site, "Plan y uso" and /channels (REVIEW-qa-2 P1-4).
// MVP: Telegram is the only live channel. The Meta channels stay "coming soon" (no connect forms) until the Meta app is
// reviewed and live. Flip a value here to open a channel everywhere at once.
import type { Locale } from "../i18n-shared";

export type PublicChannel = "telegram" | "whatsapp" | "instagram" | "messenger" | "email";
/** "beta" = usable today (connect form in /channels) but still being polished. */
export type ChannelAvailability = "available" | "beta" | "soon";

export const CHANNEL_AVAILABILITY: Readonly<Record<PublicChannel, ChannelAvailability>> = {
  telegram: "available",
  whatsapp: "beta", // manual connection with the business's own Meta app (lib/channels/whatsapp-own)
  instagram: "soon",
  messenger: "soon",
  email: "soon", // support by e-mail: needs the outbound mail provider (Resend SMTP) first
};

export const CHANNEL_ORDER: readonly PublicChannel[] = ["telegram", "whatsapp", "instagram", "messenger", "email"];
export const CHANNEL_NAMES: Readonly<Record<PublicChannel, string>> = {
  telegram: "Telegram", whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger", email: "Correo",
};
/** Display name in a language (only "email" is translated; the rest are brand names). */
export const channelName = (c: PublicChannel, locale: Locale): string => (c === "email" && locale === "en" ? "Email" : CHANNEL_NAMES[c]);
/** Chat channels (the ones a plan's channel allowance talks about); e-mail is a separate support channel. */
export const CHAT_CHANNELS: readonly PublicChannel[] = ["telegram", "whatsapp", "instagram", "messenger"];

export const isChannelAvailable = (c: PublicChannel) => CHANNEL_AVAILABILITY[c] !== "soon";
export const availableChannels = () => CHANNEL_ORDER.filter(isChannelAvailable);
export const comingSoonChannels = () => CHANNEL_ORDER.filter((c) => CHANNEL_AVAILABILITY[c] === "soon");

export const AVAILABILITY_LABEL: Readonly<Record<Locale, Record<ChannelAvailability, string>>> = {
  es: { available: "Disponible", beta: "Beta", soon: "Próximamente" },
  en: { available: "Available", beta: "Beta", soon: "Coming soon" },
};

/** "WhatsApp, Instagram y Messenger" / "WhatsApp, Instagram and Messenger". */
export function listNames(chs: readonly PublicChannel[], locale: Locale): string {
  const n = chs.map((c) => channelName(c, locale));
  if (n.length <= 1) return n.join("");
  return `${n.slice(0, -1).join(", ")} ${locale === "en" ? "and" : "y"} ${n[n.length - 1]}`;
}

/** Landing chips: [{ name, state }] in display order. */
export function channelChips(locale: Locale): { id: PublicChannel; name: string; state: string; available: boolean }[] {
  return CHANNEL_ORDER.map((c) => ({ id: c, name: channelName(c, locale), state: AVAILABILITY_LABEL[locale][CHANNEL_AVAILABILITY[c]], available: isChannelAvailable(c) }));
}

/**
 * WhatsApp (beta) can be connected in /channels once the PLATFORM's Meta app is wired: META_APP_SECRET (webhook
 * signature) and META_VERIFY_TOKEN (webhook handshake) are set. Server only (reads env). The public site keeps
 * WhatsApp as "coming soon" until the Meta app passes review (CHANNEL_AVAILABILITY above).
 */
export function whatsappPlatformReady(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.META_APP_SECRET?.trim() && !!env.META_VERIFY_TOKEN?.trim();
}
