// Validates channel credentials against the Meta Graph API, then subscribes the app to the account's webhooks
// (without that subscription Meta never calls our webhook, even with a valid token). Never logs or returns the token.
// Node fields checked against developers.facebook.com (2026-10):
// - WhatsApp phone number node: verified_name, display_phone_number. WABA node: name. POST /{waba-id}/subscribed_apps.
// - Page node: name. POST /{page-id}/subscribed_apps?subscribed_fields=... needs a PAGE token (a user token fails here,
//   which is exactly what we want to catch: sending needs a Page token too).
// - Instagram through a Page: IG user node fields username,name; subscription is on the Page: POST /me/subscribed_apps.
// - Instagram Login token ("IG..."): GET graph.instagram.com/me?fields=user_id,username, where user_id is the id that
//   webhooks put in entry.id; POST graph.instagram.com/me/subscribed_apps?subscribed_fields=messages,...
import { FB_GRAPH, IG_GRAPH, isInstagramLoginToken, MESSAGING_SUBSCRIBED_FIELDS } from "@/lib/channels/graph";

const TIMEOUT_MS = 8_000;

export type GraphFailure = "token" | "id" | "permissions" | "rate" | "network" | "webhook" | "unknown";
export type GraphResult = { ok: true; name: string; igLogin?: boolean } | { ok: false; error: GraphFailure };

type Fetch = typeof fetch;

/** Maps a Graph error body/status to a coarse category we can explain in plain Spanish. */
export function classifyGraphError(status: number, body: unknown): GraphFailure {
  const e = (body as { error?: { code?: number; type?: string } } | null)?.error;
  const code = e?.code;
  if (code === 190 || code === 102 || code === 463 || code === 467 || status === 401) return "token";
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80007 || status === 429) return "rate";
  if (code === 10 || code === 200 || code === 210 || code === 230 || code === 299 || status === 403) return "permissions";
  if (code === 100 || code === 803 || status === 404 || status === 400) return "id";
  return "unknown";
}

async function call(method: "GET" | "POST", url: string, token: string, f: Fetch): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: GraphFailure }> {
  try {
    const res = await f(url, {
      method,
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    let body: Record<string, unknown> | null = null;
    try { body = (await res.json()) as Record<string, unknown>; } catch { /* non-JSON */ }
    if (!res.ok) return { ok: false, error: classifyGraphError(res.status, body) };
    return { ok: true, body: body ?? {} };
  } catch {
    return { ok: false, error: "network" };
  }
}

const nameOf = (body: Record<string, unknown>, fallback: string) =>
  ((([body.name, body.verified_name, body.username].find((v) => typeof v === "string" && v.trim()) as string | undefined) ?? fallback)).slice(0, 80);

async function getNode(base: string, id: string, fields: string, token: string, f: Fetch): Promise<GraphResult & { body?: Record<string, unknown> }> {
  const r = await call("GET", `${base}/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`, token, f);
  if (!r.ok) return r;
  return { ok: true, name: nameOf(r.body, id), body: r.body };
}

/** Subscribes our app to the account's webhooks. Token problems keep their category; anything else is "webhook". */
async function subscribe(url: string, token: string, f: Fetch): Promise<{ ok: true } | { ok: false; error: GraphFailure }> {
  const r = await call("POST", url, token, f);
  if (r.ok) return r.body.success === false ? { ok: false, error: "webhook" } : { ok: true };
  return { ok: false, error: r.error === "token" || r.error === "network" || r.error === "rate" ? r.error : "webhook" };
}

export async function testChannelCredentials(
  channel: "whatsapp" | "instagram" | "messenger",
  input: { externalId: string; accessToken: string; wabaId?: string },
  f: Fetch = fetch,
): Promise<GraphResult> {
  const token = input.accessToken;
  const fields = encodeURIComponent(MESSAGING_SUBSCRIBED_FIELDS);

  if (channel === "whatsapp") {
    const num = await getNode(FB_GRAPH, input.externalId, "verified_name,display_phone_number", token, f);
    if (!num.ok) return num;
    if (input.wabaId) {
      const waba = await getNode(FB_GRAPH, input.wabaId, "name", token, f);
      if (!waba.ok) return waba;
      const sub = await subscribe(`${FB_GRAPH}/${encodeURIComponent(input.wabaId)}/subscribed_apps`, token, f);
      if (!sub.ok) return sub;
    }
    return { ok: true, name: num.name };
  }

  if (channel === "instagram" && isInstagramLoginToken(token)) {
    const me = await call("GET", `${IG_GRAPH}/me?fields=user_id,username`, token, f);
    if (!me.ok) return me;
    if (String(me.body.user_id ?? "") !== input.externalId) return { ok: false, error: "id" };
    const sub = await subscribe(`${IG_GRAPH}/me/subscribed_apps?subscribed_fields=${fields}`, token, f);
    if (!sub.ok) return sub;
    return { ok: true, name: nameOf(me.body, input.externalId), igLogin: true };
  }

  const node = await getNode(FB_GRAPH, input.externalId, channel === "instagram" ? "username,name" : "name", token, f);
  if (!node.ok) return node;
  // Messenger: the Page itself. Instagram through a Page: "me" = the Page that owns the Page token.
  const target = channel === "messenger" ? encodeURIComponent(input.externalId) : "me";
  const sub = await subscribe(`${FB_GRAPH}/${target}/subscribed_apps?subscribed_fields=${fields}`, token, f);
  if (!sub.ok) return sub;
  return { ok: true, name: node.name };
}
