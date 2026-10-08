// Shopify OrdersConnector. STATUS ONLY: never returns address, items, phone, totals or payment.
import type { OrdersConnector, OrderStatusResult } from "../types";
import { getAddon } from "../store";
import { hasAllOrdersScope, normalizeOrderNumber, orderNameQuery } from "./config";
import { shopifyGraphql, type GqlResult } from "./graphql";
import { getShopifySecrets } from "./token";
import { mapOrderToStatus, orderEmails, ORDER_FIELDS, type ShopifyOrderNode } from "./mapping";
import { mockLookup } from "./mock";

const ORDERS_QUERY = `query($q: String!) { orders(first: 5, query: $q) { nodes { ${ORDER_FIELDS} } } }`;

/** Does a Shopify order name ("#1001", "#EN1001") match what the customer typed ("1001")? */
export function orderNameMatches(name: string | null | undefined, num: string): boolean {
  const n = String(name ?? "").replace(/[#\s]/g, "").toLowerCase();
  const t = num.toLowerCase();
  return n === t || (/^\d+$/.test(t) && new RegExp(`^[a-z-]+${t}$`).test(n));
}

/**
 * Lookup result. `mayBeOutsideWindow` is a SHOP-LEVEL flag (true when the app lacks `read_all_orders`, so the API only
 * sees the last 60 days). It never depends on whether the order exists, so it is not an existence oracle.
 * (`tooOld` in types.ts is no longer emitted; see docs/REQUESTS.md for adding `mayBeOutsideWindow` to the shared type.)
 */
export type ShopifyLookupResult = OrderStatusResult & { mayBeOutsideWindow?: boolean };

/** The single failure shape: not found, email mismatch and missing email are indistinguishable. */
export const notFound = (hasAllOrders: boolean): ShopifyLookupResult => ({ found: false, mayBeOutsideWindow: !hasAllOrders });

/** Pure part of the lookup (testable): pick the order, enforce exact email match, map to status only. */
export function resolveOrder(nodes: ShopifyOrderNode[], num: string, email: string, hasAllOrders: boolean): ShopifyLookupResult {
  const wanted = String(email ?? "").trim().toLowerCase();
  const node = nodes.find((n) => orderNameMatches(n.name, num));
  if (!node) return notFound(hasAllOrders);
  const emails = orderEmails(node);
  // Email absent (protected customer data not approved) or different => the same generic failure as a wrong order.
  if (!wanted || emails.length === 0 || !emails.includes(wanted)) return notFound(hasAllOrders);
  return mapOrderToStatus(node);
}

/**
 * True when Shopify refused the protected customer data we ask for (email). Docs: unapproved fields come back as null
 * with an error saying the app "is not approved to access" the field. Other errors are not treated as this case.
 */
export function emailAccessDenied(errors: GqlResult<unknown>["errors"]): boolean {
  return (errors ?? []).some((e) => {
    const msg = String(e?.message ?? "");
    const path = JSON.stringify((e as { path?: unknown })?.path ?? "");
    return /not approved to access|protected customer data/i.test(msg) || (e?.extensions?.code === "ACCESS_DENIED" && /email/i.test(`${msg} ${path}`));
  });
}

export const shopifyConnector: OrdersConnector = {
  key: "shopify",
  isConnected(tenantId) {
    try { return getAddon(tenantId, "shopify").status === "connected"; } catch { return false; }
  },
  async lookupOrderStatus(tenantId, orderNumber, email): Promise<ShopifyLookupResult> {
    const addon = getAddon(tenantId, "shopify");
    if (addon.status !== "connected") return { found: false };
    if (addon.publicInfo.mock === true) return mockLookup(orderNumber, email); // demo store: no 60-day window
    let sec = await getShopifySecrets(tenantId);
    if (!sec?.shop || !sec.accessToken) throw new Error("shopify_not_configured"); // engine: "could not check" + offer
    const hasAll = hasAllOrdersScope(sec.scopes);
    const num = normalizeOrderNumber(orderNumber);
    if (!num || !String(email ?? "").includes("@")) return notFound(hasAll);
    type R = { orders?: { nodes: ShopifyOrderNode[] } };
    let res = await shopifyGraphql<R>(sec.shop, sec.accessToken, ORDERS_QUERY, { q: orderNameQuery(num) });
    if (res.status === 401 && sec.grant === "client_credentials") {
      sec = await getShopifySecrets(tenantId, { force: true }); // token revoked/expired early: renew once
      if (sec) res = await shopifyGraphql<R>(sec.shop, sec.accessToken, ORDERS_QUERY, { q: orderNameQuery(num) });
    }
    // Protected customer data not granted: Shopify returns the order with email = null plus an "access denied" error.
    // Answering "not found" would blame the customer and burn their attempts, so this is a configuration failure.
    if (emailAccessDenied(res.errors)) throw new Error("shopify_email_access_denied");
    // Network/API failure: not the customer's fault and says nothing about the order. Throw so the engine answers
    // "no pude consultar tu pedido" + human offer, without counting a failed attempt.
    const nodes = res.data?.orders?.nodes;
    if (!nodes) throw new Error(`shopify_lookup_failed status=${res.status}`);
    return resolveOrder(nodes, num, email, hasAll);
  },
};
