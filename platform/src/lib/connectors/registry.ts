// Add-on connectors plug into the engine through this registry (Shopify now; others later).
import type { OrdersConnector } from "../types";
import { shopifyConnector } from "../shopify/connector";

const ORDERS_CONNECTORS: OrdersConnector[] = [shopifyConnector];

/** First connected orders connector for the tenant, or null if the tenant has no commerce add-on. */
export function getOrdersConnector(tenantId: string): OrdersConnector | null {
  return ORDERS_CONNECTORS.find((c) => c.isConnected(tenantId)) ?? null;
}
