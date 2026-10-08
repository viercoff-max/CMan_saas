// Admin API access tokens. Since 2026 new custom apps can no longer be created in the Shopify admin (existing
// "shpat_" tokens keep working). New stores use a Dev Dashboard app; when the app and the store belong to the same
// Shopify organization the server gets a token with the CLIENT CREDENTIALS grant
// (shopify.dev .../access-tokens/client-credentials-grant, checked 2026-10-06):
//   POST https://{shop}/admin/oauth/access_token  (application/x-www-form-urlencoded)
//   grant_type=client_credentials&client_id=...&client_secret=...  ->  { access_token, scope, expires_in: 86399 }
// The token lives 24 h, so it is renewed here automatically. Never logs secrets.
import { getDb } from "../db";
import { encryptJson } from "../crypto";
import { getAddonSecrets } from "../store";

export interface ShopifySecrets {
  shop: string;
  accessToken: string;
  scopes?: string;
  /** "client_credentials" for Dev Dashboard apps; absent for static tokens (legacy custom app, OAuth). */
  grant?: "client_credentials";
  clientId?: string;
  clientSecret?: string;
  /** epoch ms */
  expiresAt?: number;
}

const REFRESH_MARGIN_MS = 5 * 60_000;
type Fetch = typeof fetch;

export type CcResult = { ok: true; accessToken: string; scopes: string; expiresAt: number } | { ok: false; error: "bad_credentials" | "unreachable" };

export async function fetchClientCredentialsToken(shop: string, clientId: string, clientSecret: string, f: Fetch = fetch, now = Date.now()): Promise<CcResult> {
  try {
    const res = await f(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString(),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) return { ok: false, error: "bad_credentials" };
    if (!res.ok) return { ok: false, error: "unreachable" };
    const j = (await res.json()) as { access_token?: string; scope?: string; expires_in?: number };
    if (!j.access_token) return { ok: false, error: "bad_credentials" };
    const ttl = Number(j.expires_in) > 0 ? Number(j.expires_in) * 1000 : 24 * 3600_000;
    return { ok: true, accessToken: j.access_token, scopes: j.scope ?? "", expiresAt: now + ttl };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}

/** Rewrites only the encrypted secrets (store.saveAddon would also reset connected_at). */
function persist(tenantId: string, s: ShopifySecrets) {
  getDb().prepare("UPDATE addons SET config_enc=? WHERE tenant_id=? AND key='shopify'").run(encryptJson(s), tenantId);
}

export const needsRefresh = (s: ShopifySecrets, now = Date.now()) =>
  s.grant === "client_credentials" && (!s.accessToken || !s.expiresAt || s.expiresAt - now < REFRESH_MARGIN_MS);

/**
 * Current secrets with a usable token. `force` renews a client-credentials token even if it looks valid (after a 401).
 * Returns null when not configured or the renewal failed.
 */
export async function getShopifySecrets(tenantId: string, opts: { force?: boolean; fetch?: Fetch } = {}): Promise<ShopifySecrets | null> {
  const s = getAddonSecrets<ShopifySecrets>(tenantId, "shopify");
  if (!s?.shop) return null;
  if (s.grant !== "client_credentials") return s.accessToken ? s : null;
  if (!opts.force && !needsRefresh(s)) return s;
  if (!s.clientId || !s.clientSecret) return null;
  const r = await fetchClientCredentialsToken(s.shop, s.clientId, s.clientSecret, opts.fetch);
  if (!r.ok) return null;
  const next: ShopifySecrets = { ...s, accessToken: r.accessToken, scopes: r.scopes || s.scopes, expiresAt: r.expiresAt };
  persist(tenantId, next);
  return next;
}
