// ManyChat integration (server only). Checked against ManyChat's own API spec (api.manychat.com/swagger, Page API)
// and the Dynamic Block docs (manychat.github.io/dynamic_block_docs), 2026-11:
//   - Auth: "Authorization: Bearer <API key>" (ManyChat > Settings > API; needs a paid ManyChat plan).
//   - GET  /fb/page/getInfo  -> { status: "success", data: { id, name, is_pro, ... } }   (key check on connect)
//   - POST /fb/sending/sendContent { subscriber_id: <int>, data: <Dynamic Block v2>, message_tag? }  (inbox replies)
//     400 code 3011 = last interaction over 24 h (needs a message tag); 304X = not sendable on that channel.
//   - Dynamic Block v2: { version: "v2", content: { type?: "instagram" | "whatsapp" | "telegram", messages: [...] } }
//     (no "type" for Messenger).
// Inbound: the business's ManyChat flow calls POST /api/integrations/manychat/<webhookId> (External Request /
// Dynamic Block) with header "Authorization: Bearer <request token we generate>". Never log keys, tokens or text.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getData } from "../data";

export const MANYCHAT_API = "https://api.manychat.com";
const TIMEOUT_MS = 8_000;
/** Conservative per-message limit valid on Messenger (2000), Instagram (1000) and WhatsApp (4096). */
export const MANYCHAT_TEXT_LIMIT = 1000;

export type ManychatSubChannel = "messenger" | "instagram" | "whatsapp" | "telegram";
export const MANYCHAT_SUB_CHANNELS: readonly ManychatSubChannel[] = ["messenger", "instagram", "whatsapp", "telegram"];
export const isManychatSubChannel = (v: unknown): v is ManychatSubChannel =>
  typeof v === "string" && (MANYCHAT_SUB_CHANNELS as readonly string[]).includes(v);

export interface ManychatSecrets { apiKey?: string; requestToken?: string }

/** 256 random bits, base64url: the token the business puts in its ManyChat External Request header. */
export const newManychatRequestToken = (): string => randomBytes(32).toString("base64url");

/** ManyChat API keys look like "1234567:abcdef..." (digits, a colon, then hex/alphanumerics). */
export const isManychatApiKey = (k: string) => /^\d{3,20}:[A-Za-z0-9]{16,128}$/.test(k.trim());

export const manychatEndpointPath = (webhookId: string) => `/api/integrations/manychat/${webhookId}`;
export const manychatEndpointUrl = (publicUrl: string | undefined, webhookId: string | null) =>
  webhookId ? `${String(publicUrl ?? "").replace(/\/+$/, "")}${manychatEndpointPath(webhookId)}` : "";

/** Constant-time compare of the stored token with "Bearer <token>" (or the bare token); empty never matches. */
export function requestTokenMatches(expected: string | null | undefined, header: string | null | undefined): boolean {
  if (typeof expected !== "string" || !expected || typeof header !== "string" || header.length > 600) return false;
  const provided = header.replace(/^Bearer\s+/i, "").trim();
  if (!provided) return false;
  return timingSafeEqual(createHash("sha256").update(expected).digest(), createHash("sha256").update(provided).digest());
}

/** webhookId -> CONNECTED manychat row of an ACTIVE tenant -> token check. Null otherwise (no hint why). */
export async function authenticateManychat(webhookId: string, header: string | null): Promise<{ tenantId: string } | null> {
  const data = getData();
  const route = await data.channels.findByWebhookId("manychat", webhookId);
  if (!route) return null;
  const sec = await data.secrets.get<ManychatSecrets>(route.tenantId, "channel", "manychat");
  return requestTokenMatches(sec?.requestToken, header) ? { tenantId: route.tenantId } : null;
}

type Fetch = typeof fetch;
export type ManychatFailure = "token" | "plan" | "rate" | "network" | "window" | "channel" | "unknown";

async function call(method: "GET" | "POST", path: string, apiKey: string, body: unknown, f: Fetch) {
  try {
    const res = await f(`${MANYCHAT_API}${path}`, {
      method, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let j: Record<string, unknown> = {};
    try { j = (await res.json()) as Record<string, unknown>; } catch { /* non-JSON */ }
    return { status: res.status, body: j };
  } catch {
    return { status: 0, body: {} as Record<string, unknown> };
  }
}

function classify(status: number, body: Record<string, unknown>): ManychatFailure {
  const code = Number(body.code) || 0;
  if (status === 0) return "network";
  if (status === 401 || status === 403) return "token";
  if (status === 429) return "rate";
  if (code === 3011 || code === 3031) return "window";
  if (code >= 3040 && code <= 3049) return "channel";
  if (status === 402) return "plan";
  return "unknown";
}

/** Validates the API key and returns the ManyChat account name. */
export async function manychatGetInfo(apiKey: string, f: Fetch = fetch): Promise<{ ok: true; name: string; id: string; pro: boolean } | { ok: false; error: ManychatFailure }> {
  const r = await call("GET", "/fb/page/getInfo", apiKey, null, f);
  if (r.status === 200 && r.body.status === "success" && typeof r.body.data === "object" && r.body.data) {
    const d = r.body.data as Record<string, unknown>;
    return { ok: true, name: String(d.name ?? "ManyChat").slice(0, 80), id: String(d.id ?? ""), pro: d.is_pro === true };
  }
  return { ok: false, error: classify(r.status, r.body) };
}

/** Dynamic Block v2 with plain text messages (no URL buttons, no markup). */
export function dynamicBlock(texts: string[], sub: ManychatSubChannel | null): Record<string, unknown> {
  const content: Record<string, unknown> = { messages: texts.filter((t) => t.trim()).slice(0, 10).map((text) => ({ type: "text", text })) };
  if (sub === "instagram" || sub === "whatsapp" || sub === "telegram") content.type = sub;
  return { version: "v2", content };
}

/** Inbox reply to a ManyChat contact. No message tag: outside 24 h ManyChat refuses (3011) and we say so. */
export async function manychatSendText(apiKey: string, subscriberId: string, texts: string[], sub: ManychatSubChannel | null, f: Fetch = fetch): Promise<{ ok: boolean; error?: string }> {
  if (!/^\d{1,15}$/.test(subscriberId)) return { ok: false, error: "manychat_invalid_subscriber" }; // fits a JS number exactly
  const r = await call("POST", "/fb/sending/sendContent", apiKey, { subscriber_id: Number(subscriberId), data: dynamicBlock(texts, sub) }, f);
  if (r.status === 200 && r.body.status === "success") return { ok: true };
  const e = classify(r.status, r.body);
  return { ok: false, error: e === "window" ? "outside_24h_window" : e === "token" ? "token_expired_or_invalid" : e === "rate" ? "rate_limited" : e === "network" ? "network_error" : `manychat_${e} (http ${r.status}${r.body.code ? ` code ${String(r.body.code)}` : ""})` };
}
