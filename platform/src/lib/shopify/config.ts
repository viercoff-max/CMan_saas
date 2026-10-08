// Pure helpers (no DB, no network): safe to unit test and to import anywhere.
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Single place to bump the Admin API version. shopify.dev/docs/api/usage/versioning (checked 2026-10-06):
 * 2026-10 is the latest stable (released 2026-10-01, supported until 2027-10-16). Bump once a quarter.
 */
export const SHOPIFY_API_VERSION = "2026-10";

/**
 * Scopes: `read_orders` covers orders, their fulfillments and tracking (Order.fulfillments).
 * `read_fulfillments` is only for FulfillmentOrder objects, which we do not use.
 * `read_all_orders` (orders older than 60 days) needs Shopify approval for the app, so it is opt-in via SHOPIFY_SCOPES.
 */
export function oauthScopes(): string {
  return (process.env.SHOPIFY_SCOPES || "read_orders").replace(/\s+/g, "");
}
export const hasAllOrdersScope = (scopes: string | undefined | null) => (scopes ?? "").split(",").includes("read_all_orders");

export const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/** "My-Store", "https://my-store.myshopify.com/admin" or "my-store" -> "my-store.myshopify.com"; null if invalid. */
export function normalizeShopDomain(input: string): string | null {
  let s = String(input ?? "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/[/?#].*$/, "");
  if (!s) return null;
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  return SHOP_RE.test(s) && s.length <= 100 ? s : null;
}

export function oauthConfigured(): boolean {
  return !!(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET);
}

/**
 * Shopify OAuth callback HMAC (authorization-code-grant doc): drop `hmac`, sort the rest, join decoded `k=v` with `&`,
 * HMAC-SHA256 hex with the client secret, constant-time compare. The older doc also escaped `%`/`&` (and `=` in keys);
 * values in real callbacks (code, host, shop, state, timestamp) never contain them, but both forms are accepted.
 */
export function validateOAuthHmac(params: Record<string, string>, secret: string): boolean {
  const given = params.hmac;
  if (!given || !secret) return false;
  const keys = Object.keys(params).filter((k) => k !== "hmac").sort();
  const plain = keys.map((k) => `${k}=${params[k]}`).join("&");
  const legacy = keys
    .map((k) => `${k.replace(/[%&=]/g, (c) => encodeURIComponent(c))}=${params[k].replace(/[%&]/g, (c) => encodeURIComponent(c))}`)
    .join("&");
  const b = Buffer.from(given.toLowerCase());
  return [plain, legacy].some((message) => {
    const a = Buffer.from(createHmac("sha256", secret).update(message).digest("hex"));
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

/** Search string for Admin GraphQL `orders(query:)`. The docs example is `name:#1001`; plain `name:1001` is also tried. */
export function orderNameQuery(num: string): string {
  return `name:#${num} OR name:${num}`;
}

/** "#1001", " 1001 ", "# 1001" -> "1001". Returns null if it is not a plausible order number. */
export function normalizeOrderNumber(input: string): string | null {
  const s = String(input ?? "").replace(/[#\s]/g, "");
  return /^[A-Za-z0-9-]{1,20}$/.test(s) ? s : null;
}
