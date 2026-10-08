// POST: disconnect and clear the stored secrets.
import { audit, saveAddon } from "@/lib/store";
import { json, tenantOr401 } from "@/lib/shopify/http";
import { checkSameOrigin } from "@/lib/security/origin";

export async function POST(req: Request) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  const tenantId = await tenantOr401();
  if (typeof tenantId !== "string") return tenantId;
  saveAddon(tenantId, "shopify", { status: "disconnected", publicInfo: {} });
  audit(tenantId, "user", "shopify.disconnected");
  return json({ ok: true });
}
