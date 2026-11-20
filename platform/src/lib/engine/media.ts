// Non-text inbound messages (photos, voice notes, stickers, locations, files...).
// Channels turn them into a short placeholder text ("[Foto]", "[Nota de voz] caption"...) so staff see them in the inbox.
// The engine NEVER sends these to retrieval or the LLM: it stores them and hands off to a person with a short ack.
import type { Lang } from "./lang";
import type { Tone } from "./templates";

export type MediaKind = "image" | "audio" | "video" | "document" | "sticker" | "location" | "contact" | "share" | "other";

/** Placeholder text stored as the message body (Spanish: the staff UI is Spanish-first). */
export const MEDIA_LABEL: Record<MediaKind, string> = {
  image: "[Foto]",
  audio: "[Nota de voz]",
  video: "[Video]",
  document: "[Archivo]",
  sticker: "[Sticker]",
  location: "[Ubicación]",
  contact: "[Contacto]",
  share: "[Publicación compartida]",
  other: "[Archivo]",
};

/** Builds the stored text for a media message: "[Foto]" or "[Foto] caption". */
export function mediaText(kind: MediaKind, caption?: string): string {
  const c = String(caption ?? "").trim();
  return c ? `${MEDIA_LABEL[kind]} ${c}` : MEDIA_LABEL[kind];
}

const BY_LABEL = new Map<string, MediaKind>(
  (Object.entries(MEDIA_LABEL) as [MediaKind, string][]).filter(([k]) => k !== "other").map(([k, v]) => [v.toLowerCase(), k]),
);

/** Recognizes a placeholder produced by mediaText (also typed in the simulator). Returns null for normal text. */
export function parseMediaText(text: string): { kind: MediaKind; caption: string } | null {
  const m = /^\s*(\[[^\]\n]{2,30}\])\s*([\s\S]*)$/.exec(String(text ?? ""));
  if (!m) return null;
  const kind = BY_LABEL.get(m[1].toLowerCase());
  return kind ? { kind, caption: m[2].trim() } : null;
}

const reg = (t: Tone) => (t <= 2 ? 0 : t === 5 ? 2 : 1);

/** Tone-aware acknowledgement. No emoji below tone 5. */
export function attachmentReceived(lang: Lang, tone: Tone, kind: MediaKind): string {
  const r = reg(tone);
  if (lang === "en") {
    const what = kind === "image" ? "photo" : kind === "audio" ? "voice message" : kind === "video" ? "video" : kind === "document" ? "file" : "message";
    return [
      `We have received your ${what}, thank you. A member of our team will review it.`,
      `We received your ${what}, thanks. Someone on our team will review it.`,
      `Got your ${what}, thanks! 🙌 Someone on our team will review it.`,
    ][r];
  }
  // [usted, tú, object pronoun agreeing with the noun: la foto / la nota de voz / la ubicación, lo el video...]
  const es: Record<MediaKind, [string, string, "la" | "lo"]> = {
    image: ["su foto", "tu foto", "la"],
    audio: ["su nota de voz", "tu nota de voz", "la"],
    video: ["su video", "tu video", "lo"],
    document: ["su archivo", "tu archivo", "lo"],
    sticker: ["su mensaje", "tu mensaje", "lo"],
    location: ["su ubicación", "tu ubicación", "la"],
    contact: ["su mensaje", "tu mensaje", "lo"],
    share: ["su mensaje", "tu mensaje", "lo"],
    other: ["su archivo", "tu archivo", "lo"],
  };
  const [usted, tu, pron] = es[kind];
  // "Alguien de nuestro equipo" (not "una persona"): the handoff line that follows already says "una persona ...".
  return [
    `Recibimos ${usted}, gracias. Alguien de nuestro equipo ${pron} va a revisar.`,
    `Recibimos ${tu}, gracias. Alguien de nuestro equipo ${pron} va a revisar.`,
    `¡Recibimos ${tu}, gracias! 🙌 Alguien de nuestro equipo ${pron} va a revisar.`,
  ][r];
}
