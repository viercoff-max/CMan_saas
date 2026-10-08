// POST: connect the demo store (mock mode, no network).
import { audit, saveAddon } from "@/lib/store";
import { json, tenantOr401 } from "@/lib/shopify/http";
import { checkSameOrigin } from "@/lib/security/origin";

export async function POST(req: Request) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  const tenantId = await tenantOr401();
  if (typeof tenantId !== "string") return tenantId;
  saveAddon(tenantId, "shopify", {
    status: "connected",
    secrets: { mock: true },
    publicInfo: { shop: "demo.myshopify.com", name: "Tienda de demostración", mock: true, mode: "demo" },
  });
  audit(tenantId, "user", "shopify.connected", "demo");
  return json({ ok: true });
}
