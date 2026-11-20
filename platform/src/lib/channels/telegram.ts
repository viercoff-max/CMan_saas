// Telegram Bot API client + update parser. SERVER ONLY. No DB, no Next imports (easy to test with a mocked fetch).
// Checked against https://core.telegram.org/bots/api (Bot API 10.4, 2026-11-09), fetched 2026-11-19:
// - Requests: https://api.telegram.org/bot<token>/METHOD_NAME, HTTPS only. Response JSON {ok, result} or
//   {ok:false, description, error_code, parameters?: ResponseParameters}. ResponseParameters.retry_after = "In case of
//   exceeding flood control, the number of seconds left to wait before the request can be repeated".
// - getMe: "A simple method for testing your bot's authentication token". Returns a User (id, is_bot, username...).
// - setWebhook: url (HTTPS), allowed_updates, drop_pending_updates, secret_token ("1-256 characters. Only characters
//   A-Z, a-z, 0-9, _ and - are allowed"); every webhook request then carries the header X-Telegram-Bot-Api-Secret-Token.
//   "Ports currently supported for webhooks: 443, 80, 88, 8443."
// - deleteWebhook: optional drop_pending_updates; returns True.
// - sendMessage: chat_id, text "1-4096 characters after entities parsing", optional parse_mode. We never send parse_mode,
//   so customer-facing text is sent as plain text (no Markdown/HTML entity injection from LLM output).
// - Update: update_id + at most ONE of message, edited_message, channel_post, ... Message: message_id, from (User,
//   is_bot), sender_chat, chat (Chat: id, type "private"|"group"|"supergroup"|"channel", first_name, last_name, username),
//   date, text, caption, photo, voice, audio, video, video_note, animation, document, sticker, location, venue, contact,
//   poll, dice.
// The bot token is part of the request URL (Telegram's design): NEVER log URLs, tokens, errors' messages or bodies here.
import { mediaText, type MediaKind } from "../engine/media";

export const TELEGRAM_API = "https://api.telegram.org";
/** sendMessage text limit (characters). */
export const TELEGRAM_TEXT_LIMIT = 4096;
/** Webhook update types we subscribe to (setWebhook allowed_updates). */
export const TELEGRAM_ALLOWED_UPDATES = ["message", "edited_message"] as const;
/** Ports Telegram can deliver webhooks to. */
export const TELEGRAM_WEBHOOK_PORTS = ["443", "80", "88", "8443"] as const;

const TIMEOUT_MS = 10_000;

/** BotFather tokens look like "123456789:AAH...": numeric bot id, colon, 30+ url-safe chars. */
const TOKEN_SHAPE = /^(\d{5,20}):[A-Za-z0-9_-]{30,100}$/;
export const isTelegramBotToken = (t: unknown): t is string => typeof t === "string" && TOKEN_SHAPE.test(t);
export const botIdFromToken = (t: string): string | null => TOKEN_SHAPE.exec(t)?.[1] ?? null;

/** Shows only the first 4 and last 2 characters ("7412••••Qx"): safe for the UI. */
export const maskTelegramToken = (t: string): string => (t.length > 8 ? `${t.slice(0, 4)}••••••••${t.slice(-2)}` : "••••");

/** Telegram only delivers to public HTTPS URLs on 443/80/88/8443 (local hosts can never be reached). */
export function telegramWebhookReachable(publicUrl: string | undefined): boolean {
  if (!publicUrl) return false;
  try {
    const u = new URL(publicUrl);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".localhost") || h === "127.0.0.1" || h === "[::1]") return false;
    return u.port === "" || (TELEGRAM_WEBHOOK_PORTS as readonly string[]).includes(u.port);
  } catch { return false; }
}

export function telegramWebhookUrl(publicUrl: string, webhookId: string): string {
  return `${publicUrl.replace(/\/+$/, "")}/api/webhooks/telegram/${encodeURIComponent(webhookId)}`;
}

// ---------------- API calls ----------------
export type TelegramFailure = "token" | "blocked" | "chat_not_found" | "rate" | "network" | "timeout" | "bad_request" | "unknown";
export type TgResult<T> = { ok: true; result: T } | { ok: false; error: TelegramFailure; status?: number; retryAfter?: number };
type Fetch = typeof fetch;

/** Telegram error -> coarse category. 401 = bad token, 404 = token malformed / bot deleted, 403 = user blocked the bot. */
export function classifyTelegramError(status: number, description: unknown): TelegramFailure {
  const d = String(description ?? "").toLowerCase();
  if (status === 401 || status === 404) return "token";
  if (status === 403) return "blocked";
  if (status === 429) return "rate";
  if (status === 400 && d.includes("chat not found")) return "chat_not_found";
  if (status === 400) return "bad_request";
  return "unknown";
}

export async function telegramCall<T = unknown>(token: string, method: string, params: Record<string, unknown> = {}, f: Fetch = fetch): Promise<TgResult<T>> {
  try {
    const res = await f(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    let body: { ok?: boolean; result?: T; description?: string; parameters?: { retry_after?: number } } | null = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    if (res.ok && body?.ok === true) return { ok: true, result: body.result as T };
    const status = res.ok ? 500 : res.status;
    const retry = Number(body?.parameters?.retry_after);
    return { ok: false, error: classifyTelegramError(status, body?.description), status, ...(retry > 0 ? { retryAfter: retry } : {}) };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network" };
  }
}

export interface TelegramBot { id: string; username: string; firstName: string }

/** getMe -> bot id + @username. A token that is not a bot (is_bot false) or has no username is rejected. */
export async function telegramGetMe(token: string, f: Fetch = fetch): Promise<TgResult<TelegramBot>> {
  const r = await telegramCall<{ id?: number; is_bot?: boolean; username?: string; first_name?: string }>(token, "getMe", {}, f);
  if (!r.ok) return r;
  const u = r.result ?? {};
  if (u.is_bot !== true || !u.username || u.id === undefined) return { ok: false, error: "token" };
  return { ok: true, result: { id: String(u.id), username: String(u.username).slice(0, 64), firstName: String(u.first_name ?? "").slice(0, 80) } };
}

export function telegramSetWebhook(token: string, o: { url: string; secretToken: string }, f: Fetch = fetch): Promise<TgResult<boolean>> {
  return telegramCall<boolean>(token, "setWebhook", {
    url: o.url,
    secret_token: o.secretToken,
    allowed_updates: [...TELEGRAM_ALLOWED_UPDATES],
    drop_pending_updates: true,
  }, f);
}

export function telegramDeleteWebhook(token: string, f: Fetch = fetch): Promise<TgResult<boolean>> {
  return telegramCall<boolean>(token, "deleteWebhook", { drop_pending_updates: true }, f);
}

// ---------------- inbound updates ----------------
export interface TelegramInbound {
  /** chat.id (private chat = the customer). */
  externalId: string;
  customerName: string;
  /** Text, caption-only media as a placeholder ("[Foto] caption"), or "Hola" for /start. */
  text: string;
  /** `${chat.id}:${message_id}`: message_id is unique per chat only. */
  providerMessageId: string;
  media?: MediaKind;
}

export type TelegramSkip = "not_message" | "edited" | "not_private" | "from_bot" | "no_sender" | "empty";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

/** Message fields -> media kind, first match wins (animation messages also carry `document`, so it goes first). */
const MEDIA_FIELDS: [string, MediaKind][] = [
  ["photo", "image"], ["sticker", "sticker"], ["voice", "audio"], ["audio", "audio"], ["animation", "video"],
  ["video", "video"], ["video_note", "video"], ["document", "document"], ["venue", "location"], ["location", "location"],
  ["contact", "contact"], ["poll", "other"], ["dice", "other"], ["story", "share"],
];

/** "/start" or "/start@MyBot payload": the deep-link greeting. */
const START_RE = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/;

/**
 * One webhook Update -> one inbound customer message, or the reason it is ignored.
 * MVP rules: private chats only (groups, supergroups, channel posts ignored); messages from bots or sent on behalf of a
 * chat (sender_chat) ignored. EDITS ARE IGNORED: the original message was already answered, and re-answering an edit
 * would send a second reply (edited_message stays in allowed_updates so a later version can show edits in the inbox).
 */
export function parseTelegramUpdate(body: unknown): { ok: true; item: TelegramInbound } | { ok: false; skip: TelegramSkip } {
  if (!isObj(body)) return { ok: false, skip: "not_message" };
  if (isObj(body.edited_message)) return { ok: false, skip: "edited" };
  const m = body.message;
  if (!isObj(m)) return { ok: false, skip: "not_message" };
  const chat = isObj(m.chat) ? m.chat : null;
  if (!chat || chat.type !== "private") return { ok: false, skip: "not_private" };
  if (isObj(m.sender_chat)) return { ok: false, skip: "not_private" };
  const from = isObj(m.from) ? m.from : null;
  if (!from) return { ok: false, skip: "no_sender" };
  if (from.is_bot === true) return { ok: false, skip: "from_bot" };
  const chatId = str(chat.id), msgId = str(m.message_id);
  if (!chatId || !msgId) return { ok: false, skip: "no_sender" };

  const name = [str(from.first_name ?? chat.first_name), str(from.last_name ?? chat.last_name)].map((s) => s.trim()).filter(Boolean).join(" ")
    || str(from.username ?? chat.username).trim();
  const base = { externalId: chatId, customerName: name.slice(0, 80), providerMessageId: `${chatId}:${msgId}` };

  const text = str(m.text);
  if (text.trim()) {
    return { ok: true, item: { ...base, text: START_RE.test(text.trim()) ? "Hola" : text } };
  }
  const found = MEDIA_FIELDS.find(([field]) => m[field] !== undefined && m[field] !== null);
  if (found) {
    const kind = found[1];
    return { ok: true, item: { ...base, text: mediaText(kind, str(m.caption)), media: kind } };
  }
  return { ok: false, skip: "empty" }; // service messages (joined, pinned...), unknown types
}
