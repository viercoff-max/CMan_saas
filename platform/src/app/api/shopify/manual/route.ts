// POST manual connection, two shapes (both verified with a light query before saving):
//  {shop, clientId, clientSecret}: Dev Dashboard app in the store's own organization -> client credentials grant
//                                   (token renewed automatically every 24 h, see lib/shopify/token.ts). Current path.
//  {shop, token}:                  existing admin-created custom app token ("shpat_..."). Shopify no longer lets
//                                   merchants CREATE these apps, but existing ones keep working.
import { z } from "zod";
import { audit, saveAddon } from "@/lib/store";
import { json, tenantOr401 } from "@/lib/shopify/http";
import { normalizeShopDomain } from "@/lib/shopify/config";
import { shopifyGraphql } from "@/lib/shopify/graphql";
import { fetchClientCredentialsToken, type ShopifySecrets } from "@/lib/shopify/token";
import { checkSameOrigin } from "@/lib/security/origin";
import { limitOr429 } from "@/lib/security/rate-limit";

const Static = z.object({ shop: z.string().min(1).max(200), token: z.string().trim().min(10).max(200).regex(/^[A-Za-z0-9_]+$/) });
const Cc = z.object({
  shop: z.string().min(1).max(200),
  clientId: z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
  clientSecret: z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9_-]+$/),
});

export async function POST(req: Request) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  const tenantId = await tenantOr401();
  if (typeof tenantId !== "string") return tenantId;
  const limited = limitOr429(`shopify-manual:${tenantId}`, 10, 15 * 60_000); if (limited) return limited;
  const raw = await req.json().catch(() => null);
  const cc = Cc.safeParse(raw);
  const st = cc.success ? null : Static.safeParse(raw);
  if (!cc.success && !st?.success) return json({ error: "invalid_input" }, 400);
  const shop = normalizeShopDomain(cc.success ? cc.data.shop : st!.data!.shop);
  if (!shop) return json({ error: "invalid_shop" }, 400);

  let secrets: ShopifySecrets;
  if (cc.success) {
    const t = await fetchClientCredentialsToken(shop, cc.data.clientId, cc.data.clientSecret);
    if (!t.ok) return json({ error: t.error === "bad_credentials" ? "bad_client_credentials" : "unreachable" }, t.error === "bad_credentials" ? 400 : 502);
    secrets = { shop, accessToken: t.accessToken, scopes: t.scopes, grant: "client_credentials", clientId: cc.data.clientId, clientSecret: cc.data.clientSecret, expiresAt: t.expiresAt };
  } else {
    secrets = { shop, accessToken: st!.data!.token };
  }

  const r = await shopifyGraphql<{ shop?: { name?: string } }>(shop, secrets.accessToken, "{ shop { name } }");
  if (r.status === 401 || r.status === 403 || r.status === 404) return json({ error: "bad_token" }, 400);
  if (!r.data?.shop) return json({ error: "unreachable" }, 502);

  // Best effort: learn the granted scopes (needed for the 60-day heuristic). Failure is fine.
  if (!secrets.scopes) {
    const sc = await shopifyGraphql<{ currentAppInstallation?: { accessScopes?: { handle: string }[] } }>(
      shop, secrets.accessToken, "{ currentAppInstallation { accessScopes { handle } } }");
    secrets.scopes = (sc.data?.currentAppInstallation?.accessScopes ?? []).map((s) => s.handle).join(",");
  }

  const mode = cc.success ? "client_credentials" : "manual";
  saveAddon(tenantId, "shopify", { status: "connected", secrets, publicInfo: { shop, name: r.data.shop.name || shop, mode } });
  audit(tenantId, "user", "shopify.connected", `${mode} ${shop}`);
  return json({ ok: true });
}
