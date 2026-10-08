// OAuth callback. No session: trust comes from the signed state cookie + Shopify HMAC (constant-time).
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { audit, saveAddon } from "@/lib/store";
import { publicUrl } from "@/lib/shopify/http";
import { normalizeShopDomain, validateOAuthHmac } from "@/lib/shopify/config";
import { readState, STATE_COOKIE } from "@/lib/shopify/oauth-state";
import { shopifyGraphql } from "@/lib/shopify/graphql";
import { safeEqual } from "@/lib/crypto";

export async function GET(req: Request) {
  const base = publicUrl(req);
  const back = (notice: string) => {
    const res = NextResponse.redirect(`${base}/addons?notice=${notice}`);
    res.cookies.delete(STATE_COOKIE);
    return res;
  };
  const secret = process.env.SHOPIFY_API_SECRET, key = process.env.SHOPIFY_API_KEY;
  if (!secret || !key) return back("shopify_error");

  const params: Record<string, string> = {};
  new URL(req.url).searchParams.forEach((v, k) => { params[k] = v; });
  const st = readState((await cookies()).get(STATE_COOKIE)?.value);
  const shop = normalizeShopDomain(params.shop ?? "");

  if (!st || !shop || shop !== st.shop || !params.state || !safeEqual(params.state, st.state)) return back("shopify_error");
  if (!validateOAuthHmac(params, secret) || !params.code) return back("shopify_error");

  try {
    // Authorization code grant. `expiring=1` is NOT sent: expiring offline tokens are required for public apps only
    // (custom/merchant apps are exempt), and a non-expiring token is simpler for this single-store install.
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ client_id: key, client_secret: secret, code: params.code }),
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) return back("shopify_error");
    const tok = (await tokenRes.json()) as { access_token?: string; scope?: string };
    if (!tok.access_token) return back("shopify_error");

    const info = await shopifyGraphql<{ shop?: { name?: string } }>(shop, tok.access_token, "{ shop { name } }");
    saveAddon(st.tenantId, "shopify", {
      status: "connected",
      secrets: { shop, accessToken: tok.access_token, scopes: tok.scope ?? "" },
      publicInfo: { shop, name: info.data?.shop?.name || shop, mode: "oauth" },
    });
    audit(st.tenantId, "system", "shopify.connected", `oauth ${shop}`);
    return back("shopify_connected");
  } catch {
    return back("shopify_error");
  }
}
