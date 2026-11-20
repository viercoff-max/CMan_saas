// Telegram webhook authentication (wave 2 builds the connector on this). SERVER ONLY.
// Routing + secret, both required (fail closed):
//   1. URL: /api/webhooks/telegram/<webhookId>  -> getData().channels.findByWebhookId("telegram", webhookId)
//      (public random uuid of the channel row; only CONNECTED accounts match).
//   2. Header X-Telegram-Bot-Api-Secret-Token  -> must equal the `webhookSecret` stored ENCRYPTED in
//      getData().secrets ("channel", "telegram"), compared in constant time. There is no plaintext/hash column.
// Connect flow (wave 2): secret = newTelegramWebhookSecret(); channels.save(... connected ...);
// secrets.set(tenantId, "channel", "telegram", { botToken, webhookSecret: secret }); then Telegram setWebhook with
// url = `${PUBLIC_URL}/api/webhooks/telegram/${channel.webhookId}` and secret_token = secret.
// Never log the bot token, the secret or the header value.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getData } from "../data";

/** Header Telegram sends with the secret_token given to setWebhook. */
export const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";
/** Telegram allows 1-256 chars of A-Z a-z 0-9 _ -. */
const SECRET_SHAPE = /^[A-Za-z0-9_-]{1,256}$/;

/** 256 random bits, base64url (43 chars, valid as Telegram secret_token). */
export const newTelegramWebhookSecret = (): string => randomBytes(32).toString("base64url");

/**
 * Constant-time comparison of the expected (stored) secret and the header value. Both are hashed first so the
 * comparison takes the same time whatever the lengths; empty, missing or malformed values never match.
 */
export function telegramSecretMatches(expected: string | null | undefined, provided: string | null | undefined): boolean {
  if (typeof expected !== "string" || typeof provided !== "string" || !SECRET_SHAPE.test(expected)) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(provided.length <= 256 ? provided : "").digest();
  return timingSafeEqual(a, b) && provided.length > 0;
}

export interface TelegramChannelSecrets { botToken?: string; webhookSecret?: string }

/**
 * Full check for the webhook route: routing id -> connected tenant -> encrypted secret -> constant-time compare.
 * Returns the tenant only when everything matches (null otherwise, with no hint why).
 */
export async function authenticateTelegramWebhook(webhookId: string, providedSecret: string | null | undefined): Promise<{ tenantId: string } | null> {
  const data = getData();
  const route = await data.channels.findByWebhookId("telegram", webhookId);
  if (!route) return null;
  const sec = await data.secrets.get<TelegramChannelSecrets>(route.tenantId, "channel", "telegram");
  return telegramSecretMatches(sec?.webhookSecret, providedSecret) ? { tenantId: route.tenantId } : null;
}
