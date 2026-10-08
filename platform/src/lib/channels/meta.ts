// Pure helpers for Meta webhooks (no DB, no Next imports) so they are easy to test.
import { createHmac, timingSafeEqual } from "node:crypto";
import { mediaText, type MediaKind } from "../engine/media";

export type MetaChannel = "whatsapp" | "instagram" | "messenger";
export interface MetaInbound {
  channel: MetaChannel;
  /** phone_number_id (WhatsApp) or page id / IG business id: used to find the tenant. */
  accountId: string;
  /**
   * Other ids that may identify the same business account (Instagram only: recipient.id). Meta's docs disagree on
   * whether entry.id is the IG professional account id or the linked Page id, so routing tries both.
   */
  altAccountIds?: string[];
  /** The customer's id on that platform (wa_id / PSID / IGSID). */
  externalId: string;
  customerName: string;
  /** Customer text, or a placeholder like "[Foto] caption" for non-text messages (see engine/media). */
  text: string;
  providerMessageId?: string;
  /** Set for non-text messages (photo, voice note, sticker, location, file...). */
  media?: MediaKind;
}

function eq(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** GET handshake: returns the challenge to echo, or null when it must be rejected. */
export function checkVerifyHandshake(params: URLSearchParams, expectedToken: string | undefined): string | null {
  if (!expectedToken) return null;
  if (params.get("hub.mode") !== "subscribe") return null;
  const token = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge");
  if (challenge === null || !eq(token, expectedToken)) return null;
  return challenge;
}

/**
 * Meta: "we generate the signature using an escaped unicode version of the payload, with lowercase hex digits"
 * (äöå -> äöå). Meta normally SENDS the body already escaped, so the raw bytes match; this is the
 * fallback for a body that arrives with literal non-ASCII characters.
 */
export function escapeUnicode(s: string): string {
  return s.replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Validates X-Hub-Signature-256 ("sha256=<hex>") over the RAW body (then over its escaped-unicode form). */
export function verifyMetaSignature(rawBody: string, header: string | null | undefined, appSecret: string): boolean {
  if (!header || !header.startsWith("sha256=") || !appSecret) return false;
  const given = header.slice(7).toLowerCase();
  const mac = (s: string) => createHmac("sha256", appSecret).update(s, "utf8").digest("hex");
  if (eq(given, mac(rawBody))) return true;
  const escaped = escapeUnicode(rawBody);
  return escaped !== rawBody && eq(given, mac(escaped));
}

/** True only for local development hosts (or no PUBLIC_URL at all). */
export function isLocalPublicUrl(publicUrl: string | undefined): boolean {
  if (!publicUrl) return true;
  try {
    const h = new URL(publicUrl).hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1" || h.endsWith(".localhost");
  } catch { return false; }
}

/**
 * Decision for POST. FAIL CLOSED in every environment (NODE_ENV is irrelevant: the on-prem build runs `next dev`).
 * - A signature header that is present is ALWAYS verified (constant time, raw body) and rejected when invalid.
 * - A missing header or a missing META_APP_SECRET is rejected, unless ALLOW_UNSIGNED_WEBHOOKS=1 is set explicitly
 *   AND PUBLIC_URL is a local host (the flag is ignored behind a public tunnel).
 */
export function signaturePolicy(opts: {
  /** META_APP_SECRET, optionally plus META_IG_APP_SECRET (Instagram Login apps show a separate Instagram app secret). */
  secret?: string | (string | undefined)[]; header?: string | null; rawBody: string; allowUnsigned?: string; publicUrl?: string;
}): { ok: boolean; reason?: string } {
  const header = opts.header ?? "";
  const secrets = (Array.isArray(opts.secret) ? opts.secret : [opts.secret]).filter((s): s is string => !!s);
  const unsignedAllowed = opts.allowUnsigned === "1" && isLocalPublicUrl(opts.publicUrl);
  if (header) {
    if (secrets.length === 0) return unsignedAllowed ? { ok: true } : { ok: false, reason: "no_app_secret" };
    return secrets.some((s) => verifyMetaSignature(opts.rawBody, header, s)) ? { ok: true } : { ok: false, reason: "bad_signature" };
  }
  if (unsignedAllowed) return { ok: true };
  return { ok: false, reason: secrets.length ? "missing_signature" : "no_app_secret" };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

const WA_MEDIA: Record<string, MediaKind> = {
  image: "image", audio: "audio", voice: "audio", video: "video", document: "document", sticker: "sticker",
  location: "location", contacts: "contact", unsupported: "other", unknown: "other",
};
// Messenger: image, audio, video, file, template, fallback (+ stickers as image with payload.sticker_id).
// Instagram (docs 2026-10): image (includes stickers), audio, video, file, share, story_mention, ig_reel, reel, ephemeral.
const FB_MEDIA: Record<string, MediaKind> = {
  image: "image", audio: "audio", video: "video", file: "document", location: "location",
  share: "share", story_mention: "share", ig_reel: "share", reel: "share", template: "share", fallback: "share", ig_post: "share",
  ephemeral: "other",
};

/**
 * WhatsApp message -> text or media placeholder. Types (Cloud API webhook reference): text, image, audio (voice notes are
 * audio with voice:true), video, document, sticker, location, contacts, reaction, button, interactive, order, system,
 * unsupported. Reactions, system, order and request_welcome are ignored (null).
 */
function waMessage(m: Obj): { text: string; media?: MediaKind } | null {
  const type = str(m.type);
  if (type === "text") return isObj(m.text) && str(m.text.body).trim() ? { text: str(m.text.body) } : null;
  if (type === "button" && isObj(m.button)) return str(m.button.text).trim() ? { text: str(m.button.text) } : null;
  if (type === "interactive" && isObj(m.interactive)) {
    const i = m.interactive;
    const r = isObj(i.button_reply) ? i.button_reply : isObj(i.list_reply) ? i.list_reply : null;
    return r && str(r.title).trim() ? { text: str(r.title) } : null; // nfm_reply (Flows) ignored
  }
  const kind = WA_MEDIA[type];
  if (!kind) return null; // reaction, system, order, request_welcome...
  const body = isObj(m[type]) ? (m[type] as Obj) : {};
  const caption = str(body.caption);
  return { text: mediaText(kind, caption), media: kind };
}

/** Messenger/Instagram message -> text or media placeholder. */
function fbMessage(msg: Obj): { text: string; media?: MediaKind } | null {
  const text = str(msg.text);
  const atts = arr(msg.attachments).filter(isObj);
  const sticker = !!msg.sticker_id || atts.some((a) => isObj(a.payload) && !!a.payload.sticker_id);
  if (sticker) return { text: mediaText("sticker", text), media: "sticker" };
  if (atts.length > 0) {
    const kind = FB_MEDIA[str(atts[0].type)] ?? "other";
    return { text: mediaText(kind, text), media: kind };
  }
  if (msg.is_unsupported) return { text: mediaText("other", text), media: "other" };
  return text.trim() ? { text } : null;
}

/**
 * Extracts inbound customer messages. Text is passed through; photos, voice notes, stickers, locations and files become
 * a placeholder text plus `media` (they used to be dropped silently). Echoes, reads, deliveries, statuses, reactions
 * and comments are ignored.
 */
export function parseMetaPayload(body: unknown): MetaInbound[] {
  const out: MetaInbound[] = [];
  if (!isObj(body)) return out;
  const object = str(body.object);

  for (const entry of arr(body.entry)) {
    if (!isObj(entry)) continue;

    if (object === "whatsapp_business_account") {
      for (const change of arr(entry.changes)) {
        if (!isObj(change) || change.field !== "messages" || !isObj(change.value)) continue;
        const value = change.value;
        const phoneId = isObj(value.metadata) ? str(value.metadata.phone_number_id) : "";
        if (!phoneId) continue;
        const names = new Map<string, string>();
        for (const c of arr(value.contacts)) {
          if (isObj(c)) names.set(str(c.wa_id), isObj(c.profile) ? str(c.profile.name) : "");
        }
        for (const m of arr(value.messages)) {
          if (!isObj(m)) continue;
          const from = str(m.from);
          const parsed = waMessage(m);
          if (!from || !parsed) continue;
          out.push({
            channel: "whatsapp", accountId: phoneId, externalId: from, customerName: names.get(from) ?? "", text: parsed.text,
            providerMessageId: str(m.id) || undefined, ...(parsed.media ? { media: parsed.media } : {}),
          });
        }
      }
    } else if (object === "instagram" || object === "page") {
      const channel: MetaChannel = object === "instagram" ? "instagram" : "messenger";
      const accountId = str(entry.id);
      if (!accountId) continue;
      // entry.messaging only. entry.standby (another app owns the thread, handover protocol) is intentionally ignored.
      for (const ev of arr(entry.messaging)) {
        if (!isObj(ev) || !isObj(ev.sender)) continue;
        const sender = str(ev.sender.id);
        const recipient = isObj(ev.recipient) ? str(ev.recipient.id) : "";
        if (!sender || sender === accountId || (recipient && sender === recipient)) continue;
        let parsed: { text: string; media?: MediaKind } | null = null;
        let mid = "";
        if (isObj(ev.message)) {
          const msg = ev.message;
          if (msg.is_echo || msg.is_deleted) continue; // our own outgoing messages / unsent
          parsed = fbMessage(msg);
          mid = str(msg.mid);
        } else if (isObj(ev.postback)) {
          // Button tap (Get Started, ice breakers, persistent menu): treat the button title as what the customer said.
          const pb = ev.postback;
          const t = str(pb.title).trim() || str(pb.payload).trim();
          parsed = t ? { text: t } : null;
          mid = str(pb.mid);
        } // reactions, reads, deliveries, referrals, optins: ignored
        if (!parsed) continue;
        // Instagram: recipient.id is the IG professional account id (Messenger Platform IG webhook reference).
        const alt = channel === "instagram" && recipient && recipient !== accountId ? { altAccountIds: [recipient] } : {};
        out.push({
          channel, accountId, ...alt, externalId: sender, customerName: "", text: parsed.text,
          providerMessageId: mid || undefined, ...(parsed.media ? { media: parsed.media } : {}),
        });
      }
    }
  }
  return out;
}

export interface MetaSendFailure { channel: "whatsapp"; accountId: string; providerMessageId: string; code: number; title: string }

/**
 * WhatsApp delivery failures arrive LATER as a status webhook (statuses[].status = "failed", errors[].code), e.g.
 * 131047 (24 h window closed: a template is required) or 131026 (undeliverable). The send call itself returned 200.
 * No phone numbers are returned (recipient_id is personal data and is not needed for the log).
 */
export function parseMetaStatusFailures(body: unknown): MetaSendFailure[] {
  const out: MetaSendFailure[] = [];
  if (!isObj(body) || body.object !== "whatsapp_business_account") return out;
  for (const entry of arr(body.entry)) {
    if (!isObj(entry)) continue;
    for (const change of arr(entry.changes)) {
      if (!isObj(change) || !isObj(change.value)) continue;
      const phoneId = isObj(change.value.metadata) ? str(change.value.metadata.phone_number_id) : "";
      for (const s of arr(change.value.statuses)) {
        if (!isObj(s) || s.status !== "failed") continue;
        const e = arr(s.errors).find(isObj) ?? {};
        out.push({ channel: "whatsapp", accountId: phoneId, providerMessageId: str(s.id), code: Number(e.code) || 0, title: str(e.title).slice(0, 120) });
      }
    }
  }
  return out;
}
