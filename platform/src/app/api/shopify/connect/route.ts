// POST {shop} -> starts the real OAuth install (only when SHOPIFY_API_KEY/SECRET are set). Returns {url}.
import { z } from "zod";
import { json, publicUrl, tenantOr401 } from "@/lib/shopify/http";
import { normalizeShopDomain, oauthConfigured, oauthScopes } from "@/lib/shopify/config";
import { newState, STATE_COOKIE, STATE_TTL_S } from "@/lib/shopify/oauth-state";
import { checkSameOrigin } from "@/lib/security/origin";
import { limitOr429 } from "@/lib/security/rate-limit";
import { cookieSecure } from "@/lib/auth";

export async function POST(req: Request) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  const tenantId = await tenantOr401();
  if (typeof tenantId !== "string") return tenantId;
  const limited = limitOr429(`shopify-connect:${tenantId}`, 10, 15 * 60_000); if (limited) return limited;
  if (!oauthConfigured()) return json({ error: "oauth_not_configured" }, 400);
  const body = z.object({ shop: z.string().min(1).max(200) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: "invalid_shop" }, 400);
  const shop = normalizeShopDomain(body.data.shop);
  if (!shop) return json({ error: "invalid_shop" }, 400);

  const { state, cookie } = newState(tenantId, shop);
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", process.env.SHOPIFY_API_KEY!);
  url.searchParams.set("scope", oauthScopes());
  url.searchParams.set("redirect_uri", `${publicUrl(req)}/api/shopify/callback`);
  url.searchParams.set("state", state);

  const res = json({ url: url.toString() });
  res.headers.append(
    "set-cookie",
    `${STATE_COOKIE}=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${STATE_TTL_S}${cookieSecure() ? "; Secure" : ""}`,
  );
  return res;
}
