// Maps a Shopify order node to STATUS-ONLY data. Fields are copied one by one: nothing else can leak
// (no address, items, phone, totals, payment, customer name).
import type { OrderStatusResult } from "../types";

export interface ShopifyOrderNode {
  name?: string | null;
  email?: string | null;
  customer?: { email?: string | null } | null;
  cancelledAt?: string | null;
  displayFulfillmentStatus?: string | null;
  displayFinancialStatus?: string | null;
  fulfillments?: {
    displayStatus?: string | null;
    estimatedDeliveryAt?: string | null;
    deliveredAt?: string | null;
    trackingInfo?: { company?: string | null; number?: string | null; url?: string | null }[] | null;
  }[] | null;
}

/**
 * The only fields we ask Shopify for (Order, Fulfillment, FulfillmentTrackingInfo; read_orders). `Order.email` is the
 * order's own email (protected customer data, level 2). `customer { email }` is NOT requested: the Customer object needs
 * the read_customers scope, which this read-only status bot does not ask for.
 */
export const ORDER_FIELDS = `name email cancelledAt displayFulfillmentStatus displayFinancialStatus
  fulfillments(first: 5) { displayStatus estimatedDeliveryAt deliveredAt trackingInfo(first: 3) { company number url } }`;

export const orderEmails = (n: ShopifyOrderNode): string[] =>
  [n.email, n.customer?.email].filter((e): e is string => !!e).map((e) => e.trim().toLowerCase());

const httpUrl = (u?: string | null) => (u && /^https?:\/\//i.test(u) ? u : undefined);

export function mapOrderToStatus(n: ShopifyOrderNode): OrderStatusResult {
  const fulfs = n.fulfillments ?? [];
  const tracking = fulfs.flatMap((f) => f.trackingInfo ?? []).find((t) => t.number || t.url);
  const fo = (n.displayFulfillmentStatus ?? "").toUpperCase();
  const fin = (n.displayFinancialStatus ?? "").toUpperCase();
  const delivered = fulfs.length > 0 && fulfs.every((f) => (f.displayStatus ?? "").toUpperCase() === "DELIVERED" || !!f.deliveredAt);

  let statusText: string;
  if (n.cancelledAt) statusText = "Cancelado";
  else if (delivered) statusText = "Entregado";
  else if (fo === "FULFILLED") statusText = "Enviado";
  else if (fo === "PARTIALLY_FULFILLED") statusText = "Enviado parcialmente";
  else if (fin === "PENDING") statusText = "Pago pendiente";
  else if (fin === "EXPIRED" || fin === "VOIDED") statusText = "Pago no completado";
  else if (fin === "REFUNDED") statusText = "Reembolsado";
  else if (fo === "ON_HOLD") statusText = "En espera";
  else statusText = "En preparación";

  const out: OrderStatusResult = { found: true, statusText };
  if (!n.cancelledAt) {
    if (tracking?.number) out.trackingNumber = String(tracking.number).slice(0, 80);
    if (tracking?.company) out.carrier = String(tracking.company).slice(0, 60);
    const url = httpUrl(tracking?.url);
    if (url) out.trackingUrl = url;
    const eta = fulfs.map((f) => f.estimatedDeliveryAt).find(Boolean);
    if (eta && !delivered) out.estimatedDelivery = String(eta).slice(0, 10);
  }
  return out;
}
