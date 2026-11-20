// Channel availability: ONE source of truth for the public site, "Plan y uso" and /channels (REVIEW-qa-2 P1-4).
// MVP: Telegram is the only live channel. The Meta channels stay "coming soon" (no connect forms) until the Meta app is
// reviewed and live. Flip a value here to open a channel everywhere at once.
import type { Locale } from "../i18n-shared";

export type PublicChannel = "telegram" | "whatsapp" | "instagram" | "messenger";
export type ChannelAvailability = "available" | "soon";

export const CHANNEL_AVAILABILITY: Readonly<Record<PublicChannel, ChannelAvailability>> = {
  telegram: "available",
  whatsapp: "soon",
  instagram: "soon",
  messenger: "soon",
};

export const CHANNEL_ORDER: readonly PublicChannel[] = ["telegram", "whatsapp", "instagram", "messenger"];
export const CHANNEL_NAMES: Readonly<Record<PublicChannel, string>> = {
  telegram: "Telegram", whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger",
};

export const isChannelAvailable = (c: PublicChannel) => CHANNEL_AVAILABILITY[c] === "available";
export const availableChannels = () => CHANNEL_ORDER.filter(isChannelAvailable);
export const comingSoonChannels = () => CHANNEL_ORDER.filter((c) => !isChannelAvailable(c));

export const AVAILABILITY_LABEL: Readonly<Record<Locale, Record<ChannelAvailability, string>>> = {
  es: { available: "Disponible", soon: "Próximamente" },
  en: { available: "Available", soon: "Coming soon" },
};

/** "WhatsApp, Instagram y Messenger" / "WhatsApp, Instagram and Messenger". */
export function listNames(chs: readonly PublicChannel[], locale: Locale): string {
  const n = chs.map((c) => CHANNEL_NAMES[c]);
  if (n.length <= 1) return n.join("");
  return `${n.slice(0, -1).join(", ")} ${locale === "en" ? "and" : "y"} ${n[n.length - 1]}`;
}

/** Landing chips: [{ name, state }] in display order. */
export function channelChips(locale: Locale): { name: string; state: string; available: boolean }[] {
  return CHANNEL_ORDER.map((c) => ({ name: CHANNEL_NAMES[c], state: AVAILABILITY_LABEL[locale][CHANNEL_AVAILABILITY[c]], available: isChannelAvailable(c) }));
}
