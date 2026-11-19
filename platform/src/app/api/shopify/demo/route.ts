// POST: connect the demo store (mock mode, no network).
import { getData } from "@/lib/data";
import { json, tenantOr401 } from "@/lib/shopify/http";
import { checkSameOrigin } from "@/lib/security/origin";

export async function POST(req: Request) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  const tenantId = await tenantOr401();
  if (typeof tenantId !== "string") return tenantId;
  const data = getData();
  await data.secrets.set(tenantId, "addon", "shopify", { mock: true });
  await data.addons.save(tenantId, "shopify", {
    status: "connected",
    publicInfo: { shop: "demo.myshopify.com", name: "Tienda de demostración", mock: true, mode: "demo" },
  });
  await data.audit.log(tenantId, "user", "shopify.connected", "demo");
  return json({ ok: true });
}
