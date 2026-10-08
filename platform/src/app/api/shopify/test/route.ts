// POST {order, email}: what the assistant would find (status only). Tenant from session.
import { z } from "zod";
import { json, tenantOr401 } from "@/lib/shopify/http";
import { shopifyConnector } from "@/lib/shopify/connector";
import { checkSameOrigin } from "@/lib/security/origin";
import { limitOr429 } from "@/lib/security/rate-limit";

export async function POST(req: Request) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  const tenantId = await tenantOr401();
  if (typeof tenantId !== "string") return tenantId;
  // Same order/email oracle as the bot: keep it slow.
  const limited = limitOr429(`shopify-test:${tenantId}`, 20, 10 * 60_000); if (limited) return limited;
  const body = z.object({ order: z.string().min(1).max(40), email: z.string().min(3).max(200) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: "invalid_input" }, 400);
  if (!shopifyConnector.isConnected(tenantId)) return json({ error: "not_connected" }, 400);
  try {
    const r = await shopifyConnector.lookupOrderStatus(tenantId, body.data.order, body.data.email);
    return json({ result: r });
  } catch (e) {
    // Connector throws on API/network failure or missing token. Never echo details; one configuration case is named
    // so the owner knows what to fix (protected customer data / email access not granted to the app).
    if (e instanceof Error && e.message === "shopify_email_access_denied") return json({ error: "email_access_denied" }, 502);
    return json({ error: "lookup_failed" }, 502);
  }
}
