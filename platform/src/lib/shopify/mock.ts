// Demo store: 4 sample orders, answered without network. Email for all: test@example.com
import type { OrderStatusResult } from "../types";
import { mapOrderToStatus, orderEmails, type ShopifyOrderNode } from "./mapping";
import { normalizeOrderNumber } from "./config";

export const MOCK_EMAIL = "test@example.com";
export const MOCK_ORDERS: ShopifyOrderNode[] = [
  { name: "#1001", email: MOCK_EMAIL, displayFulfillmentStatus: "FULFILLED", displayFinancialStatus: "PAID",
    fulfillments: [{ displayStatus: "IN_TRANSIT", estimatedDeliveryAt: "2026-10-12T00:00:00Z",
      trackingInfo: [{ company: "Estafeta", number: "EST123456789", url: "https://example.com/track/EST123456789" }] }] },
  { name: "#1002", email: MOCK_EMAIL, displayFulfillmentStatus: "UNFULFILLED", displayFinancialStatus: "PAID", fulfillments: [] },
  { name: "#1003", email: MOCK_EMAIL, displayFulfillmentStatus: "FULFILLED", displayFinancialStatus: "PAID",
    fulfillments: [{ displayStatus: "DELIVERED", deliveredAt: "2026-09-20T00:00:00Z",
      trackingInfo: [{ company: "DHL", number: "DHL987654321", url: "https://example.com/track/DHL987654321" }] }] },
  { name: "#1004", email: MOCK_EMAIL, cancelledAt: "2026-09-25T00:00:00Z", displayFulfillmentStatus: "UNFULFILLED", displayFinancialStatus: "REFUNDED", fulfillments: [] },
];

export function mockLookup(orderNumber: string, email: string): OrderStatusResult {
  const num = normalizeOrderNumber(orderNumber);
  const node = num ? MOCK_ORDERS.find((o) => (o.name ?? "").replace("#", "") === num) : undefined;
  if (!node || !orderEmails(node).includes(String(email ?? "").trim().toLowerCase())) return { found: false };
  return mapOrderToStatus(node);
}
