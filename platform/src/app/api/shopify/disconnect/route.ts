// POST: disconnect and clear the stored secrets.
import { getData } from "@/lib/data";
import { json, tenantOr401 } from "@/lib/shopify/http";
import { checkSameOrigin } from "@/lib/security/origin";

export async function POST(req: Request) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  const tenantId = await tenantOr401();
  if (typeof tenantId !== "string") return tenantId;
  const data = getData();
  await data.addons.save(tenantId, "shopify", { status: "disconnected", publicInfo: {} }); // also wipes the secrets
  await data.secrets.clear(tenantId, "addon", "shopify");
  await data.audit.log(tenantId, "user", "shopify.disconnected");
  return json({ ok: true });
}
