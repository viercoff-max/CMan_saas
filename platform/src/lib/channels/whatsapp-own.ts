// WhatsApp with the BUSINESS'S OWN Meta app ("manual" mode). SERVER ONLY.
// Each tenant creates its own Meta app and pastes, in /channels: phone number ID, WABA ID, permanent access token and
// the app's App Secret. We give it a per-tenant webhook URL (/api/webhooks/whatsapp/<webhookId>, the public random
// uuid of its channel row) and a verify token we generate. Then:
//   GET  (Meta handshake): hub.verify_token must equal the tenant's stored verifyToken (constant time).
//   POST (messages): X-Hub-Signature-256 over the RAW body must verify with THAT tenant's App Secret (constant time,
//        lib/channels/meta.verifyMetaSignature); only messages for the tenant's own phone_number_id are processed.
// Fail closed: unknown id, disconnected channel, platform-mode connection (no appSecret), wrong token/signature.
// Never log tokens, secrets, header values, message text or phone numbers.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getData } from "../data";

export interface WhatsAppChannelSecrets {
  phoneNumberId?: string;
  accessToken?: string;
  wabaId?: string;
  /** Own-app mode only: the business's Meta App Secret (webhook signature key). */
  appSecret?: string;
  /** Own-app mode only: the token Meta must echo in the webhook handshake (we generate it). */
  verifyToken?: string;
}

/** 192 random bits, base64url (32 chars): pasted by the business into its Meta app's webhook settings. */
export const newWhatsAppVerifyToken = (): string => randomBytes(24).toString("base64url");

/** Meta App Secrets are 32 lowercase hex chars; accept 16-128 hex to be tolerant of format changes. */
export const APP_SECRET_SHAPE = /^[A-Fa-f0-9]{16,128}$/;

export const whatsappWebhookPath = (webhookId: string) => `/api/webhooks/whatsapp/${webhookId}`;
export function whatsappWebhookUrl(publicUrl: string | undefined, webhookId: string | null): string {
  if (!webhookId) return "";
  return `${String(publicUrl ?? "").replace(/\/+$/, "")}${whatsappWebhookPath(webhookId)}`;
}

/** Constant-time string compare via SHA-256 digests; empty or missing values never match. */
export function tokenMatches(expected: string | null | undefined, provided: string | null | undefined): boolean {
  if (typeof expected !== "string" || typeof provided !== "string" || !expected || !provided || provided.length > 512) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(provided).digest();
  return timingSafeEqual(a, b);
}

export interface OwnAppRoute { tenantId: string; secrets: WhatsAppChannelSecrets & { appSecret: string; verifyToken: string; phoneNumberId: string } }

/** webhookId -> CONNECTED whatsapp row of an ACTIVE tenant -> own-app secrets. Null otherwise (no hint why). */
export async function resolveOwnAppWebhook(webhookId: string): Promise<OwnAppRoute | null> {
  const data = getData();
  const route = await data.channels.findByWebhookId("whatsapp", webhookId);
  if (!route) return null;
  const s = await data.secrets.get<WhatsAppChannelSecrets>(route.tenantId, "channel", "whatsapp");
  if (!s?.appSecret || !s.verifyToken || !s.phoneNumberId) return null; // platform-app connection: not this route
  return { tenantId: route.tenantId, secrets: { ...s, appSecret: s.appSecret, verifyToken: s.verifyToken, phoneNumberId: s.phoneNumberId } };
}
