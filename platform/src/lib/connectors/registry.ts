// Add-on connectors plug into the engine through this registry (Shopify now; others later).
import type { OrdersConnector } from "../types";
import { shopifyConnector } from "../shopify/connector";

const ORDERS_CONNECTORS: OrdersConnector[] = [shopifyConnector];

/** First connected orders connector for the tenant, or null if the tenant has no commerce add-on. */
export async function getOrdersConnector(tenantId: string): Promise<OrdersConnector | null> {
  for (const c of ORDERS_CONNECTORS) if (await c.isConnected(tenantId)) return c;
  return null;
}
