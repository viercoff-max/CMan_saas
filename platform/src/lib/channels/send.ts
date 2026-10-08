// Outbound messages to customers. Never throws; never logs message text or tokens.
// Rules checked against developers.facebook.com (2026-10):
// - WhatsApp: POST {FB_GRAPH}/{phone-number-id}/messages, Bearer token, text.body <= 4096 chars. Free-form text only
//   inside the 24 h customer service window; outside it Meta needs an approved TEMPLATE (error 131047, reported later
//   in a status webhook even though the POST returns 200), so we refuse up front instead of "sending" into the void.
// - Messenger: POST {FB_GRAPH}/{page-id}/messages with a Page token, text < 2000 chars, messaging_type RESPONSE inside
//   24 h; a human agent may answer up to 7 days with messaging_type MESSAGE_TAG + tag HUMAN_AGENT (needs the
//   Human Agent permission approved in App Review, so it is opt-in via META_HUMAN_AGENT=1).
// - Instagram via a Facebook Page token: POST {FB_GRAPH}/me/messages (me = the Page), text <= 1000 (we count UTF-8 bytes).
// - Instagram via Instagram Login token ("IG..."): POST {IG_GRAPH}/{ig-id}/messages, text <= 1000 UTF-8 bytes.
import type { Conversation } from "../types";
import { getChannelAccount, getChannelSecrets } from "../store";
import { FB_GRAPH, IG_GRAPH, isInstagramLoginToken } from "./graph";
import { lastInboundAt } from "./repo";

const TIMEOUT_MS = 10_000;
const HOUR = 60 * 60 * 1000;

type MetaCh = "whatsapp" | "messenger" | "instagram";
/** Per-channel text limits. `bytes` = UTF-8 bytes (Instagram Login doc: "1000 bytes or less"). */
export const TEXT_LIMITS: Record<MetaCh, { max: number; unit: "chars" | "bytes" }> = {
  whatsapp: { max: 4096, unit: "chars" },
  messenger: { max: 1999, unit: "chars" }, // "less than 2000 characters"
  instagram: { max: 1000, unit: "bytes" },
};

const utf8 = (s: string) => Buffer.byteLength(s, "utf8");

/** Largest prefix length (in UTF-16 units) of `s` that fits `max`, never splitting a surrogate pair. */
function fitIndex(s: string, max: number, unit: "chars" | "bytes"): number {
  let i = 0, used = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i)!;
    const w = cp > 0xffff ? 2 : 1;
    const cost = unit === "bytes" ? (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4) : w;
    if (used + cost > max) break;
    used += cost; i += w;
  }
  return Math.max(i, 1);
}

/** Split on paragraph/line/space boundaries so each part fits the limit (chars or UTF-8 bytes). */
export function splitMessage(text: string, max = 1000, unit: "chars" | "bytes" = "chars"): string[] {
  const t = text.trim();
  if (!t) return [];
  const size = (s: string) => (unit === "bytes" ? utf8(s) : s.length);
  const parts: string[] = [];
  let rest = t;
  while (size(rest) > max) {
    const lim = fitIndex(rest, max, unit);
    let cut = rest.lastIndexOf("\n\n", lim);
    if (cut < lim / 2) cut = rest.lastIndexOf("\n", lim);
    if (cut < lim / 2) cut = rest.lastIndexOf(" ", lim);
    if (cut < lim / 2 || cut > lim) cut = lim;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

export type WindowDecision = { ok: true; humanAgentTag: boolean } | { ok: false; error: string };

/**
 * Messaging-window policy. Bot replies always follow an inbound message, so they are inside 24 h; this matters for
 * a human agent answering late from the inbox. Unknown last-inbound time (null) is allowed and left to Meta.
 */
export function windowDecision(channel: MetaCh, lastInbound: string | null, now = Date.now(), humanAgentEnabled = false): WindowDecision {
  if (!lastInbound) return { ok: true, humanAgentTag: false };
  const age = now - new Date(lastInbound).getTime();
  if (!(age > 24 * HOUR)) return { ok: true, humanAgentTag: false };
  if (channel === "whatsapp") return { ok: false, error: "outside_24h_window_template_required" };
  if (humanAgentEnabled && age <= 7 * 24 * HOUR) return { ok: true, humanAgentTag: true };
  return { ok: false, error: humanAgentEnabled ? "outside_7d_human_agent_window" : "outside_24h_window" };
}

/** Graph error -> short, log-safe reason (no message text, no ids). */
export function describeGraphError(status: number, body: unknown): string {
  const e = (body as { error?: { code?: number; error_subcode?: number; message?: string } } | null)?.error ?? {};
  const code = Number(e.code) || 0, sub = Number(e.error_subcode) || 0;
  const known =
    code === 131047 ? "outside_24h_window_template_required" :
    code === 131030 ? "recipient_not_in_test_allowed_list" :
    code === 131026 ? "undeliverable" :
    code === 131056 || code === 130429 || code === 80007 || code === 4 || code === 613 ? "rate_limited" :
    code === 190 ? "token_expired_or_invalid" :
    code === 10 && (sub === 2018278 || sub === 2534022) ? "outside_messaging_window" :
    code === 10 || code === 200 || code === 230 ? "permission_missing" :
    code === 551 ? "recipient_unavailable" :
    code === 100 ? "invalid_parameter" : "";
  const detail = String(e.message ?? "").slice(0, 160);
  return `${known || "meta_error"} (http ${status}${code ? ` code ${code}${sub ? `/${sub}` : ""}` : ""})${detail ? `: ${detail}` : ""}`;
}

async function post(url: string, token: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      // Token in the Authorization header (never in the URL, so it cannot end up in proxy/access logs).
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };
    let j: unknown = null;
    try { j = await res.json(); } catch { /* ignore */ }
    return { ok: false, error: describeGraphError(res.status, j) };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network_error" };
  }
}

export async function sendToCustomer(tenantId: string, conv: Conversation, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (conv.channel === "simulator") return { ok: true };
    const ch = conv.channel as MetaCh;
    const limit = TEXT_LIMITS[ch];
    if (!limit) return { ok: false, error: "unknown_channel" };
    const parts = splitMessage(text, limit.max, limit.unit);
    if (parts.length === 0) return { ok: false, error: "empty_message" };

    const account = getChannelAccount(tenantId, ch);
    if (account.status !== "connected") return { ok: false, error: "channel_not_connected" };
    const secrets = getChannelSecrets<Record<string, string>>(tenantId, ch);
    const token = secrets?.accessToken;
    if (!token) return { ok: false, error: "missing_token" };

    const win = windowDecision(ch, lastInboundAt(tenantId, conv.id), Date.now(), process.env.META_HUMAN_AGENT === "1");
    if (!win.ok) return { ok: false, error: win.error };
    const externalId = String(account.publicInfo.externalId ?? "");

    for (const part of parts) {
      let r: { ok: boolean; error?: string };
      if (ch === "whatsapp") {
        const phoneId = secrets?.phoneNumberId || externalId;
        if (!phoneId) return { ok: false, error: "missing_phone_number_id" };
        r = await post(`${FB_GRAPH}/${encodeURIComponent(phoneId)}/messages`, token, {
          messaging_product: "whatsapp", recipient_type: "individual", to: conv.externalId, type: "text", text: { body: part, preview_url: false },
        });
      } else {
        const tag = win.humanAgentTag ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : { messaging_type: "RESPONSE" };
        let url: string;
        if (ch === "instagram" && (secrets?.igLogin === "1" || isInstagramLoginToken(token))) {
          const igId = secrets?.igId || externalId;
          url = `${IG_GRAPH}/${igId ? encodeURIComponent(igId) : "me"}/messages`;
        } else if (ch === "messenger") {
          const pageId = secrets?.pageId || externalId;
          url = `${FB_GRAPH}/${pageId ? encodeURIComponent(pageId) : "me"}/messages`;
        } else {
          url = `${FB_GRAPH}/me/messages`; // Instagram through the linked Page: "me" is the Page of the Page token
        }
        r = await post(url, token, { recipient: { id: conv.externalId }, ...tag, message: { text: part } });
      }
      if (!r.ok) return r;
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "send_failed" };
  }
}
